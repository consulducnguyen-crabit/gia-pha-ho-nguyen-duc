// Chạy createInvite/revokeInvite/acceptInvitation/readOwnInvite/listInvites thật qua firestore.rules trên emulator.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  InviteError,
  SERVER_TIME,
  acceptInvitation,
  buildAcceptance,
  buildInvite,
  createInvite,
  inviteErrorMessage,
  listInvites,
  readOwnInvite,
  revokeInvite,
} from "../src/invitesClient";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha-invites-client",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}, 30000);
afterAll(async () => {
  await env?.cleanup();
});
const NONCE = "11111111-1111-4111-8111-111111111111";
const sha = (k: string) => createHash("sha256").update(k).digest("hex");
const user = (extra: object = {}) => ({
  enabled: true,
  roleIds: ["member"],
  canManageMembership: false,
  accessVersion: 1,
  schemaVersion: 1,
  ...extra,
});
const inviteDoc = (over: object = {}) => ({
  email: "new1@example.test",
  role: "VIEWER",
  displayName: "Người được mời giả",
  status: "PENDING",
  nonce: NONCE,
  createdBy: "a1",
  createdAt: Timestamp.now(),
  expiresAt: Timestamp.fromMillis(Date.now() + 3 * 86400000),
  schemaVersion: 1,
  ...over,
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const u of ["a1", "a2"])
      await setDoc(doc(db, "users", u), user({ canManageMembership: true }));
    await setDoc(
      doc(db, "users", "off"),
      user({ enabled: false, email: "off@example.test" }),
    );
    await setDoc(doc(db, "accessControl", "admins"), {
      adminUids: ["a1", "a2"],
      version: 1,
      lastTargetUid: "",
      schemaVersion: 1,
    });
    await setDoc(doc(db, "accountInvites", "new1@example.test"), inviteDoc());
  });
});
const admin = (uid: string) =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;
const guest = (
  uid: string,
  email: string,
  verified = true,
  provider = "google.com",
) =>
  env
    .authenticatedContext(uid, {
      email,
      email_verified: verified,
      firebase: { sign_in_provider: provider as "password" },
    })
    .firestore() as unknown as Firestore;
const read = async (path: string, id: string) => {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (c) => {
    data = (await getDoc(doc(c.firestore(), path, id))).data();
  });
  return data;
};
const seed = (id: string, data: object) =>
  env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "accountInvites", id), data);
  });
const rejects = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e).not.toBeNull();
  return e as { code?: string };
};

describe("tạo, ghi đè, thu hồi lời mời qua rules", () => {
  it("tạo lời mời: dữ liệu và nhật ký đúng, nhật ký không có email", async () => {
    const r = await createInvite(admin("a1"), "a1", {
      email: "Moi@Example.test",
      displayName: "Người Mời",
    });
    expect(r.emailKey).toBe("moi@example.test");
    const inv = await read("accountInvites", "moi@example.test");
    expect(inv).toMatchObject({
      role: "VIEWER",
      status: "PENDING",
      createdBy: "a1",
      displayName: "Người Mời",
    });
    const audit = await read("auditLogs", `invite-${inv?.nonce as string}`);
    expect(audit).toMatchObject({
      event: "INVITE_CREATED",
      actorUid: "a1",
      inviteKey: sha("moi@example.test"),
    });
    expect(JSON.stringify(audit)).not.toContain("@");
  });
  it("lời mời còn hiệu lực bị chặn phía client", async () => {
    await expect(
      createInvite(admin("a1"), "a1", { email: "new1@example.test" }),
    ).rejects.toMatchObject({ code: "ACTIVE_INVITE" });
  });
  it("ghi đè (mời lại) lời mời hết hạn, đã thu hồi, đã dùng", async () => {
    await seed(
      "het@example.test",
      inviteDoc({
        email: "het@example.test",
        expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      }),
    );
    await seed(
      "thu@example.test",
      inviteDoc({
        email: "thu@example.test",
        status: "REVOKED",
        revokedBy: "a1",
        revokedAt: Timestamp.now(),
      }),
    );
    await seed(
      "dung@example.test",
      inviteDoc({
        email: "dung@example.test",
        status: "ACCEPTED",
        acceptedBy: "x",
        acceptedAt: Timestamp.now(),
      }),
    );
    for (const k of ["het", "thu", "dung"]) {
      await createInvite(admin("a1"), "a1", { email: `${k}@example.test` });
      expect((await read("accountInvites", `${k}@example.test`))?.status).toBe(
        "PENDING",
      );
    }
  });
  it("thành viên thường và admin không có trong sổ không tạo được", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users", "m1"), user());
    });
    const e = await rejects(
      createInvite(admin("m1"), "m1", { email: "z@example.test" }),
    );
    expect(inviteErrorMessage(e)).toMatch(/Không tạo được lời mời/);
  });
  it("thu hồi bởi người phát hành và bởi quản trị viên khác; nhật ký mang uid người thu hồi", async () => {
    await revokeInvite(admin("a2"), "a2", {
      email: "new1@example.test",
      nonce: NONCE,
    });
    expect(await read("accountInvites", "new1@example.test")).toMatchObject({
      status: "REVOKED",
      revokedBy: "a2",
    });
    expect(await read("auditLogs", `invite-${NONCE}-revoked-a2`)).toMatchObject(
      { event: "INVITE_REVOKED", actorUid: "a2" },
    );
    // đã thu hồi thì thu hồi lại bị rules chặn
    const e = await rejects(
      revokeInvite(admin("a1"), "a1", {
        email: "new1@example.test",
        nonce: NONCE,
      }),
    );
    expect(inviteErrorMessage(e, "revoke")).toMatch(/Không thu hồi được/);
  });
  it("danh sách lời mời: quản trị viên đọc được (mới nhất trước), người khác không", async () => {
    await createInvite(admin("a1"), "a1", { email: "sau@example.test" });
    const rows = await listInvites(admin("a1"));
    expect(rows.length).toBe(2);
    const times = rows.map((r) => (r.data.createdAt as Timestamp).toMillis());
    expect(times[0]).toBeGreaterThanOrEqual(times[1]);
    await rejects(listInvites(guest("g1", "new1@example.test")));
  });
});

