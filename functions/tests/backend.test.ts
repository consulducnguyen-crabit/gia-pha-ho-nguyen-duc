import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initializeApp as initializeAdmin,
  deleteApp as deleteAdmin,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  getFirestore as getAdminFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import { connectFirestoreEmulator } from "firebase/firestore";

const projectId = "demo-gia-pha";
const password = "Only-fake-Emulator-2026!";
const clientApps: FirebaseApp[] = [];
const admin = initializeAdmin(
  { projectId },
  `membership-tests-${randomUUID()}`,
);
const adminAuth = getAdminAuth(admin);
const db = getAdminFirestore(admin);
type Invitation = { invitationId: string; token: string };

function client() {
  const app = initializeApp(
    { apiKey: "demo-key", projectId, authDomain: "localhost" },
    randomUUID(),
  );
  clientApps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  return {
    auth,
    firestore,
    async call<T = Record<string, unknown>>(
      name: string,
      data: unknown,
    ): Promise<T> {
      return (await httpsCallable<unknown, T>(functions, name)(data)).data;
    },
  };
}
type Session = ReturnType<typeof client> & { uid: string; email: string };
async function principal(
  options: {
    verified?: boolean;
    membership?: Record<string, unknown>;
    claims?: Record<string, unknown>;
  } = {},
): Promise<Session> {
  const uid = `membership-${randomUUID()}`;
  const email = `${uid}@example.test`;
  await adminAuth.createUser({
    uid,
    email,
    password,
    emailVerified: options.verified ?? true,
  });
  if (options.claims) await adminAuth.setCustomUserClaims(uid, options.claims);
  if (options.membership) await db.doc(`users/${uid}`).set(options.membership);
  const session = client();
  await signInWithEmailAndPassword(session.auth, email, password);
  return { ...session, uid, email };
}
let manager: Session;
const memberRecord = { enabled: true, roleIds: ["member"], accessVersion: 1 };
async function invite(target: Session, issuer: Session = manager) {
  return issuer.call<Invitation>("createInvitation", { email: target.email });
}
async function denied(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code: `functions/${code}` });
}
async function disable(
  target: Session,
  issuer: Session = manager,
  requestId = randomUUID(),
) {
  return issuer.call<{ changed: boolean }>("disableMembership", {
    targetUid: target.uid,
    requestId,
  });
}

beforeAll(async () => {
  if (
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
  )
    throw Error("Integration tests require the fixed demo emulators.");
  const uid = "tests-manager";
  const email = "manager@example.test";
  await adminAuth
    .getUser(uid)
    .then(() =>
      adminAuth.updateUser(uid, {
        email,
        password,
        emailVerified: true,
        disabled: false,
      }),
    )
    .catch((error: { code?: string }) => {
      if (error.code !== "auth/user-not-found") throw error;
      return adminAuth.createUser({
        uid,
        email,
        password,
        emailVerified: true,
      });
    });
  await db
    .doc(`users/${uid}`)
    .set({ ...memberRecord, canManageMembership: true });
  const session = client();
  await signInWithEmailAndPassword(session.auth, email, password);
  manager = { ...session, uid, email };
}, 60000);
afterAll(async () => {
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  await deleteAdmin(admin);
});

