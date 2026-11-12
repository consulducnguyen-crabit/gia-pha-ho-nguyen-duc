// Nối lõi sửa (editCore) với Firestore: đọc và ghi trong CÙNG một giao dịch.
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type DocumentData,
} from "firebase/firestore";
import { addTargets, applyAdd, type AddOp, type AddResult } from "./editAdd";
import {
  applyRelation,
  relationReads,
  type RelationOp,
  type RelationResult,
} from "./editRelation";
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
      },
      input,
    );
    stageWrites(db, tx as unknown as SetTarget, result.writes);
    return result;
  });
}
