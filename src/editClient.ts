// Nối lõi sửa (editCore) với Firestore: đọc và ghi trong CÙNG một giao dịch.
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
  type DocumentData,
} from "firebase/firestore";
import {
  PROPOSAL_ID,
  canTransition,
  cleanReason,
  proposalToAddOp,
  readProposal,
  type ChildPayload,
  type ProposalInput,
  type SpousePayload,
} from "./memberProposal";
import { addTargets, applyAdd, type AddOp, type AddResult } from "./editAdd";
import {
  applyRelation,
  relationReads,
  type RelationOp,
  type RelationResult,
} from "./editRelation";
import {
  applyUnion,
  unionReads,
  type UnionOp,
  type UnionResult,
} from "./editUnion";
import {
  applyDelete,
  deleteReads,
  parseDeletedAudit,
  type DeleteOp,
  type DeleteResult,
} from "./editDelete";
import {
  applyEdit,
  EditError,
  SERVER_TIME,
  type EditOp,
  type EditResult,
  type EditWrite,
} from "./editCore";

/** Phần chung của Transaction và WriteBatch mà ta cần. */
export interface SetTarget {
  set(ref: never, data: DocumentData, options?: { merge: boolean }): unknown;
  delete(ref: never): unknown;
}

/** Đưa các lệnh ghi của applyEdit vào giao dịch hoặc lô ghi. */
export function stageWrites(
  db: Firestore,
  target: SetTarget,
  writes: EditWrite[],
) {
  for (const w of writes) {
    const ref = doc(db, w.path) as never;
    if (w.mode === "delete") {
      target.delete(ref);
      continue;
    }
    const data = Object.fromEntries(
      Object.entries(w.data).map(([k, v]) => [
        k,
        v === SERVER_TIME ? serverTimestamp() : v,
      ]),
    );
    if (w.mode === "merge") target.set(ref, data, { merge: true });
    else target.set(ref, data);
  }
}

/** Sửa một người. expectedVersion là editVersion mà giao diện đã đọc. */
export async function commitEdit(
  db: Firestore,
  input: { op: EditOp; expectedVersion: number; actorUid: string },
): Promise<EditResult> {
  const id = input.op.personId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new EditError("INVALID", "Mã người không hợp lệ.");
  return runTransaction(db, async (tx) => {
    const [snapshot, person, profile, priv] = await Promise.all([
      tx.get(doc(db, "treeSnapshots", "main")),
      tx.get(doc(db, "persons", id)),
      tx.get(doc(db, "memberProfiles", id)),
      tx.get(doc(db, "personPrivate", id)),
    ]);
    if (!snapshot.exists())
      throw new EditError("BAD_STATE", "Chưa có ảnh chụp cây.");
    const result = applyEdit(
      {
        snapshot: snapshot.data(),
        person: person.exists() ? person.data() : null,
        profile: profile.exists() ? profile.data() : null,
        priv: priv.exists() ? priv.data() : null,
      },
      input,
    );
    stageWrites(db, tx as unknown as SetTarget, result.writes);
    return result;
  });
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Thêm con / thêm vợ chồng. Đọc và ghi trong CÙNG một giao dịch như commitEdit. */
export async function commitAdd(
  db: Firestore,
  input: { op: AddOp; expectedVersion: number; actorUid: string },
): Promise<AddResult> {
  const ids = addTargets(input.op);
  if (ids.some((id) => !SAFE_ID.test(id)))
    throw new EditError("INVALID", "Mã người không hợp lệ.");
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(doc(db, "treeSnapshots", "main"));
    if (!snapshot.exists())
      throw new EditError("BAD_STATE", "Chưa có ảnh chụp cây.");
    const docs: Record<string, DocumentData | null> = {};
    for (const id of ids) {
      const d = await tx.get(doc(db, "persons", id));
      docs[id] = d.exists() ? d.data() : null;
    }
    const result = applyAdd({ snapshot: snapshot.data(), docs }, input);
    stageWrites(db, tx as unknown as SetTarget, result.writes);
    return result;
  });
}