describe("invitation callable backend on real emulators", () => {
  it("grants only member with consumed invitation and atomic audit; stores no raw token in documents", async () => {
    const target = await principal();
    const invitation = await invite(target);
    expect(/^[A-Za-z0-9_-]{43}$/.test(invitation.token)).toBe(true);
    expect(
      invitation.invitationId ===
        createHash("sha256").update(invitation.token).digest("hex"),
    ).toBe(true);
    const created = (
      await db.doc(`invitations/${invitation.invitationId}`).get()
    ).data()!;
    expect(created.targetUid).toBe(target.uid);
    expect(created.status).toBe("PENDING");
    expect(created.expiresAt.toMillis() - created.createdAt.toMillis()).toBe(
      48 * 60 * 60 * 1000,
    );
    expect(JSON.stringify(created).includes(invitation.token)).toBe(false);
    await expect(
      target.call("acceptInvitation", { token: invitation.token }),
    ).resolves.toEqual({ accepted: true });
    const account = (await db.doc(`users/${target.uid}`).get()).data()!;
    expect(account).toMatchObject({
      enabled: true,
      roleIds: ["member"],
      approvedBy: manager.uid,
      accessVersion: 1,
    });
    expect(account.canManageMembership).toBeUndefined();
    expect(
      (await db.doc(`invitations/${invitation.invitationId}`).get()).data()
        ?.status,
    ).toBe("ACCEPTED");
    for (const event of ["created", "accepted"]) {
      const audit = (
        await db
          .doc(`auditLogs/invitation-${event}-${invitation.invitationId}`)
          .get()
      ).data()!;
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit).includes(invitation.token)).toBe(false);
      expect(JSON.stringify(audit).includes(target.email)).toBe(false);
    }
  });

  it("rejects unauthenticated calls to every endpoint", async () => {
    const anonymous = client();
    for (const [name, data] of [
      ["createInvitation", { email: "nobody@example.test" }],
      ["acceptInvitation", { token: "A".repeat(43) }],
      ["revokeInvitation", { invitationId: "a".repeat(64) }],
      ["disableMembership", { targetUid: "target", requestId: randomUUID() }],
    ] as const)
      await denied(anonymous.call(name, data), "unauthenticated");
  });

  for (const role of [
    "pending",
    "member",
    "claimed-admin",
    "disabled-manager",
  ] as const) {
    it(`${role} cannot create/revoke invitations or disable membership`, async () => {
      const caller = await principal({
        membership:
          role === "pending" || role === "claimed-admin"
            ? undefined
            : role === "member"
              ? memberRecord
              : { ...memberRecord, enabled: false, canManageMembership: true },
        claims:
          role === "claimed-admin"
            ? { role: "admin", canManageMembership: true, enabled: true }
            : undefined,
      });
      const target = await principal();
      const invitation = await invite(target);
      await denied(
        caller.call("createInvitation", { email: target.email }),
        "permission-denied",
      );
      await denied(
        caller.call("revokeInvitation", {
          invitationId: invitation.invitationId,
        }),
        "permission-denied",
      );
      await denied(disable(target, caller), "permission-denied");
      expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
      expect(
        (await db.doc(`invitations/${invitation.invitationId}`).get()).data()
          ?.status,
      ).toBe("PENDING");
    });
  }

  it("rejects extra role/capability/status fields instead of trusting client input", async () => {
    const target = await principal();
    const invitation = await invite(target);
    for (const extra of [
      { roleIds: ["admin"] },
      { canManageMembership: true },
      { status: "ACCEPTED" },
    ]) {
      await denied(
        manager.call("createInvitation", { email: target.email, ...extra }),
        "invalid-argument",
      );
      await denied(
        target.call("acceptInvitation", { token: invitation.token, ...extra }),
        "invalid-argument",
      );
    }
    expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
  });

  it("rejects absent, malformed and unknown invitation tokens", async () => {
    const target = await principal();
    for (const token of [
      undefined,
      "",
      "short",
      "/".repeat(43),
      "A".repeat(44),
    ]) {
      await denied(
        target.call("acceptInvitation", token === undefined ? {} : { token }),
        "invalid-argument",
      );
    }
    await denied(
      target.call("acceptInvitation", { token: "A".repeat(43) }),
      "failed-precondition",
    );
  });

  it("binds invitation to the immutable target UID", async () => {
    const target = await principal();
    const other = await principal();
    const invitation = await invite(target);
    await denied(
      other.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
    expect((await db.doc(`users/${other.uid}`).get()).exists).toBe(false);
  });

  it("rejects a target whose verified email changed after issuance", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await adminAuth.updateUser(target.uid, {
      email: `changed-${randomUUID()}@example.test`,
      emailVerified: true,
    });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
    expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
  });

  it("uses live Auth verification rather than stale verified token claims", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await adminAuth.updateUser(target.uid, { emailVerified: false });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "permission-denied",
    );
    expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
  });

  it("uses live disabled Auth state even if a sign-in token already exists", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await adminAuth.updateUser(target.uid, { disabled: true });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "permission-denied",
    );
  });

  it("does not authorize an unverified manager", async () => {
    const caller = await principal({
      verified: false,
      membership: { ...memberRecord, canManageMembership: true },
    });
    const target = await principal();
    await denied(
      caller.call("createInvitation", { email: target.email }),
      "permission-denied",
    );
  });

  it("rejects expired invitations without a membership or acceptance audit", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await db
      .doc(`invitations/${invitation.invitationId}`)
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
    expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
    expect(
      (
        await db
          .doc(`auditLogs/invitation-accepted-${invitation.invitationId}`)
          .get()
      ).exists,
    ).toBe(false);
  });

  it("revokes a pending invitation exactly once and prevents redemption", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await expect(
      manager.call("revokeInvitation", {
        invitationId: invitation.invitationId,
      }),
    ).resolves.toEqual({ changed: true });
    await expect(
      manager.call("revokeInvitation", {
        invitationId: invitation.invitationId,
      }),
    ).resolves.toEqual({ changed: false });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
    expect(
      (
        await db
          .doc(`auditLogs/invitation-revoked-${invitation.invitationId}`)
          .get()
      ).exists,
    ).toBe(true);
  });

  it("does not resurrect membership when an accepted token is replayed after disable", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await target.call("acceptInvitation", { token: invitation.token });
    await disable(target);
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
    expect((await db.doc(`users/${target.uid}`).get()).data()?.enabled).toBe(
      false,
    );
  });

  it("rechecks the issuer authority on acceptance", async () => {
    const issuer = await principal({
      membership: { ...memberRecord, canManageMembership: true },
    });
    const target = await principal();
    const invitation = await invite(target, issuer);
    await db
      .doc(`users/${issuer.uid}`)
      .update({ enabled: false, accessVersion: 2 });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "permission-denied",
    );
    expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
  });

  it("rejects issuer authority from an older access version even after re-enable", async () => {
    const issuer = await principal({
      membership: { ...memberRecord, canManageMembership: true },
    });
    const target = await principal();
    const invitation = await invite(target, issuer);
    await db.doc(`users/${issuer.uid}`).update({ accessVersion: 3 });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
  });

  it("invalidates invitations issued before target revoke but accepts an explicit fresh re-invite", async () => {
    const target = await principal();
    const old = await invite(target);
    await disable(target);
    await denied(
      target.call("acceptInvitation", { token: old.token }),
      "failed-precondition",
    );
    const fresh = await invite(target);
    await target.call("acceptInvitation", { token: fresh.token });
    expect((await db.doc(`users/${target.uid}`).get()).data()).toMatchObject({
      enabled: true,
      accessVersion: 2,
      roleIds: ["member"],
    });
  });

  it("consumes a concurrently redeemed invitation only once", async () => {
    const target = await principal();
    const invitation = await invite(target);
    const results = await Promise.allSettled([
      target.call("acceptInvitation", { token: invitation.token }),
      target.call("acceptInvitation", { token: invitation.token }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled").length,
    ).toBe(1);
    expect(
      results.filter((result) => result.status === "rejected").length,
    ).toBe(1);
    expect(
      (await db.doc(`users/${target.uid}`).get()).data()?.accessVersion,
    ).toBe(1);
    expect(
      (
        await db
          .doc(`auditLogs/invitation-accepted-${invitation.invitationId}`)
          .get()
      ).exists,
    ).toBe(true);
  });

  it("makes disable retry-safe and rejects reuse of a request ID for another target", async () => {
    const target = await principal();
    const requestId = randomUUID();
    await expect(disable(target, manager, requestId)).resolves.toEqual({
      changed: true,
    });
    await expect(disable(target, manager, requestId)).resolves.toEqual({
      changed: false,
    });
    expect(
      (await db.doc(`users/${target.uid}`).get()).data()?.accessVersion,
    ).toBe(1);
    const other = await principal();
    await denied(disable(other, manager, requestId), "invalid-argument");
    expect((await db.doc(`users/${other.uid}`).get()).exists).toBe(false);
  });

  it("does not revoke a fresh re-grant when an old disable request is retried", async () => {
    const target = await principal();
    const requestId = randomUUID();
    await expect(disable(target, manager, requestId)).resolves.toEqual({
      changed: true,
    });
    const invitation = await invite(target);
    await target.call("acceptInvitation", { token: invitation.token });
    const regranted = (await db.doc(`users/${target.uid}`).get()).data()!;
    expect(regranted).toMatchObject({ enabled: true, accessVersion: 2 });
    await expect(disable(target, manager, requestId)).resolves.toEqual({
      changed: false,
    });
    const afterRetry = (await db.doc(`users/${target.uid}`).get()).data()!;
    expect(afterRetry).toEqual(regranted);
    await expect(disable(target, manager, randomUUID())).resolves.toEqual({
      changed: true,
    });
    expect((await db.doc(`users/${target.uid}`).get()).data()).toMatchObject({
      enabled: false,
      accessVersion: 3,
    });
  });

  it("a new disable request invalidates a new invitation even when already disabled", async () => {
    const target = await principal();
    await disable(target);
    const invitation = await invite(target);
    await disable(target);
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
    expect(
      (await db.doc(`users/${target.uid}`).get()).data()?.accessVersion,
    ).toBe(2);
  });

  it("will not overwrite an existing active member or elevate a special role", async () => {
    const active = await principal({ membership: memberRecord });
    await denied(invite(active), "already-exists");
    for (const membership of [
      { ...memberRecord, enabled: false, roleIds: ["editor"] },
      { ...memberRecord, enabled: false, canManageMembership: true },
    ]) {
      const target = await principal({ membership });
      await denied(invite(target), "permission-denied");
      await denied(disable(target), "permission-denied");
    }
  });

  it("does not allow a manager to invite or disable itself", async () => {
    await denied(invite(manager), "failed-precondition");
    await denied(disable(manager), "permission-denied");
    expect((await db.doc(`users/${manager.uid}`).get()).data()?.enabled).toBe(
      true,
    );
  });

  it("rejects protected-role changes made after the invitation was issued", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await db
      .doc(`users/${target.uid}`)
      .set({ ...memberRecord, enabled: false, roleIds: ["approver"] });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "permission-denied",
    );
    expect((await db.doc(`users/${target.uid}`).get()).data()?.roleIds).toEqual(
      ["approver"],
    );
  });

  it("rejects malformed persisted invitation schemas instead of opening membership", async () => {
    for (const patch of [
      { schemaVersion: 2 },
      { issuerUid: "bad/path" },
      { issuerUid: null },
      { issuerAccessVersion: null },
      { targetAccessVersion: -1 },
      { expiresAt: "not-a-timestamp" },
    ]) {
      const target = await principal();
      const invitation = await invite(target);
      await db.doc(`invitations/${invitation.invitationId}`).update(patch);
      await denied(
        target.call("acceptInvitation", { token: invitation.token }),
        "failed-precondition",
      );
      expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
    }
  });

  it("rejects malformed membership records and explicit null access versions", async () => {
    for (const membership of [
      { ...memberRecord, enabled: false, accessVersion: null },
      { ...memberRecord, enabled: false, canManageMembership: "true" },
      { ...memberRecord, enabled: "false" },
    ]) {
      const target = await principal({ membership });
      await expect(invite(target)).rejects.toMatchObject({
        code: expect.stringMatching(
          /^functions\/(permission-denied|failed-precondition)$/,
        ),
      });
    }
  });

  it("invalidates a second pending invitation after the first is consumed", async () => {
    const target = await principal();
    const first = await invite(target);
    const second = await invite(target);
    await target.call("acceptInvitation", { token: first.token });
    await denied(
      target.call("acceptInvitation", { token: second.token }),
      "failed-precondition",
    );
    expect(
      (await db.doc(`users/${target.uid}`).get()).data()?.accessVersion,
    ).toBe(1);
  });

  it("rolls back membership and invitation status when the audit write cannot commit", async () => {
    const target = await principal();
    const invitation = await invite(target);
    await db
      .doc(`auditLogs/invitation-accepted-${invitation.invitationId}`)
      .create({ event: "FAKE_CONFLICT_FIXTURE" });
    await denied(
      target.call("acceptInvitation", { token: invitation.token }),
      "internal",
    );
    expect((await db.doc(`users/${target.uid}`).get()).exists).toBe(false);
    expect(
      (await db.doc(`invitations/${invitation.invitationId}`).get()).data()
        ?.status,
    ).toBe("PENDING");
  });

  it("does not transfer an invitation to a newly created Auth UID reusing the same email", async () => {
    const original = await principal();
    const invitation = await invite(original);
    await adminAuth.deleteUser(original.uid);
    const replacementUid = `membership-${randomUUID()}`;
    await adminAuth.createUser({
      uid: replacementUid,
      email: original.email,
      password,
      emailVerified: true,
    });
    const replacement = client();
    await signInWithEmailAndPassword(
      replacement.auth,
      original.email,
      password,
    );
    await denied(
      replacement.call("acceptInvitation", { token: invitation.token }),
      "failed-precondition",
    );
    expect((await db.doc(`users/${replacementUid}`).get()).exists).toBe(false);
  });

  it("rejects a future issuer membership schema instead of assuming its privilege semantics", async () => {
    const issuer = await principal({
      membership: {
        ...memberRecord,
        canManageMembership: true,
        schemaVersion: 2,
      },
    });
    const target = await principal();
    await expect(invite(target, issuer)).rejects.toMatchObject({
      code: expect.stringMatching(
        /^functions\/(permission-denied|failed-precondition)$/,
      ),
    });
  });

  it("keeps invitations and audits closed to direct client SDK access, even for managers", async () => {
    const target = await principal();
    const invitation = await invite(target);
    for (const session of [target, manager]) {
      for (const path of ["invitations", "auditLogs"]) {
        const id =
          path === "invitations"
            ? invitation.invitationId
            : `invitation-created-${invitation.invitationId}`;
        await expect(
          getDoc(doc(session.firestore, path, id)),
        ).rejects.toMatchObject({ code: "permission-denied" });
        await expect(
          getDocs(collection(session.firestore, path)),
        ).rejects.toMatchObject({ code: "permission-denied" });
        await expect(
          setDoc(doc(session.firestore, path, "client-attack"), {
            enabled: true,
            status: "ACCEPTED",
          }),
        ).rejects.toMatchObject({ code: "permission-denied" });
      }
    }
  });
});
