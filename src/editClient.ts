// Nối lõi sửa (editCore) với Firestore: đọc và ghi trong CÙNG một giao dịch.
import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type DocumentData,
} from "firebase/firestore";
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
}

/** Đưa các lệnh ghi của applyEdit vào giao dịch hoặc lô ghi. */
export function stageWrites(
  db: Firestore,
  target: SetTarget,
  writes: EditWrite[],
) {
  for (const w of writes) {
    const ref = doc(db, w.path) as never;
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