describe("nhận lời mời qua rules", () => {
  for (const provider of ["google.com", "password"])
    it(`nhận lời mời bằng ${provider}`, async () => {
      const db = guest("u1", "New1@Example.test", true, provider);
      const own = await readOwnInvite(db, {
        email: "New1@Example.test",
        emailVerified: true,
      });
      expect(own.status).toBe("PENDING");
      await acceptInvitation(db, {
        uid: "u1",
        email: "New1@Example.test",
        emailVerified: true,
      });
      expect(await read("users", "u1")).toMatchObject({
        enabled: true,
        roleIds: ["member"],
        canManageMembership: false,
        accessVersion: 1,
        email: "new1@example.test",
        displayName: "Người được mời giả",
        approvedBy: "a1",
        invitationNonce: NONCE,
      });
      expect(await read("accountInvites", "new1@example.test")).toMatchObject({
        status: "ACCEPTED",
        acceptedBy: "u1",
      });
      expect(await read("auditLogs", "account-u1-1")).toMatchObject({
        event: "INVITATION_ACCEPTED",
        actorUid: "u1",
      });
    });
  it("lời mời hết hạn, đã thu hồi, đã dùng không nhận được", async () => {
    for (const over of [
      { expiresAt: Timestamp.fromMillis(Date.now() - 1000) },
      { status: "REVOKED" },
      { status: "ACCEPTED" },
    ]) {
      await seed("new1@example.test", inviteDoc(over));
      const e = await rejects(
        acceptInvitation(guest("u1", "new1@example.test"), {
          uid: "u1",
          email: "new1@example.test",
          emailVerified: true,
        }),
      );
      expect(e).toBeInstanceOf(InviteError);
      expect(await read("users", "u1")).toBeUndefined();
    }
  });
  it("email chưa xác minh (client khai gian hoặc đúng) không nhận được", async () => {
    await rejects(
      acceptInvitation(guest("u1", "new1@example.test", false), {
        uid: "u1",
        email: "new1@example.test",
        emailVerified: false,
      }),
    );
    // client khai emailVerified=true nhưng token chưa xác minh: rules chặn
    await rejects(
      acceptInvitation(guest("u1", "new1@example.test", false), {
        uid: "u1",
        email: "new1@example.test",
        emailVerified: true,
      }),
    );
    expect(await read("users", "u1")).toBeUndefined();
    const own = await readOwnInvite(guest("u1", "new1@example.test", false), {
      email: "new1@example.test",
      emailVerified: false,
    });
    expect(own.status).toBeNull();
  });
  it("người đã có users (kể cả đã tắt) không nhận được", async () => {
    await seed("off@example.test", inviteDoc({ email: "off@example.test" }));
    const e = await rejects(
      acceptInvitation(guest("off", "off@example.test"), {
        uid: "off",
        email: "off@example.test",
        emailVerified: true,
      }),
    );
    expect(e.code).toBe("permission-denied");
    expect(inviteErrorMessage(e, "accept")).toMatch(/Không nhận được lời mời/);
    expect((await read("users", "off"))?.enabled).toBe(false);
  });
  it("email khác không đọc được lời mời của người khác; người phát hành bị gỡ khỏi sổ làm lời mời vô hiệu", async () => {
    const own = await readOwnInvite(guest("u2", "khac@example.test"), {
      email: "khac@example.test",
      emailVerified: true,
    });
    expect(own.status).toBeNull();
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "accessControl", "admins"), {
        adminUids: ["a2"],
        version: 2,
        lastTargetUid: "a1",
        schemaVersion: 1,
      });
    });
    await rejects(
      acceptInvitation(guest("u1", "new1@example.test"), {
        uid: "u1",
        email: "new1@example.test",
        emailVerified: true,
      }),
    );
  });
  it("nhận lời mời lần hai (cùng email, uid khác) thất bại", async () => {
    await acceptInvitation(guest("u1", "new1@example.test"), {
      uid: "u1",
      email: "new1@example.test",
      emailVerified: true,
    });
    await rejects(
      acceptInvitation(guest("u2", "new1@example.test"), {
        uid: "u2",
        email: "new1@example.test",
        emailVerified: true,
      }),
    );
  });
});

