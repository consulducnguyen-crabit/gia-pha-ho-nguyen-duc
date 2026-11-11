import { randomUUID } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import {
  Timestamp,
  type DocumentData,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  assertGraphCanAdd,
  normalizeName,
  objectInput,
  parseOperation,
  positiveRevision,
  requestId as parseRequestId,
  requiredApprovals,
  safeId,
  type Operation,
} from "./proposalValidation.js";

type Status = "DRAFT" | "SUBMITTED" | "NEEDS_INFO" | "REJECTED" | "APPROVED";
type Basic = {
  displayName: string;
  normalizedName: string;
  profileVersion: number;
  schemaVersion: 1;
};
type Before =
  | { displayName: string | null; profileVersion: number }
  | {
      parentDisplayName: string;
      childDisplayName: string;
      parentVersion: number;
      childVersion: number;
    };
type Vote = {
  uid: string;
  revision: number;
  accessVersion: number;
  userUpdateTime: Timestamp;
};
type Proposal = {
  schemaVersion: 1;
  authorUid: string;
  status: Status;
  revision: number;
  operation: Operation;
  before: Before;
  votes: Vote[];
  reviewNote: string;
  needsEdit: boolean;
  requiredApprovals: 1 | 2;
};
function fail(
  code: ConstructorParameters<typeof HttpsError>[0],
  message: string,
): never {
  throw new HttpsError(code, message);
}
function epoch(data?: DocumentData): number {
  const value = data?.accessVersion === undefined ? 0 : data.accessVersion;
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= Number.MAX_SAFE_INTEGER
  )
    return fail("permission-denied", "Phiên bản quyền không hợp lệ.");
  return value;
}
function member(data?: DocumentData) {
  if (
    data?.enabled !== true ||
    (data.schemaVersion !== undefined && data.schemaVersion !== 1)
  )
    fail("permission-denied", "Tài khoản chưa được cấp quyền.");
  epoch(data);
}
function reviewer(data: DocumentData | undefined, operation: Operation) {
  member(data);
  if (
    data?.canReviewChanges !== true ||
    (requiredApprovals(operation) === 2 && data?.canReviewLineage !== true)
  )
    fail("permission-denied", "Bạn không có quyền duyệt đề xuất này.");
}
function isReviewer(data: DocumentData | undefined, operation: Operation) {
  try {
    reviewer(data, operation);
    return true;
  } catch {
    return false;
  }
}
function basic(data?: DocumentData): Basic {
  if (
    !data ||
    data.schemaVersion !== 1 ||
    typeof data.displayName !== "string" ||
    !data.displayName.trim() ||
    data.displayName.length > 200 ||
    typeof data.normalizedName !== "string" ||
    data.normalizedName !== normalizeName(data.displayName) ||
    !Number.isSafeInteger(data.profileVersion) ||
    data.profileVersion < 1 ||
    data.profileVersion >= Number.MAX_SAFE_INTEGER
  )
    return fail(
      "failed-precondition",
      "Hồ sơ không có phiên bản cơ bản hợp lệ.",
    );
  return {
    displayName: data.displayName,
    normalizedName: data.normalizedName,
    profileVersion: data.profileVersion,
    schemaVersion: 1,
  };
}
function storedId(value: unknown) {
  try {
    return safeId(value);
  } catch {
    return fail("failed-precondition", "Định danh lưu trữ không hợp lệ.");
  }
}
function stored(raw?: DocumentData): Proposal {
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    !["DRAFT", "SUBMITTED", "NEEDS_INFO", "REJECTED", "APPROVED"].includes(
      raw.status,
    ) ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1 ||
    raw.revision >= Number.MAX_SAFE_INTEGER ||
    typeof raw.reviewNote !== "string" ||
    raw.reviewNote.length > 500 ||
    typeof raw.needsEdit !== "boolean" ||
    !Array.isArray(raw.votes) ||
    raw.votes.length > 2
  )
    return fail("failed-precondition", "Đề xuất không có cấu trúc hợp lệ.");
  storedId(raw.authorUid);
  let operation: Operation;
  try {
    operation = parseOperation(raw.operation);
  } catch {
    return fail(
      "failed-precondition",
      "Nội dung đề xuất lưu trữ không hợp lệ.",
    );
  }
  if (raw.requiredApprovals !== requiredApprovals(operation))
    fail(
      "failed-precondition",
      "Số phiếu yêu cầu không khớp nội dung đề xuất.",
    );
  const votes: Vote[] = raw.votes.map((vote: DocumentData) => {
    if (
      !vote ||
      typeof vote !== "object" ||
      !Number.isSafeInteger(vote.revision) ||
      vote.revision < 1 ||
      !Number.isSafeInteger(vote.accessVersion) ||
      vote.accessVersion < 0 ||
      !(vote.userUpdateTime instanceof Timestamp)
    )
      return fail("failed-precondition", "Phiếu duyệt không hợp lệ.");
    return {
      uid: storedId(vote.uid),
      revision: vote.revision,
      accessVersion: vote.accessVersion,
      userUpdateTime: vote.userUpdateTime,
    };
  });
  if (new Set(votes.map((vote) => vote.uid)).size !== votes.length)
    fail("failed-precondition", "Phiếu duyệt bị trùng.");
  let before: Before;
  if (operation.kind === "PERSON_BASIC") {
    if (
      !raw.before ||
      raw.before.profileVersion !== operation.baseVersion ||
      (operation.baseVersion === 0
        ? raw.before.displayName !== null
        : typeof raw.before.displayName !== "string" ||
          !raw.before.displayName.trim() ||
          raw.before.displayName.length > 200)
    )
      fail("failed-precondition", "Phiên bản ảnh trước không hợp lệ.");
    before = {
      displayName: raw.before.displayName,
      profileVersion: raw.before.profileVersion,
    };
  } else {
    const endpoint = (displayName: unknown, profileVersion: unknown) => {
      if (
        typeof displayName !== "string" ||
        !displayName.trim() ||
        displayName.length > 200 ||
        !Number.isSafeInteger(profileVersion) ||
        (profileVersion as number) < 1
      )
        return fail("failed-precondition", "Ảnh hồ sơ liên quan không hợp lệ.");
    };
    endpoint(raw.before?.parentDisplayName, raw.before?.parentVersion);
    endpoint(raw.before?.childDisplayName, raw.before?.childVersion);
    before = {
      parentDisplayName: raw.before.parentDisplayName,
      childDisplayName: raw.before.childDisplayName,
      parentVersion: raw.before.parentVersion,
      childVersion: raw.before.childVersion,
    };
  }
  return {
    schemaVersion: 1,
    authorUid: raw.authorUid,
    status: raw.status,
    revision: raw.revision,
    operation,
    before,
    votes,
    reviewNote: raw.reviewNote,
    needsEdit: raw.needsEdit,
    requiredApprovals: requiredApprovals(operation),
  };
}
function publicRecord(
  id: string,
  record: Proposal,
  approvalCount = record.votes.length,
) {
  return {
    requestId: id,
    authorUid: record.authorUid,
    status: record.status,
    revision: record.revision,
    operation: record.operation,
    before: record.before,
    requiredApprovals: requiredApprovals(record.operation),
    approvalCount,
    reviewNote: record.reviewNote,
  };
}

