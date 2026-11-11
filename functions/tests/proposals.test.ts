import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  initializeApp as initializeAdmin,
  deleteApp as deleteAdmin,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
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
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import {
  normalizeName,
  type Operation,
  type PersonOperation,
  type RelationOperation,
} from "../src/proposalValidation";

const admin = initializeAdmin(
  { projectId: "demo-gia-pha" },
  `proposal-tests-${randomUUID()}`,
);
const db = getAdminFirestore(admin);
const authAdmin = getAdminAuth(admin);
const apps: FirebaseApp[] = [];
const password = "Fake-Proposal-2026!";
type RecordResult = {
  requestId: string;
  authorUid: string;
  status: string;
  revision: number;
  operation: Operation;
  before: Record<string, unknown>;
  requiredApprovals: number;
  approvalCount: number;
  reviewNote: string;
};
const membership = {
  enabled: true,
  roleIds: ["member"],
  accessVersion: 1,
  schemaVersion: 1,
};
function client() {
  const app = initializeApp(
    { apiKey: "demo-key", projectId: "demo-gia-pha" },
    randomUUID(),
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  return {
    auth,
    firestore,
    async call<T = RecordResult>(name: string, data: unknown): Promise<T> {
      return (await httpsCallable<unknown, T>(functions, name)(data)).data;
    },
  };
}
type Session = ReturnType<typeof client> & { uid: string; email: string };
async function principal(
  extra: Record<string, unknown> = {},
  options: {
    verified?: boolean;
    membership?: boolean;
    claims?: Record<string, unknown>;
  } = {},
): Promise<Session> {
  const uid = `proposal-${randomUUID()}`,
    email = `${uid}@example.test`;
  await authAdmin.createUser({
    uid,
    email,
    password,
    emailVerified: options.verified ?? true,
  });
  if (options.membership !== false)
    await db.doc(`users/${uid}`).set({ ...membership, ...extra });
  if (options.claims) await authAdmin.setCustomUserClaims(uid, options.claims);
  const session = client();
  await signInWithEmailAndPassword(session.auth, email, password);
  return { ...session, uid, email };
}
function personOperation(
  overrides: Partial<PersonOperation> = {},
): PersonOperation {
  return {
    kind: "PERSON_BASIC",
    personId: randomUUID(),
    baseVersion: 0,
    displayName: "Nhân vật giả mới",
    evidence: "Căn cứ giả cho kiểm thử",
    ...overrides,
  };
}
async function person(
  id: string = randomUUID(),
  extra: Record<string, unknown> = {},
) {
  const record = {
    displayName: `Nhân vật giả ${id.slice(0, 8)}`,
    normalizedName: `nhan vat gia ${id.slice(0, 8)}`,
    profileVersion: 1,
    schemaVersion: 1,
  };
  await db.doc(`persons/${id}`).set({ ...record, ...extra });
  await db.doc(`memberProfiles/${id}`).set(record);
  return id;
}
async function relationOperation(
  overrides: Partial<RelationOperation> = {},
): Promise<RelationOperation> {
  return {
    kind: "RELATION_CREATE",
    relationId: randomUUID(),
    parentId: await person(),
    childId: await person(),
    parentRole: "FATHER",
    relationType: "BIOLOGICAL",
    lineageTransmission: true,
    lineageReason: "Truyền dòng giả được xác minh riêng",
    evidence: "Nguồn giả đã kiểm tra",
    ...overrides,
  };
}
async function deny(promise: Promise<unknown>, code?: string) {
  if (code)
    await expect(promise).rejects.toMatchObject({ code: `functions/${code}` });
  else await expect(promise).rejects.toHaveProperty("code");
}
let author: Session, reviewer1: Session, reviewer2: Session;
async function draft(
  operation: Operation = personOperation(),
  owner: Session = author,
) {
  return owner.call("createChangeDraft", {
    requestId: randomUUID(),
    operation,
  });
}
async function submit(record: RecordResult, owner: Session = author) {
  return owner.call("submitChangeRequest", {
    requestId: record.requestId,
    expectedRevision: record.revision,
  });
}
async function review(
  record: RecordResult,
  who: Session = reviewer1,
  decision = "APPROVE",
  note = "",
) {
  return who.call("reviewChangeRequest", {
    requestId: record.requestId,
    expectedRevision: record.revision,
    decision,
    note,
  });
}
async function clearGraph() {
  const existing = await db.collection("relations").get();
  const batch = db.batch();
  for (const document of existing.docs) batch.delete(document.ref);
  batch.delete(db.doc("graphState/parentage"));
  await batch.commit();
}
beforeAll(async () => {
  if (
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
  )
    throw Error(
      "Proposal integration tests require fixed local demo emulators.",
    );
  reviewer1 = await principal({
    canReviewChanges: true,
    canReviewLineage: true,
  });
  reviewer2 = await principal({
    canReviewChanges: true,
    canReviewLineage: true,
  });
}, 60000);
beforeEach(async () => {
  await clearGraph();
  for (const reviewer of [reviewer1, reviewer2])
    await db
      .doc(`users/${reviewer.uid}`)
      .set({ ...membership, canReviewChanges: true, canReviewLineage: true });
  author = await principal();
}, 30000);
afterEach(clearGraph, 30000);
afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await deleteAdmin(admin);
});