// Các ca chạm tới RULES (không chỉ kiểm phía client): dựng lô thô với dữ liệu "client khai gian".
const stamp = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v === SERVER_TIME ? serverTimestamp() : v,
    ]),
  );
async function rawAccept(
  db: Firestore,
  uid: string,
  email: string,
  forgedInvite: Record<string, unknown>,
) {
  // nowMs đặt trước hạn để hàm dựng phía client không chặn trước; rules phải tự chặn.
  const built = buildAcceptance({
    uid,
    email,
    emailVerified: true,
    invite: forgedInvite,
    nowMs: Date.now() - 86400000 * 30,
  });
  const b = writeBatch(db);
  b.set(doc(db, "users", uid), stamp(built.user));
  b.update(doc(db, "accountInvites", built.emailKey), stamp(built.invitePatch));
  b.set(doc(db, "auditLogs", built.auditId), stamp(built.audit));
  await b.commit();
}
describe("rules chặn dù client khai gian", () => {
  const forged = (over: object = {}) =>
    inviteDoc({
      expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
      ...over,
    });
  it("provider anonymous / custom bị chặn dù lời mời hợp lệ", async () => {
    for (const provider of ["anonymous", "custom"]) {
      const e = await rejects(
        rawAccept(
          guest("u1", "new1@example.test", true, provider),
          "u1",
          "new1@example.test",
          forged(),
        ),
      );
      expect(e.code).toBe("permission-denied");
    }
    expect(await read("users", "u1")).toBeUndefined();
  });
  it("lời mời thật đã hết hạn / thu hồi / đã dùng: rules chặn dù client khai là PENDING còn hạn", async () => {
    for (const real of [
      { expiresAt: Timestamp.fromMillis(Date.now() - 1000) },
      { status: "REVOKED" },
      { status: "ACCEPTED" },
    ]) {
      await seed("new1@example.test", inviteDoc(real));
      const e = await rejects(
        rawAccept(
          guest("u1", "new1@example.test"),
          "u1",
          "new1@example.test",
          forged(),
        ),
      );
      expect(e.code).toBe("permission-denied");
      expect(await read("users", "u1")).toBeUndefined();
    }
  });
  it("đồng hồ máy khách lệch: hạn +1 giờ so với giờ máy chủ vẫn qua, +3 giờ bị rules chặn", async () => {
    const make = async (skewMs: number, email: string) => {
      const built = await buildInvite({
        actorUid: "a1",
        email,
        nonce: crypto.randomUUID(),
        nowMs: Date.now() + skewMs,
      });
      const db = admin("a1");
      const b = writeBatch(db);
      b.set(doc(db, "accountInvites", built.emailKey), stamp(built.invite));
      b.set(doc(db, "auditLogs", built.auditId), stamp(built.audit));
      await b.commit();
    };
    await make(3600000, "skew1@example.test");
    const e = await rejects(make(3 * 3600000, "skew3@example.test"));
    expect(e.code).toBe("permission-denied");
  });
});