export function proposalService(db: Firestore, auth: Auth) {
  async function validAuth(uid: string) {
    try {
      const user = await auth.getUser(uid);
      return !user.disabled && user.emailVerified && !!user.email;
    } catch {
      return false;
    }
  }
  async function actor(uid?: string) {
    if (!uid) return fail("unauthenticated", "Vui lòng đăng nhập.");
    safeId(uid);
    if (!(await validAuth(uid)))
      return fail(
        "permission-denied",
        "Cần tài khoản đăng nhập đã xác minh email.",
      );
    return uid;
  }
  function audit(
    tx: Transaction,
    event: string,
    id: string,
    record: Proposal,
    uid: string,
  ) {
    const auditId =
      event === "CHANGE_APPLIED"
        ? `change-${id}-r${record.revision}-approved`
        : `change-${randomUUID()}`;
    tx.create(db.doc(`auditLogs/${auditId}`), {
      event,
      requestId: id,
      revision: record.revision,
      actorUid: uid,
      authorUid: record.authorUid,
      status: record.status,
      timestamp: Timestamp.now(),
      schemaVersion: 1,
    });
  }
  function revision(tx: Transaction, id: string, record: Proposal) {
    tx.create(db.doc(`proposalRevisions/${id}-r${record.revision}`), {
      schemaVersion: 1,
      requestId: id,
      authorUid: record.authorUid,
      revision: record.revision,
      operation: record.operation,
      before: record.before,
      createdAt: Timestamp.now(),
    });
  }
  async function eligiblePerson(tx: Transaction, id: string): Promise<Basic> {
    const canonical = await tx.get(db.doc(`persons/${id}`));
    const projection = await tx.get(db.doc(`memberProfiles/${id}`));
    const person = basic(canonical.data());
    const visible = basic(projection.data());
    if (
      Object.keys(projection.data()!).some(
        (key) =>
          ![
            "displayName",
            "normalizedName",
            "profileVersion",
            "schemaVersion",
          ].includes(key),
      )
    )
      fail("failed-precondition", "Hồ sơ công bố chưa có phân loại hợp lệ.");
    if (JSON.stringify(person) !== JSON.stringify(visible))
      fail(
        "failed-precondition",
        "Hồ sơ cơ bản chưa khớp với dữ liệu chính thức.",
      );
    return visible;
  }
  async function capture(
    tx: Transaction,
    operation: Operation,
  ): Promise<Before> {
    if (operation.kind === "PERSON_BASIC") {
      if (operation.baseVersion === 0) {
        const canonical = await tx.get(db.doc(`persons/${operation.personId}`));
        const projection = await tx.get(
          db.doc(`memberProfiles/${operation.personId}`),
        );
        if (canonical.exists || projection.exists)
          fail("failed-precondition", "Mã hồ sơ đã được sử dụng.");
        return { displayName: null, profileVersion: 0 };
      }
      const before = await eligiblePerson(tx, operation.personId);
      if (before.profileVersion !== operation.baseVersion)
        fail("failed-precondition", "Hồ sơ đã thay đổi phiên bản.");
      return {
        displayName: before.displayName,
        profileVersion: before.profileVersion,
      };
    }
    const relation = await tx.get(db.doc(`relations/${operation.relationId}`));
    if (relation.exists)
      fail("failed-precondition", "Mã quan hệ đã được sử dụng.");
    const parent = await eligiblePerson(tx, operation.parentId);
    const child = await eligiblePerson(tx, operation.childId);
    return {
      parentDisplayName: parent.displayName,
      childDisplayName: child.displayName,
      parentVersion: parent.profileVersion,
      childVersion: child.profileVersion,
    };
  }
  async function votes(tx: Transaction, record: Proposal) {
    const valid: Vote[] = [];
    for (const vote of record.votes) {
      if (vote.uid === record.authorUid || vote.revision !== record.revision)
        continue;
      const user = await tx.get(db.doc(`users/${vote.uid}`));
      if (
        isReviewer(user.data(), record.operation) &&
        epoch(user.data()) === vote.accessVersion &&
        user.updateTime?.isEqual(vote.userUpdateTime) &&
        (await validAuth(vote.uid))
      )
        valid.push(vote);
    }
    return valid;
  }
  async function applyReads(tx: Transaction, id: string, record: Proposal) {
    const archive = (
      await tx.get(db.doc(`proposalRevisions/${id}-r${record.revision}`))
    ).data();
    if (
      !archive ||
      archive.schemaVersion !== 1 ||
      archive.requestId !== id ||
      archive.authorUid !== record.authorUid ||
      archive.revision !== record.revision
    )
      fail(
        "failed-precondition",
        "Bản lưu phiên bản đề xuất bị thiếu hoặc không khớp.",
      );
    const archivedRecord = stored({
      ...record,
      operation: archive.operation,
      before: archive.before,
    });
    if (
      JSON.stringify(archivedRecord.operation) !==
        JSON.stringify(record.operation) ||
      JSON.stringify(archivedRecord.before) !== JSON.stringify(record.before)
    )
      fail(
        "failed-precondition",
        "Nội dung đề xuất không khớp bản lưu phiên bản.",
      );
    const current = await capture(tx, record.operation);
    if (JSON.stringify(current) !== JSON.stringify(record.before))
      fail("failed-precondition", "Dữ liệu đã thay đổi sau khi gửi đề xuất.");
    if (record.operation.kind === "PERSON_BASIC") {
      if (record.operation.baseVersion >= Number.MAX_SAFE_INTEGER - 1)
        fail("failed-precondition", "Phiên bản hồ sơ không thể tăng an toàn.");
      return null;
    }
    const metaRef = db.doc("graphState/parentage");
    const meta = await tx.get(metaRef);
    const graphVersion = meta.exists ? meta.data()?.version : 0;
    if (
      !Number.isSafeInteger(graphVersion) ||
      graphVersion < 0 ||
      graphVersion >= Number.MAX_SAFE_INTEGER - 1 ||
      (meta.exists && meta.data()?.schemaVersion !== 1)
    )
      fail("failed-precondition", "Phiên bản cây không hợp lệ.");
    const graph = await tx.get(db.collection("relations").limit(201));
    const edges = graph.docs.map((doc) => doc.data());
    assertGraphCanAdd(edges, record.operation);
    const endpoints = [
      ...new Set(
        edges.flatMap((edge) => [safeId(edge.parentId), safeId(edge.childId)]),
      ),
    ];
    for (const id of endpoints)
      basic((await tx.get(db.doc(`persons/${id}`))).data());
    return { metaRef, graphVersion };
  }
  function applyWrites(
    tx: Transaction,
    id: string,
    record: Proposal,
    graph: Awaited<ReturnType<typeof applyReads>>,
  ) {
    const operation = record.operation;
    if (operation.kind === "PERSON_BASIC") {
      const projection = {
        displayName: operation.displayName,
        normalizedName: normalizeName(operation.displayName),
        profileVersion: operation.baseVersion + 1,
        schemaVersion: 1,
      };
      const person = db.doc(`persons/${operation.personId}`);
      if (operation.baseVersion === 0) tx.create(person, projection);
      else tx.update(person, projection);
      tx.set(db.doc(`memberProfiles/${operation.personId}`), projection);
    } else {
      tx.create(db.doc(`relations/${operation.relationId}`), {
        parentId: operation.parentId,
        childId: operation.childId,
        parentRole: operation.parentRole,
        relationType: operation.relationType,
        lineageTransmission: operation.lineageTransmission,
        verificationStatus: "APPROVED",
        version: 1,
        schemaVersion: 1,
        sourceRefs: [`proposalRevisions/${id}-r${record.revision}`],
      });
      if (!graph) fail("internal", "Thiếu khóa cây.");
      tx.set(graph.metaRef, {
        version: graph.graphVersion + 1,
        schemaVersion: 1,
      });
    }
  }
  async function visible(tx: Transaction, uid: string, record: Proposal) {
    const user = await tx.get(db.doc(`users/${uid}`));
    member(user.data());
    if (uid !== record.authorUid) {
      if (record.status === "DRAFT")
        fail("permission-denied", "Bản nháp chỉ dành cho người đề xuất.");
      reviewer(user.data(), record.operation);
    }
  }
  return {
    async createChangeDraft(uid: string | undefined, raw: unknown) {
      const input = objectInput(raw, ["requestId", "operation"]);
      const id = parseRequestId(input.requestId);
      const operation = parseOperation(input.operation);
      const caller = await actor(uid);
      return db.runTransaction(async (tx) => {
        member((await tx.get(db.doc(`users/${caller}`))).data());
        const ref = db.doc(`changeRequests/${id}`);
        const existing = await tx.get(ref);
        if (existing.exists) {
          const record = stored(existing.data());
          if (
            record.authorUid !== caller ||
            JSON.stringify(record.operation) !== JSON.stringify(operation)
          )
            fail("already-exists", "Mã đề xuất đã được sử dụng.");
          return publicRecord(
            id,
            record,
            record.status === "SUBMITTED"
              ? (await votes(tx, record)).length
              : record.votes.length,
          );
        }
        const before = await capture(tx, operation);
        const record: Proposal = {
          schemaVersion: 1,
          authorUid: caller,
          status: "DRAFT",
          revision: 1,
          operation,
          before,
          votes: [],
          reviewNote: "",
          needsEdit: false,
          requiredApprovals: requiredApprovals(operation),
        };
        tx.create(ref, {
          ...record,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        revision(tx, id, record);
        audit(tx, "CHANGE_DRAFT_CREATED", id, record, caller);
        return publicRecord(id, record);
      });
    },
    async editChangeDraft(uid: string | undefined, raw: unknown) {
      const input = objectInput(raw, [
        "requestId",
        "expectedRevision",
        "operation",
      ]);
      const id = parseRequestId(input.requestId);
      const expected = positiveRevision(input.expectedRevision);
      const operation = parseOperation(input.operation);
      const caller = await actor(uid);
      return db.runTransaction(async (tx) => {
        member((await tx.get(db.doc(`users/${caller}`))).data());
        const ref = db.doc(`changeRequests/${id}`);
        const record = stored((await tx.get(ref)).data());
        if (record.authorUid !== caller)
          fail("permission-denied", "Chỉ người đề xuất được sửa bản nháp.");
        if (
          record.revision !== expected ||
          !["DRAFT", "NEEDS_INFO"].includes(record.status)
        )
          fail(
            "failed-precondition",
            "Đề xuất không còn ở phiên bản có thể sửa.",
          );
        if (record.revision >= Number.MAX_SAFE_INTEGER - 1)
          fail(
            "failed-precondition",
            "Phiên bản đề xuất không thể tăng an toàn.",
          );
        const before = await capture(tx, operation);
        const next: Proposal = {
          ...record,
          operation,
          before,
          revision: record.revision + 1,
          status: "DRAFT",
          votes: [],
          reviewNote: "",
          needsEdit: false,
          requiredApprovals: requiredApprovals(operation),
        };
        tx.update(ref, { ...next, updatedAt: Timestamp.now() });
        revision(tx, id, next);
        audit(tx, "CHANGE_DRAFT_EDITED", id, next, caller);
        return publicRecord(id, next);
      });
    },
    async submitChangeRequest(uid: string | undefined, raw: unknown) {
      const input = objectInput(raw, ["requestId", "expectedRevision"]);
      const id = parseRequestId(input.requestId);
      const expected = positiveRevision(input.expectedRevision);
      const caller = await actor(uid);
      return db.runTransaction(async (tx) => {
        member((await tx.get(db.doc(`users/${caller}`))).data());
        const ref = db.doc(`changeRequests/${id}`);
        const record = stored((await tx.get(ref)).data());
        if (record.authorUid !== caller)
          fail("permission-denied", "Chỉ người đề xuất được gửi bản nháp.");
        if (record.revision !== expected)
          fail("failed-precondition", "Đề xuất đã đổi phiên bản.");
        if (record.status === "SUBMITTED")
          return publicRecord(id, record, (await votes(tx, record)).length);
        if (record.status !== "DRAFT" || record.needsEdit)
          fail("failed-precondition", "Cần sửa bản nháp trước khi gửi.");
        if (
          JSON.stringify(await capture(tx, record.operation)) !==
          JSON.stringify(record.before)
        )
          fail("failed-precondition", "Hồ sơ liên quan đã đổi sau bản nháp.");
        const next: Proposal = { ...record, status: "SUBMITTED", votes: [] };
        tx.update(ref, { ...next, updatedAt: Timestamp.now() });
        audit(tx, "CHANGE_SUBMITTED", id, next, caller);
        return publicRecord(id, next);
      });
    },
    async reviewChangeRequest(uid: string | undefined, raw: unknown) {
      const input = objectInput(raw, [
        "requestId",
        "expectedRevision",
        "decision",
        "note",
      ]);
      const id = parseRequestId(input.requestId);
      const expected = positiveRevision(input.expectedRevision);
      if (
        !["APPROVE", "REJECT", "NEEDS_INFO"].includes(
          input.decision as string,
        ) ||
        typeof input.note !== "string" ||
        input.note.length > 500 ||
        (input.decision !== "APPROVE" && !input.note.trim())
      )
        fail("invalid-argument", "Quyết định hoặc ghi chú không hợp lệ.");
      const caller = await actor(uid);
      return db.runTransaction(async (tx) => {
        const ref = db.doc(`changeRequests/${id}`);
        const record = stored((await tx.get(ref)).data());
        const current = await tx.get(db.doc(`users/${caller}`));
        reviewer(current.data(), record.operation);
        if (record.authorUid === caller)
          fail("permission-denied", "Không tự duyệt đề xuất của mình.");
        if (record.revision !== expected)
          fail("failed-precondition", "Đề xuất đã đổi phiên bản.");
        if (record.status === "APPROVED") return publicRecord(id, record);
        if (record.status !== "SUBMITTED")
          fail("failed-precondition", "Đề xuất không còn chờ duyệt.");
        member((await tx.get(db.doc(`users/${record.authorUid}`))).data());
        if (!(await validAuth(record.authorUid)))
          fail("permission-denied", "Người đề xuất không còn quyền.");
        if (input.decision !== "APPROVE") {
          const next: Proposal = {
            ...record,
            status: input.decision === "REJECT" ? "REJECTED" : "NEEDS_INFO",
            votes: [],
            reviewNote: (input.note as string).trim(),
            needsEdit: input.decision === "NEEDS_INFO",
          };
          tx.update(ref, { ...next, updatedAt: Timestamp.now() });
          audit(tx, `CHANGE_${next.status}`, id, next, caller);
          return publicRecord(id, next);
        }
        const active = await votes(tx, record);
        if (active.some((vote) => vote.uid === caller))
          return publicRecord(id, { ...record, votes: active });
        if (!current.updateTime)
          fail("permission-denied", "Không thể xác minh phiên bản quyền.");
        active.push({
          uid: caller,
          revision: record.revision,
          accessVersion: epoch(current.data()),
          userUpdateTime: current.updateTime,
        });
        const apply = active.length >= requiredApprovals(record.operation);
        const graph = apply ? await applyReads(tx, id, record) : null;
        const next: Proposal = {
          ...record,
          votes: active,
          status: apply ? "APPROVED" : "SUBMITTED",
          reviewNote: "",
        };
        if (apply) applyWrites(tx, id, next, graph);
        tx.update(ref, { ...next, updatedAt: Timestamp.now() });
        audit(
          tx,
          apply ? "CHANGE_APPLIED" : "CHANGE_VOTE_ADDED",
          id,
          next,
          caller,
        );
        return publicRecord(id, next);
      });
    },
    async getChangeRequest(uid: string | undefined, raw: unknown) {
      const id = parseRequestId(objectInput(raw, ["requestId"]).requestId);
      const caller = await actor(uid);
      return db.runTransaction(async (tx) => {
        const record = stored(
          (await tx.get(db.doc(`changeRequests/${id}`))).data(),
        );
        await visible(tx, caller, record);
        const active =
          record.status === "SUBMITTED"
            ? await votes(tx, record)
            : record.votes;
        return publicRecord(id, record, active.length);
      });
    },
    async listChangeRequests(uid: string | undefined, raw: unknown) {
      const input = objectInput(raw, ["scope"]);
      if (input.scope !== "OWN" && input.scope !== "REVIEW")
        fail("invalid-argument", "Phạm vi không hợp lệ.");
      const caller = await actor(uid);
      return db.runTransaction(async (tx) => {
        const viewer = await tx.get(db.doc(`users/${caller}`));
        member(viewer.data());
        if (
          input.scope === "REVIEW" &&
          viewer.data()?.canReviewChanges !== true
        )
          fail("permission-denied", "Bạn không có quyền mở hộp duyệt.");
        let q =
          input.scope === "OWN"
            ? db
                .collection("changeRequests")
                .where("authorUid", "==", caller)
                .limit(31)
            : db
                .collection("changeRequests")
                .where("status", "==", "SUBMITTED")
                .where("authorUid", "!=", caller)
                .orderBy("authorUid")
                .limit(31);
        if (
          input.scope === "REVIEW" &&
          viewer.data()?.canReviewLineage !== true
        )
          q = q.where("requiredApprovals", "==", 1);
        const result = await tx.get(q);
        const items = [];
        for (const doc of result.docs.slice(0, 30)) {
          const record = stored(doc.data());
          if (
            input.scope === "REVIEW" &&
            (record.authorUid === caller ||
              !isReviewer(viewer.data(), record.operation))
          )
            continue;
          const active =
            record.status === "SUBMITTED"
              ? await votes(tx, record)
              : record.votes;
          items.push(publicRecord(doc.id, record, active.length));
        }
        return { items, truncated: result.size > 30 };
      });
    },
  };
}