/** Đổi cha/mẹ hoặc loại con nuôi/ruột. Đọc và ghi trong CÙNG một giao dịch. */
export async function commitRelation(
  db: Firestore,
  input: { op: RelationOp; expectedVersion: number; actorUid: string },
): Promise<RelationResult> {
  const op = input.op;
  if (
    [op.childId, op.parentId].some(
      (id) => typeof id !== "string" || !SAFE_ID.test(id),
    )
  )
    throw new EditError("INVALID", "Mã người không hợp lệ.");
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(doc(db, "treeSnapshots", "main"));
    if (!snapshot.exists())
      throw new EditError("BAD_STATE", "Chưa có ảnh chụp cây.");
    const reads = relationReads(snapshot.data(), op);
    const docs: Record<string, DocumentData | null> = {};
    for (const id of reads.persons) {
      const d = await tx.get(doc(db, "persons", id));
      docs[id] = d.exists() ? d.data() : null;
    }
    const relations: Record<string, DocumentData | null> = {};
    for (const id of reads.relations) {
      const d = await tx.get(doc(db, "relations", id));
      relations[id] = d.exists() ? d.data() : null;
    }
    let audit: DocumentData | null = null;
    if (reads.audit) {
      const a = await tx.get(doc(db, "auditLogs", reads.audit));
      audit = a.exists() ? a.data() : null;
    }
    const result = applyRelation(
      { snapshot: snapshot.data(), docs, relations, audit },
      input,
    );
    stageWrites(db, tx as unknown as SetTarget, result.writes);
    return result;
  });
}

/**
 * Tìm lần thay cha/mẹ gần nhất của một vai trò để hoàn tác (đọc ngoài giao dịch, chỉ để hiển thị xác nhận;
 * giao dịch hoàn tác sẽ kiểm lại mọi điều kiện). Trả null nếu không có gì để hoàn tác.
 */
export async function findRevertCandidate(
  db: Firestore,
  childId: string,
  curParent: string,
  role: "FATHER" | "MOTHER",
): Promise<{ parentId: string; changeVersion: number } | null> {
  if (!SAFE_ID.test(curParent) || !SAFE_ID.test(childId)) return null;
  const cur = await getDoc(doc(db, "relations", `r-${curParent}-${childId}`));
  const ref = cur.data()?.sourceRefs;
  const m =
    Array.isArray(ref) && typeof ref[0] === "string"
      ? /^auditLogs\/edit-(\d+)$/.exec(ref[0])
      : null;
  if (!m) return null;
  const version = Number(m[1]);
  const audit = await getDoc(doc(db, "auditLogs", `edit-${version}`));
  const a = audit.data();
  const removed = (a?.before as DocumentData | undefined)?.removed as
    DocumentData | null | undefined;
  if (
    !a ||
    a.event !== "PARENT_CHANGED" ||
    !removed ||
    typeof removed.parentId !== "string" ||
    !SAFE_ID.test(removed.parentId) ||
    removed.role !== role
  )
    return null;
  return { parentId: removed.parentId, changeVersion: version };
}

/**
 * Tìm quan hệ cha/mẹ đã bị GỠ giữa hai người (đọc ngoài giao dịch, chỉ để hiển thị nút khôi phục; giao dịch khôi
 * phục kiểm lại mọi điều kiện). Trả null nếu không có quan hệ đã gỡ.
 */
export async function findRemovedParent(
  db: Firestore,
  childId: string,
  parentId: string,
): Promise<{ role: "FATHER" | "MOTHER"; removeVersion: number } | null> {
  if (!SAFE_ID.test(parentId) || !SAFE_ID.test(childId)) return null;
  const d = (
    await getDoc(doc(db, "relations", `r-${parentId}-${childId}`))
  ).data();
  const v = d?.removedAtVersion;
  if (
    !d ||
    d.deleted !== true ||
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < 1 ||
    (d.parentRole !== "FATHER" && d.parentRole !== "MOTHER")
  )
    return null;
  return { role: d.parentRole, removeVersion: v };
}

/** Gỡ hoặc khôi phục liên kết vợ/chồng. Đọc và ghi trong CÙNG một giao dịch. */
export async function commitUnion(
  db: Firestore,
  input: { op: UnionOp; expectedVersion: number; actorUid: string },
): Promise<UnionResult> {
  const op = input.op;
  if ([op.personId, op.spouseId].some((id) => !SAFE_ID.test(String(id))))
    throw new EditError("INVALID", "Mã người không hợp lệ.");
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(doc(db, "treeSnapshots", "main"));
    if (!snapshot.exists())
      throw new EditError("BAD_STATE", "Chưa có ảnh chụp cây.");
    const reads = unionReads(op);
    const docs: Record<string, DocumentData | null> = {};
    for (const id of reads.persons) {
      const d = await tx.get(doc(db, "persons", id));
      docs[id] = d.exists() ? d.data() : null;
    }
    const u = await tx.get(doc(db, "unions", reads.unionId));
    let audit: DocumentData | null = null;
    if (reads.audit) {
      const a = await tx.get(doc(db, "auditLogs", reads.audit));
      audit = a.exists() ? a.data() : null;
    }
    const result = applyUnion(
      {
        snapshot: snapshot.data(),
        docs,
        union: u.exists() ? u.data() : null,
        audit,
      },
      input,
    );
    stageWrites(db, tx as unknown as SetTarget, result.writes);
    return result;
  });
}