describe("proposal callable workflow on real emulators", () => {
  it("excludes the reviewer's own requests before applying the queue limit", async () => {
    const viewer = await principal({
      canReviewChanges: true,
      canReviewLineage: true,
    });
    const own = await submit(await draft(personOperation(), viewer), viewer);
    const template = (
      await db.doc(`changeRequests/${own.requestId}`).get()
    ).data()!;
    const copies = Array.from({ length: 31 }, (_, index) =>
      db.doc(
        `changeRequests/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    );
    const batch = db.batch();
    for (const copy of copies) batch.create(copy, template);
    await batch.commit();
    try {
      await submit(await draft());
      const result = await viewer.call<{ items: RecordResult[] }>(
        "listChangeRequests",
        { scope: "REVIEW" },
      );
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.authorUid !== viewer.uid)).toBe(
        true,
      );
    } finally {
      const cleanup = db.batch();
      for (const copy of copies) cleanup.delete(copy);
      await cleanup.commit();
    }
  });
  it("creates a draft without canonical writes and publishes only the approved basic allowlist atomically", async () => {
    const op = personOperation();
    const created = await draft(op);
    expect(created).toMatchObject({
      status: "DRAFT",
      revision: 1,
      requiredApprovals: 1,
      approvalCount: 0,
      before: { displayName: null, profileVersion: 0 },
    });
    expect((await db.doc(`persons/${op.personId}`).get()).exists).toBe(false);
    const submitted = await submit(created);
    const approved = await review(submitted);
    expect(approved.status).toBe("APPROVED");
    const expected = {
      displayName: op.displayName,
      normalizedName: normalizeName(op.displayName),
      profileVersion: 1,
      schemaVersion: 1,
    };
    expect((await db.doc(`persons/${op.personId}`).get()).data()).toEqual(
      expected,
    );
    expect(
      (await db.doc(`memberProfiles/${op.personId}`).get()).data(),
    ).toEqual(expected);
    expect(
      (await db.doc(`proposalRevisions/${created.requestId}-r1`).get()).data()
        ?.operation,
    ).toEqual(op);
    const audit = await db
      .collection("auditLogs")
      .where("requestId", "==", created.requestId)
      .get();
    expect(
      audit.docs.some((doc) => doc.data().event === "CHANGE_APPLIED"),
    ).toBe(true);
    for (const doc of audit.docs) {
      expect(JSON.stringify(doc.data()).includes(op.displayName)).toBe(false);
      expect(JSON.stringify(doc.data()).includes(op.evidence)).toBe(false);
    }
  });

  it("preserves private canonical fields while filtering before/after and rebuilding the four-field projection", async () => {
    const id = await person(undefined, {
      privateNote: "Bí mật giả không được công bố",
      birth: { day: 1, month: 2, year: 2000 },
    });
    const created = await draft(
      personOperation({
        personId: id,
        baseVersion: 1,
        displayName: "Tên giả đã sửa",
      }),
    );
    const fetched = await reviewer1.call("getChangeRequest", {
      requestId: (await submit(created)).requestId,
    });
    expect(JSON.stringify(fetched).includes("Bí mật giả")).toBe(false);
    expect(fetched.before).toEqual({
      displayName: expect.any(String),
      profileVersion: 1,
    });
    await review(created);
    expect((await db.doc(`persons/${id}`).get()).data()?.privateNote).toBe(
      "Bí mật giả không được công bố",
    );
    const projected = (await db.doc(`memberProfiles/${id}`).get()).data()!;
    expect(Object.keys(projected).sort()).toEqual([
      "displayName",
      "normalizedName",
      "profileVersion",
      "schemaVersion",
    ]);
    expect(projected.profileVersion).toBe(2);
  });

  it("requires two distinct eligible reviewers for lineage and never treats adoption as automatic transmission", async () => {
    const operation = await relationOperation({ relationType: "ADOPTIVE" });
    const record = await submit(await draft(operation));
    const first = await review(record);
    expect(first).toMatchObject({
      status: "SUBMITTED",
      requiredApprovals: 2,
      approvalCount: 1,
    });
    expect(
      (await db.doc(`relations/${operation.relationId}`).get()).exists,
    ).toBe(false);
    const duplicate = await review(record);
    expect(duplicate.approvalCount).toBe(1);
    const final = await review(record, reviewer2);
    expect(final).toMatchObject({ status: "APPROVED", approvalCount: 2 });
    expect(
      (await db.doc(`relations/${operation.relationId}`).get()).data(),
    ).toMatchObject({
      relationType: "ADOPTIVE",
      lineageTransmission: true,
      sourceRefs: [`proposalRevisions/${record.requestId}-r1`],
    });
  });

  it("allows one explicitly authorized review for a non-lineage relationship", async () => {
    const operation = await relationOperation({
      lineageTransmission: false,
      lineageReason: "",
    });
    const ordinaryReviewer = await principal({ canReviewChanges: true });
    expect(
      (await review(await submit(await draft(operation)), ordinaryReviewer))
        .status,
    ).toBe("APPROVED");
  });

  it("forbids author self-review for every decision even when the author has reviewer capabilities", async () => {
    await db
      .doc(`users/${author.uid}`)
      .update({ canReviewChanges: true, canReviewLineage: true });
    const record = await submit(await draft());
    for (const decision of ["APPROVE", "REJECT", "NEEDS_INFO"])
      await deny(
        review(record, author, decision, "Ghi chú giả"),
        "permission-denied",
      );
  });

  it("clears votes on needs-info, requires an edit and archives each immutable revision", async () => {
    const operation = await relationOperation();
    const initial = await submit(await draft(operation));
    await review(initial);
    const info = await review(
      initial,
      reviewer2,
      "NEEDS_INFO",
      "Bổ sung nguồn giả",
    );
    expect(info).toMatchObject({
      status: "NEEDS_INFO",
      approvalCount: 0,
      reviewNote: "Bổ sung nguồn giả",
    });
    await deny(submit(info), "failed-precondition");
    const edited = await author.call("editChangeDraft", {
      requestId: initial.requestId,
      expectedRevision: 1,
      operation: { ...operation, evidence: "Nguồn giả đã bổ sung" },
    });
    expect(edited).toMatchObject({
      status: "DRAFT",
      revision: 2,
      approvalCount: 0,
    });
    expect(
      (await db.doc(`proposalRevisions/${initial.requestId}-r1`).get()).data()
        ?.operation.evidence,
    ).toBe(operation.evidence);
    expect(
      (await db.doc(`proposalRevisions/${initial.requestId}-r2`).get()).exists,
    ).toBe(true);
    const resubmitted = await submit(edited);
    await deny(review(initial), "failed-precondition");
    expect((await review(resubmitted)).status).toBe("SUBMITTED");
    expect((await review(resubmitted, reviewer2)).status).toBe("APPROVED");
  });

  it("keeps rejection terminal and does not apply canonical records", async () => {
    const operation = personOperation();
    const record = await submit(await draft(operation));
    expect(
      (await review(record, reviewer1, "REJECT", "Nguồn giả chưa phù hợp"))
        .status,
    ).toBe("REJECTED");
    await deny(
      author.call("editChangeDraft", {
        requestId: record.requestId,
        expectedRevision: 1,
        operation,
      }),
      "failed-precondition",
    );
    await deny(submit(record), "failed-precondition");
    await deny(review(record), "failed-precondition");
    expect((await db.doc(`persons/${operation.personId}`).get()).exists).toBe(
      false,
    );
  });

  it("requires an explicit note for rejection and needs-info and rejects client approval fields", async () => {
    const record = await submit(await draft());
    for (const decision of ["REJECT", "NEEDS_INFO"])
      await deny(review(record, reviewer1, decision), "invalid-argument");
    await deny(
      author.call("createChangeDraft", {
        requestId: randomUUID(),
        operation: { ...personOperation(), approvedBy: reviewer1.uid },
      }),
      "invalid-argument",
    );
    await deny(
      reviewer1.call("reviewChangeRequest", {
        requestId: record.requestId,
        expectedRevision: 1,
        decision: "APPROVE",
        note: "",
        requiredApprovals: 0,
      }),
      "invalid-argument",
    );
  });

  it("invalidates an existing vote after reviewer revocation and allows only a fresh authorized vote", async () => {
    const record = await submit(await draft(await relationOperation()));
    await review(record);
    await db
      .doc(`users/${reviewer1.uid}`)
      .update({ enabled: false, accessVersion: 2 });
    const second = await review(record, reviewer2);
    expect(second).toMatchObject({ status: "SUBMITTED", approvalCount: 1 });
    await db
      .doc(`users/${reviewer1.uid}`)
      .update({ enabled: true, accessVersion: 3 });
    expect((await review(record)).status).toBe("APPROVED");
  });

  it("invalidates a vote when the server-side capability snapshot changed without an epoch bump", async () => {
    const record = await submit(await draft(await relationOperation()));
    await review(record);
    await db
      .doc(`users/${reviewer1.uid}`)
      .update({ fixtureReviewMarker: randomUUID() });
    expect(await review(record, reviewer2)).toMatchObject({
      status: "SUBMITTED",
      approvalCount: 1,
    });
    expect((await review(record)).status).toBe("APPROVED");
  });

  it("reports live vote counts consistently on read and retry paths after a voter loses authority", async () => {
    const operation = await relationOperation();
    const record = await submit(await draft(operation));
    await review(record);
    await db
      .doc(`users/${reviewer1.uid}`)
      .update({ enabled: false, accessVersion: 2 });
    const fetched = await author.call("getChangeRequest", {
      requestId: record.requestId,
    });
    const retriedCreate = await author.call("createChangeDraft", {
      requestId: record.requestId,
      operation,
    });
    const retriedSubmit = await submit(record);
    const listed = await author.call<{ items: RecordResult[] }>(
      "listChangeRequests",
      { scope: "OWN" },
    );
    expect([
      fetched.approvalCount,
      retriedCreate.approvalCount,
      retriedSubmit.approvalCount,
      listed.items.find((item) => item.requestId === record.requestId)
        ?.approvalCount,
    ]).toEqual([0, 0, 0, 0]);
    expect(
      (await db.doc(`relations/${operation.relationId}`).get()).exists,
    ).toBe(false);
  });

  it("rechecks author membership and Auth status before final application", async () => {
    const operation = await relationOperation();
    const record = await submit(await draft(operation));
    await review(record);
    await db
      .doc(`users/${author.uid}`)
      .update({ enabled: false, accessVersion: 2 });
    await deny(review(record, reviewer2), "permission-denied");
    await db.doc(`users/${author.uid}`).update({ enabled: true });
    await authAdmin.updateUser(author.uid, { disabled: true });
    await deny(review(record, reviewer2), "permission-denied");
    expect(
      (await db.doc(`relations/${operation.relationId}`).get()).exists,
    ).toBe(false);
  });

  it("does not overwrite a newer person version or mutate status on final conflict", async () => {
    const id = await person();
    const record = await submit(
      await draft(personOperation({ personId: id, baseVersion: 1 })),
    );
    await db.doc(`persons/${id}`).update({ profileVersion: 2 });
    await db.doc(`memberProfiles/${id}`).update({ profileVersion: 2 });
    await deny(review(record), "failed-precondition");
    expect(
      (await db.doc(`changeRequests/${record.requestId}`).get()).data()?.status,
    ).toBe("SUBMITTED");
    expect((await db.doc(`persons/${id}`).get()).data()?.profileVersion).toBe(
      2,
    );
  });

  it("binds relation endpoint snapshots so names changed after review cannot silently pass", async () => {
    const operation = await relationOperation();
    const record = await submit(await draft(operation));
    await review(record);
    await db.doc(`persons/${operation.parentId}`).update({ profileVersion: 2 });
    await db
      .doc(`memberProfiles/${operation.parentId}`)
      .update({ profileVersion: 2 });
    await deny(review(record, reviewer2), "failed-precondition");
    expect(
      (await db.doc(`relations/${operation.relationId}`).get()).exists,
    ).toBe(false);
  });

  it("serializes concurrent final approvals and records the canonical application once", async () => {
    const operation = await relationOperation();
    const record = await submit(await draft(operation));
    const outcomes = await Promise.all([
      review(record),
      review(record, reviewer2),
    ]);
    expect(outcomes.some((item) => item.status === "APPROVED")).toBe(true);
    expect((await db.collection("relations").get()).size).toBe(1);
    expect((await db.doc("graphState/parentage").get()).data()?.version).toBe(
      1,
    );
    const audits = await db
      .collection("auditLogs")
      .where("requestId", "==", record.requestId)
      .where("event", "==", "CHANGE_APPLIED")
      .get();
    expect(audits.size).toBe(1);
    await review(record);
    expect((await db.doc("graphState/parentage").get()).data()?.version).toBe(
      1,
    );
  });

  it("never reapplies an approved request after canonical data changes later", async () => {
    const operation = personOperation();
    const record = await submit(await draft(operation));
    await review(record);
    await db.doc(`persons/${operation.personId}`).update({
      profileVersion: 2,
      displayName: "Tên mới hơn",
      normalizedName: "ten moi hon",
    });
    await db.doc(`memberProfiles/${operation.personId}`).update({
      profileVersion: 2,
      displayName: "Tên mới hơn",
      normalizedName: "ten moi hon",
    });
    expect((await review(record, reviewer2)).status).toBe("APPROVED");
    expect(
      (await db.doc(`persons/${operation.personId}`).get()).data()?.displayName,
    ).toBe("Tên mới hơn");
  });

  it("serializes competing inverse edges so concurrent proposals cannot create an ancestor cycle", async () => {
    const a = await person(),
      b = await person();
    const forward = await relationOperation({
      parentId: a,
      childId: b,
      lineageTransmission: false,
      lineageReason: "",
    });
    const backward = await relationOperation({
      parentId: b,
      childId: a,
      lineageTransmission: false,
      lineageReason: "",
    });
    const first = await submit(await draft(forward)),
      second = await submit(await draft(backward));
    const outcomes = await Promise.allSettled([
      review(first),
      review(second, reviewer2),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await db.collection("relations").get()).size).toBe(1);
    expect((await db.doc("graphState/parentage").get()).data()?.version).toBe(
      1,
    );
  });

  it("rejects duplicate pairs, biological slot conflicts and multiple incoming lineage without overriding the old edge", async () => {
    const operation = await relationOperation();
    await review(await review(await submit(await draft(operation))), reviewer2);
    for (const variant of [
      {
        ...operation,
        relationId: randomUUID(),
        relationType: "ADOPTIVE" as const,
      },
      {
        ...operation,
        relationId: randomUUID(),
        parentId: await person(),
        lineageTransmission: false,
        lineageReason: "",
      },
      {
        ...operation,
        relationId: randomUUID(),
        parentId: await person(),
        parentRole: "MOTHER" as const,
        relationType: "ADOPTIVE" as const,
      },
    ]) {
      const record = await submit(await draft(variant));
      if (variant.lineageTransmission) await review(record);
      await deny(review(record, reviewer2), "failed-precondition");
    }
    expect((await db.collection("relations").get()).size).toBe(1);
  });

  it("accepts explicit father and mother roles without assuming either one transmits lineage", async () => {
    const operation = await relationOperation({
      lineageTransmission: false,
      lineageReason: "",
    });
    await review(await submit(await draft(operation)));
    const mother = {
      ...operation,
      relationId: randomUUID(),
      parentId: await person(),
      parentRole: "MOTHER" as const,
    };
    expect((await review(await submit(await draft(mother)))).status).toBe(
      "APPROVED",
    );
    expect((await db.collection("relations").get()).size).toBe(2);
  });

  it("fails closed for dangling endpoints, malformed historical edges and an unrelated legacy cycle", async () => {
    const operation = await relationOperation({
      lineageTransmission: false,
      lineageReason: "",
    });
    const record = await submit(await draft(operation));
    await db.doc(`persons/${operation.parentId}`).delete();
    await deny(review(record), "failed-precondition");
    await person(operation.parentId);
    await db.doc("relations/fake-malformed").set({
      parentId: "missing",
      childId: "other",
      lineageTransmission: true,
    });
    await deny(review(record), "failed-precondition");
    await clearGraph();
    const a = await person(),
      b = await person();
    const old = {
      schemaVersion: 1,
      version: 1,
      parentRole: "FATHER",
      relationType: "BIOLOGICAL",
      lineageTransmission: false,
      verificationStatus: "APPROVED",
    };
    await db.doc("relations/old-a").set({ ...old, parentId: a, childId: b });
    await db.doc("relations/old-b").set({ ...old, parentId: b, childId: a });
    await deny(review(record), "failed-precondition");
  });

  it("fails closed when a referenced endpoint in an otherwise classified old graph does not exist", async () => {
    const operation = await relationOperation({
      lineageTransmission: false,
      lineageReason: "",
    });
    const record = await submit(await draft(operation));
    await db.doc("relations/dangling-old").set({
      parentId: "missing-old-parent",
      childId: "missing-old-child",
      parentRole: "FATHER",
      relationType: "BIOLOGICAL",
      lineageTransmission: false,
      verificationStatus: "APPROVED",
      version: 1,
      schemaVersion: 1,
    });
    await deny(review(record), "failed-precondition");
  });

  it("keeps all application writes rolled back when the append-only final audit conflicts", async () => {
    const operation = personOperation();
    const record = await submit(await draft(operation));
    await db
      .doc(`auditLogs/change-${record.requestId}-r1-approved`)
      .create({ event: "FAKE_CONFLICT_FIXTURE" });
    await deny(review(record));
    expect((await db.doc(`persons/${operation.personId}`).get()).exists).toBe(
      false,
    );
    expect(
      (await db.doc(`memberProfiles/${operation.personId}`).get()).exists,
    ).toBe(false);
    expect(
      (await db.doc(`changeRequests/${record.requestId}`).get()).data(),
    ).toMatchObject({ status: "SUBMITTED", votes: [] });
  });

  it("keeps an edited revision and its audit atomic when an immutable revision ID already exists", async () => {
    const operation = personOperation();
    const record = await draft(operation);
    await db
      .doc(`proposalRevisions/${record.requestId}-r2`)
      .create({ fixture: true });
    await deny(
      author.call("editChangeDraft", {
        requestId: record.requestId,
        expectedRevision: 1,
        operation: { ...operation, displayName: "Tên giả khác" },
      }),
    );
    expect(
      (await db.doc(`changeRequests/${record.requestId}`).get()).data(),
    ).toMatchObject({ revision: 1, operation });
    const audits = await db
      .collection("auditLogs")
      .where("requestId", "==", record.requestId)
      .where("event", "==", "CHANGE_DRAFT_EDITED")
      .get();
    expect(audits.empty).toBe(true);
  });

  it("refuses final application if the immutable revision archive is absent or differs from the reviewed content", async () => {
    for (const corrupt of [false, true]) {
      const operation = personOperation();
      const record = await submit(await draft(operation));
      const archive = db.doc(`proposalRevisions/${record.requestId}-r1`);
      if (corrupt)
        await archive.update({
          operation: { ...operation, displayName: "Tên giả bị tráo" },
        });
      else await archive.delete();
      await deny(review(record), "failed-precondition");
      expect((await db.doc(`persons/${operation.personId}`).get()).exists).toBe(
        false,
      );
      expect(
        (await db.doc(`changeRequests/${record.requestId}`).get()).data()
          ?.status,
      ).toBe("SUBMITTED");
    }
  });

  it("refuses counter overflow rather than committing unreadable profile, revision or graph versions", async () => {
    const maximum = Number.MAX_SAFE_INTEGER - 1;
    const id = await person();
    await db.doc(`persons/${id}`).update({ profileVersion: maximum });
    await db.doc(`memberProfiles/${id}`).update({ profileVersion: maximum });
    const update = await submit(
      await draft(personOperation({ personId: id, baseVersion: maximum })),
    );
    await deny(review(update), "failed-precondition");
    expect((await db.doc(`persons/${id}`).get()).data()?.profileVersion).toBe(
      maximum,
    );
    const editable = await draft();
    await db
      .doc(`changeRequests/${editable.requestId}`)
      .update({ revision: maximum });
    await deny(
      author.call("editChangeDraft", {
        requestId: editable.requestId,
        expectedRevision: maximum,
        operation: personOperation(),
      }),
      "failed-precondition",
    );
    const relation = await relationOperation({
      lineageTransmission: false,
      lineageReason: "",
    });
    const submitted = await submit(await draft(relation));
    await db
      .doc("graphState/parentage")
      .set({ version: maximum, schemaVersion: 1 });
    await deny(review(submitted), "failed-precondition");
    expect(
      (await db.doc(`relations/${relation.relationId}`).get()).exists,
    ).toBe(false);
    expect((await db.doc("graphState/parentage").get()).data()?.version).toBe(
      maximum,
    );
  });

  it("restricts draft and review reads to the author or explicit current capabilities", async () => {
    const own = await draft();
    await deny(
      reviewer1.call("getChangeRequest", { requestId: own.requestId }),
      "permission-denied",
    );
    const outsider = await principal();
    await submit(own);
    await deny(
      outsider.call("getChangeRequest", { requestId: own.requestId }),
      "permission-denied",
    );
    await deny(
      outsider.call("listChangeRequests", { scope: "REVIEW" }),
      "permission-denied",
    );
    const ownList = await author.call<{ items: RecordResult[] }>(
      "listChangeRequests",
      { scope: "OWN" },
    );
    expect(ownList.items.length).toBeGreaterThan(0);
    expect(
      ownList.items.every((record) => record.authorUid === author.uid),
    ).toBe(true);
    const lineage = await submit(await draft(await relationOperation()));
    const basicReviewer = await principal({ canReviewChanges: true });
    await deny(
      basicReviewer.call("getChangeRequest", { requestId: lineage.requestId }),
      "permission-denied",
    );
    await deny(review(lineage, basicReviewer), "permission-denied");
    const queue = await basicReviewer.call<{ items: RecordResult[] }>(
      "listChangeRequests",
      { scope: "REVIEW" },
    );
    expect(queue.items.every((record) => record.requiredApprovals === 1)).toBe(
      true,
    );
    await db.doc(`users/${author.uid}`).update({ enabled: false });
    await deny(
      author.call("getChangeRequest", { requestId: own.requestId }),
      "permission-denied",
    );
  });

  it("never trusts claimed reviewer roles and checks live Auth verification and membership schema", async () => {
    const record = await submit(await draft());
    const forged = await principal(
      {},
      { claims: { canReviewChanges: true, role: "admin", enabled: true } },
    );
    await deny(review(record, forged), "permission-denied");
    for (const who of [
      await principal({}, { membership: false }),
      await principal({ enabled: false }),
      await principal({ schemaVersion: 2 }),
      await principal({}, { verified: false }),
    ])
      await deny(draft(personOperation(), who), "permission-denied");
    const anonymous = client();
    await deny(
      anonymous.call("createChangeDraft", {
        requestId: randomUUID(),
        operation: personOperation(),
      }),
      "unauthenticated",
    );
  });

  it("refuses malformed stored requests and never lets client SDK write canonical, revisions, votes or audit", async () => {
    const record = await draft();
    const saved = (
      await db.doc(`changeRequests/${record.requestId}`).get()
    ).data()!;
    for (const mutation of [
      { schemaVersion: 2 },
      { revision: null },
      { votes: [{ uid: reviewer1.uid }] },
    ]) {
      await db
        .doc(`changeRequests/${record.requestId}`)
        .set({ ...saved, ...mutation });
      await deny(
        author.call("getChangeRequest", { requestId: record.requestId }),
      );
    }
    await db.doc(`changeRequests/${record.requestId}`).set(saved);
    for (const session of [author, reviewer1]) {
      for (const path of [
        `changeRequests/${record.requestId}`,
        `proposalRevisions/${record.requestId}-r1`,
        "auditLogs/fake-attack",
        "persons/fake-attack",
        "relations/fake-attack",
        "memberProfiles/fake-attack",
        "graphState/parentage",
      ])
        await expect(
          setDoc(doc(session.firestore, path), {
            status: "APPROVED",
            votes: [session.uid],
          }),
        ).rejects.toHaveProperty("code");
      await expect(
        getDoc(doc(session.firestore, "persons/fake-attack")),
      ).rejects.toHaveProperty("code");
    }
  });

  it("is retry-safe for draft creation and rejects a colliding request ID or stale edit", async () => {
    const operation = personOperation();
    const record = await draft(operation);
    expect(
      await author.call("createChangeDraft", {
        requestId: record.requestId,
        operation,
      }),
    ).toEqual(record);
    await deny(
      author.call("createChangeDraft", {
        requestId: record.requestId,
        operation: { ...operation, displayName: "Tên khác" },
      }),
      "already-exists",
    );
    const edited = await author.call("editChangeDraft", {
      requestId: record.requestId,
      expectedRevision: 1,
      operation: { ...operation, displayName: "Tên đã sửa" },
    });
    expect(edited.revision).toBe(2);
    await deny(submit(record), "failed-precondition");
    await deny(
      author.call("editChangeDraft", {
        requestId: record.requestId,
        expectedRevision: 1,
        operation,
      }),
      "failed-precondition",
    );
  });
});