/**
 * Tìm liên kết vợ/chồng đã bị GỠ giữa hai người (đọc ngoài giao dịch, chỉ để hiển thị nút khôi phục; giao dịch khôi
 * phục kiểm lại mọi điều kiện). Trả null nếu không có liên kết đã gỡ. Chỉ quản trị viên đọc được unions.
 */
export async function findRemovedUnion(
  db: Firestore,
  personId: string,
  spouseId: string,
): Promise<{ removeVersion: number } | null> {
  if (!SAFE_ID.test(personId) || !SAFE_ID.test(spouseId)) return null;
  const d = (
    await getDoc(
      doc(db, "unions", `u-${[personId, spouseId].sort().join("-")}`),
    )
  ).data();
  const v = d?.removedAtVersion;
  if (
    !d ||
    d.deleted !== true ||
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < 1
  )
    return null;
  return { removeVersion: v };
}

/** Ẩn (xóa mềm) hoặc khôi phục một người. Đọc và ghi trong CÙNG một giao dịch. */
export async function commitDelete(
  db: Firestore,
  input: { op: DeleteOp; expectedVersion: number; actorUid: string },
): Promise<DeleteResult> {
  const op = input.op;
  if (typeof op.personId !== "string" || !SAFE_ID.test(op.personId))
    throw new EditError("INVALID", "Mã người không hợp lệ.");
  if (
    op.type === "restorePerson" &&
    (!Number.isInteger(op.deleteVersion) || op.deleteVersion < 1)
  )
    throw new EditError("INVALID", "Số phiên bản nhật ký không hợp lệ.");
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(doc(db, "treeSnapshots", "main"));
    if (!snapshot.exists())
      throw new EditError("BAD_STATE", "Chưa có ảnh chụp cây.");
    const person = await tx.get(doc(db, "persons", op.personId));
    const priv =
      op.type === "restorePerson"
        ? await tx.get(doc(db, "personPrivate", op.personId))
        : null;
    let audit: DocumentData | null = null;
    let relationIds: string[];
    if (op.type === "restorePerson") {
      const a = await tx.get(doc(db, "auditLogs", `edit-${op.deleteVersion}`));
      audit = a.exists() ? a.data() : null;
      relationIds = audit
        ? parseDeletedAudit(audit, op.personId, op.deleteVersion).relations.map(
            (r) => `r-${String(r[0])}-${op.personId}`,
          )
        : [];
    } else relationIds = deleteReads(snapshot.data(), op.personId);
    const relations: Record<string, DocumentData | null> = {};
    for (const id of relationIds) {
      const d = await tx.get(doc(db, "relations", id));
      relations[id] = d.exists() ? d.data() : null;
    }
    const result = applyDelete(
      {
        snapshot: snapshot.data(),
        person: person.exists() ? person.data() : null,
        relations,
        audit,
        priv: priv?.exists() ? priv.data() : null,
      },
      input,
    );
    stageWrites(db, tx as unknown as SetTarget, result.writes);
    return result;
  });
}

// ---- Đề xuất thêm thành viên (memberProposals; docs/MEMBER_PROPOSALS.md) -----------------------------------------
/**
 * Gửi đề xuất: một lô gồm đề xuất mới + proposalThrottle/{uid} (rules đòi lastAt == request.time và lastProposalId
 * == mã đề xuất, tối đa 1 đề xuất/60 giây) [+ rút lại đề xuất cũ khi "gửi lại"].
 */
export async function submitProposal(
  db: Firestore,
  proposal: ProposalInput,
): Promise<void> {
  const batch = writeBatch(db);
  const { id, ...rest } = proposal;
  batch.set(doc(db, "memberProposals", id), {
    ...rest,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "proposalThrottle", proposal.authorUid), {
    lastAt: serverTimestamp(),
    lastProposalId: id,
    schemaVersion: 1,
  });
  if (proposal.resubmitOf)
    batch.update(doc(db, "memberProposals", proposal.resubmitOf), {
      status: "WITHDRAWN",
      updatedAt: serverTimestamp(),
      withdrawnAt: serverTimestamp(),
    });
  await batch.commit();
}

/** Tác giả rút đề xuất đang chờ duyệt hoặc cần bổ sung. */
export async function withdrawProposal(
  db: Firestore,
  proposalId: string,
): Promise<void> {
  if (!PROPOSAL_ID.test(proposalId))
    throw new EditError("INVALID", "Mã đề xuất không hợp lệ.");
  await updateDoc(doc(db, "memberProposals", proposalId), {
    status: "WITHDRAWN",
    updatedAt: serverTimestamp(),
    withdrawnAt: serverTimestamp(),
  });
}

/** Quản trị viên từ chối hoặc yêu cầu bổ sung (bắt buộc có lý do). Duyệt dùng commitApproveProposal. */
export async function decideProposal(
  db: Firestore,
  input: {
    proposalId: string;
    status: "REJECTED" | "NEEDS_INFO";
    reason: string;
    actorUid: string;
  },
): Promise<void> {
  if (!PROPOSAL_ID.test(input.proposalId))
    throw new EditError("INVALID", "Mã đề xuất không hợp lệ.");
  if (input.status !== "REJECTED" && input.status !== "NEEDS_INFO")
    throw new EditError("INVALID", "Trạng thái không hợp lệ.");
  const reason = cleanReason(input.reason, true);
  // Yêu cầu bổ sung ghi riêng infoRequest*; quyết định cuối ghi decided*: không bên nào ghi đè bên kia (rules ép).
  await updateDoc(
    doc(db, "memberProposals", input.proposalId),
    input.status === "NEEDS_INFO"
      ? {
          status: "NEEDS_INFO",
          infoRequestedBy: input.actorUid,
          infoRequestedAt: serverTimestamp(),
          infoRequestReason: reason,
          updatedAt: serverTimestamp(),
        }
      : {
          status: "REJECTED",
          decidedBy: input.actorUid,
          decidedAt: serverTimestamp(),
          decisionReason: reason,
          updatedAt: serverTimestamp(),
        },
  );
}

/**
 * Duyệt đề xuất: ghi người mới (applyAdd, nhật ký có proposalId) và đánh dấu APPROVED trong CÙNG giao dịch.
 * `edits` = chỗ quản trị viên sửa nội dung ghi vào bản chính thức (không đổi được anchorId/kind).
 */
export async function commitApproveProposal(
  db: Firestore,
  input: {
    proposalId: string;
    expectedVersion: number;
    actorUid: string;
    edits?: Partial<ChildPayload & SpousePayload>;
    reason?: string;
  },
): Promise<AddResult> {
  if (!PROPOSAL_ID.test(input.proposalId))
    throw new EditError("INVALID", "Mã đề xuất không hợp lệ.");
  const reason = cleanReason(input.reason, false);
  const ref = doc(db, "memberProposals", input.proposalId);
  const approvedFields = (version: number) => ({
    status: "APPROVED",
    decidedBy: input.actorUid,
    decidedAt: serverTimestamp(),
    appliedEditVersion: version,
    updatedAt: serverTimestamp(),
    ...(reason ? { decisionReason: reason } : {}),
  });
  const readProposalDoc = async (
    get: (r: typeof ref) => Promise<{ exists(): boolean; data(): unknown }>,
  ) => {
    const snap = await get(ref);
    const p = snap.exists() ? readProposal(input.proposalId, snap.data()) : null;
    if (!p) throw new EditError("NOT_FOUND", "Không tìm thấy đề xuất.");
    if (!canTransition(p.status, "APPROVED", "admin"))
      throw new EditError("BAD_STATE", "Đề xuất này không còn ở trạng thái duyệt được.");
    if (p.authorUid === input.actorUid)
      throw new EditError("INVALID", "Không được duyệt đề xuất của chính mình.");
    return p;
  };
  const plan = async (
    p: NonNullable<ReturnType<typeof readProposal>>,
    get: (r: ReturnType<typeof doc>) => Promise<{ exists(): boolean; data(): unknown }>,
  ) => {
    const op = proposalToAddOp(p, input.edits);
    const ids = addTargets(op);
    if (ids.some((id) => !SAFE_ID.test(id)))
      throw new EditError("INVALID", "Mã người không hợp lệ.");
    const snapshot = await get(doc(db, "treeSnapshots", "main"));
    if (!snapshot.exists())
      throw new EditError("BAD_STATE", "Chưa có ảnh chụp cây.");
    const docs: Record<string, DocumentData | null> = {};
    for (const id of ids) {
      const d = await get(doc(db, "persons", id));
      docs[id] = d.exists() ? (d.data() as DocumentData) : null;
    }
    return applyAdd(
      { snapshot: snapshot.data() as DocumentData, docs },
      {
        op,
        expectedVersion: input.expectedVersion,
        actorUid: input.actorUid,
        proposalId: p.id,
      },
    );
  };
  return runTransaction(db, async (tx) => {
    const p = await readProposalDoc((r) => tx.get(r));
    const result = await plan(p, (x) => tx.get(x));
    stageWrites(db, tx as unknown as SetTarget, result.writes);
    tx.update(ref, approvedFields(result.nextVersion));
    return result;
  });
}
