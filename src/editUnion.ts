// Gỡ liên kết vợ/chồng nhập sai và khôi phục (hàm thuần). KHÔNG xóa cứng: unions/{id} chỉ đánh dấu `deleted` +
// `removedAtVersion`; snapshot bỏ dòng [a, b, order]; nhật ký UNION_REMOVED giữ đủ dữ liệu để khôi phục.
// Lô ghi gồm đúng ba tài liệu (unions/{id}, treeSnapshots/main, auditLogs/edit-{n}). Không đụng persons,
// memberProfiles, relations và KHÔNG tính lại đời (liên kết vợ/chồng không truyền dòng).
// Chính sách (người dùng duyệt 2026-11-12): vẫn gỡ được khi người kia thành mồ côi hoặc hai người có con chung
// (giao diện cảnh báo); không sửa thứ tự/trạng thái/ghi chú của liên kết.
import {
  EditError,
  SERVER_TIME,
  currentEditVersion,
  invalid,
  type EditWrite,
} from "./editCore";
import type { TreeIndex } from "./treeModel";

type Doc = Record<string, unknown>;
type Row = unknown[];

export interface RemoveUnionOp {
  type: "removeUnion";
  /** Người đang xem hồ sơ (thuộc cặp). */
  personId: string;
  spouseId: string;
  /** Bắt buộc true (người dùng đã xác nhận). */
  confirm: boolean;
}
/** Khôi phục liên kết đã gỡ; `removeVersion` = số phiên bản nhật ký (edit-N, UNION_REMOVED) của lần gỡ. */
export interface RestoreRemovedUnionOp {
  type: "restoreRemovedUnion";
  personId: string;
  spouseId: string;
  removeVersion: number;
}
export type UnionOp = RemoveUnionOp | RestoreRemovedUnionOp;

export interface UnionState {
  snapshot: Doc;
  /** persons/{id} của hai người. */
  docs: Record<string, Doc | null>;
  /** unions/{id} của cặp. */
  union: Doc | null;
  /** auditLogs/edit-{removeVersion}; chỉ cần khi khôi phục. */
  audit?: Doc | null;
}
export interface UnionInput {
  op: UnionOp;
  expectedVersion: number;
  actorUid: string;
}
export interface UnionResult {
  writes: EditWrite[];
  nextVersion: number;
  focusId: string;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const SNAPSHOT_MAX_BYTES = 850000;
export const unionIdOf = (a: string, b: string) =>
  `u-${[a, b].sort().join("-")}`;
const isNum = (v: unknown): v is number => Number.isInteger(v);
const empty = (v: unknown) => v === undefined || v === null;

interface Data {
  persons: Record<string, unknown[]>;
  relations: Row[];
  unions: Row[];
}
function parse(snapshot: Doc): Data {
  if (snapshot.schemaVersion !== 1 || typeof snapshot.data !== "string")
    throw new EditError("BAD_STATE", "Ảnh chụp cây không hợp lệ.");
  let data: unknown;
  try {
    data = JSON.parse(snapshot.data);
  } catch {
    throw new EditError("BAD_STATE", "Ảnh chụp cây không đọc được.");
  }
  const d = data as Partial<Data> & { v?: unknown };
  if (
    !d ||
    typeof d !== "object" ||
    d.v !== 1 ||
    !d.persons ||
    !Array.isArray(d.relations) ||
    !Array.isArray(d.unions)
  )
    throw new EditError("BAD_STATE", "Ảnh chụp cây sai định dạng.");
  return d as Data;
}

/** Mã tài liệu cần đọc trước khi gọi applyUnion. */
export function unionReads(op: UnionOp): {
  persons: string[];
  unionId: string;
  audit?: string;
} {
  const base = {
    persons: [op.personId, op.spouseId],
    unionId: unionIdOf(op.personId, op.spouseId),
  };
  return op.type === "restoreRemovedUnion"
    ? { ...base, audit: `edit-${op.removeVersion}` }
    : base;
}

export interface RemovalImpact {
  /** Số con chung (cả con nuôi) của hai người. */
  commonChildren: number;
  /** Người sẽ không còn nối với ai trong cây (không cha/mẹ, không con, không vợ/chồng khác) sau khi gỡ. */
  orphaned: string[];
}
/** Tác động của việc gỡ để giao diện cảnh báo (không chặn gỡ: người dùng duyệt Q2/Q3). */
export function removalImpact(
  index: TreeIndex,
  a: string,
  b: string,
): RemovalImpact {
  const kidsB = new Set(index.children(b));
  const commonChildren = index.children(a).filter((c) => kidsB.has(c)).length;
  const orphaned = [a, b].filter((x) => {
    const other = x === a ? b : a;
    return (
      index.parents(x).length === 0 &&
      index.children(x).length === 0 &&
      index.spouses(x).every((s) => s === other)
    );
  });
  return { commonChildren, orphaned };
}

function sameRow(u: Row, a: string, b: string) {
  return (u[0] === a && u[1] === b) || (u[0] === b && u[1] === a);
}

export function applyUnion(state: UnionState, input: UnionInput): UnionResult {
  const { op } = input;
  if (op.type !== "removeUnion" && op.type !== "restoreRemovedUnion")
    invalid("Loại thao tác chưa được hỗ trợ.");
  if (!input.actorUid) invalid("Thiếu người thực hiện.");
  if (
    typeof op.personId !== "string" ||
    typeof op.spouseId !== "string" ||
    !ID.test(op.personId) ||
    !ID.test(op.spouseId)
  )
    invalid("Mã người không hợp lệ.");
  if (op.personId === op.spouseId)
    invalid("Một người không thể là vợ/chồng của chính mình.");
  const version = currentEditVersion(state.snapshot);
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion !== version
  )
    throw new EditError(
      "VERSION_CONFLICT",
      "Dữ liệu đã được người khác thay đổi. Hãy tải lại rồi sửa lại.",
    );
  const data = parse(state.snapshot);
  const nextVersion = version + 1;
  const { personId, spouseId } = op;
  const unionId = unionIdOf(personId, spouseId);
  for (const id of [personId, spouseId]) {
    if (!Object.hasOwn(data.persons, id) || !Array.isArray(data.persons[id]))
      invalid("Người không có trong cây.");
    if (state.docs[id]?.deleted === true)
      invalid("Người liên quan đang bị ẩn; hãy khôi phục trước.");
  }
  const doc = state.union;
  if (!doc || !Array.isArray(doc.partnerIds))
    throw new EditError("BAD_STATE", "Thiếu dữ liệu liên kết vợ/chồng.");
  if (
    [...doc.partnerIds].map(String).sort().join() !==
    [personId, spouseId].sort().join()
  )
    throw new EditError(
      "BAD_STATE",
      "Liên kết vợ/chồng không khớp hai người này; chạy đối soát trước.",
    );
  const rows = data.unions.filter((u) => sameRow(u, personId, spouseId));
  if (rows.length > 1)
    throw new EditError(
      "BAD_STATE",
      "Ảnh chụp cây có liên kết vợ/chồng bị trùng; hãy chạy đối soát.",
    );
  const writes: EditWrite[] = [];
  let audit: Doc;

  if (op.type === "removeUnion") {
    if (op.confirm !== true)
      throw new EditError(
        "CONFIRM_REQUIRED",
        "Cần xác nhận gỡ liên kết vợ/chồng này; liên kết được ẩn và ghi vào nhật ký, có thể khôi phục.",
      );
    if (rows.length === 0)
      throw new EditError("NOT_FOUND", "Không thấy liên kết vợ/chồng này.");
    const row = rows[0];
    const order = row[2] === null || row[2] === undefined ? null : row[2];
    if (
      doc.deleted === true ||
      !empty(doc.removedAtVersion) ||
      (doc.order ?? null) !== order
    )
      throw new EditError(
        "BAD_STATE",
        "Trạng thái liên kết không khớp ảnh chụp cây; chạy đối soát trước.",
      );
    // Không kiểm deletedWith: liên kết hiện (deleted != true) có thể còn deletedWith cũ sau khi ẩn/khôi phục người
    // (chỉ `deleted` là nguồn sự thật); việc gỡ đặt lại deletedWith = null bên dưới.
    data.unions.splice(data.unions.indexOf(row), 1);
    writes.push({
      path: `unions/${unionId}`,
      mode: "merge",
      data: {
        deleted: true,
        deletedAt: SERVER_TIME,
        deletedBy: input.actorUid,
        // Xóa dấu "ẩn cùng người" cũ còn sót để liên kết đã gỡ không bị hồi sinh qua khôi phục người.
        deletedWith: null,
        removedAtVersion: nextVersion,
      },
    });
    audit = {
      event: "UNION_REMOVED",
      revertsVersion: null,
      before: { removed: { spouseId, order } },
      after: { removed: true },
    };
  } else {
    if (
      !isNum(op.removeVersion) ||
      op.removeVersion < 1 ||
      op.removeVersion > version
    )
      invalid("Số phiên bản của lần gỡ không hợp lệ.");
    if (rows.length > 0)
      throw new EditError(
        "BAD_STATE",
        "Liên kết vợ/chồng này đang có trong cây; không cần khôi phục.",
      );
    const log = state.audit;
    if (!log) throw new EditError("NOT_FOUND", "Không thấy nhật ký.");
    const removed = (log.before as Doc | undefined)?.removed as
      Doc | null | undefined;
    const order = removed?.order ?? null;
    if (
      log.event !== "UNION_REMOVED" ||
      log.editVersion !== op.removeVersion ||
      log.unionId !== unionId ||
      (log.personId !== personId && log.personId !== spouseId) ||
      !removed ||
      typeof removed !== "object" ||
      removed.spouseId !== (log.personId === personId ? spouseId : personId) ||
      (order !== null && typeof order !== "string")
    )
      throw new EditError(
        "BAD_STATE",
        "Nhật ký không phải lần gỡ liên kết này; không khôi phục được.",
      );
    if (
      doc.deleted !== true ||
      doc.removedAtVersion !== op.removeVersion ||
      !empty(doc.deletedWith) ||
      (doc.order ?? null) !== order
    )
      throw new EditError(
        "BAD_STATE",
        "Liên kết không còn ở trạng thái đã gỡ khớp nhật ký; không khôi phục được.",
      );
    // Giữ nguyên thứ tự hai người như lúc tạo liên kết (partnerIds), thứ tự hiển thị lấy từ nhật ký.
    data.unions.push([
      String(doc.partnerIds[0]),
      String(doc.partnerIds[1]),
      order,
    ]);
    writes.push({
      path: `unions/${unionId}`,
      mode: "merge",
      data: {
        deleted: false,
        // Xóa dấu gỡ để liên kết sống lại hành xử như liên kết thường (ẩn/khôi phục người, gỡ lại).
        removedAtVersion: null,
        restoredAt: SERVER_TIME,
        restoredBy: input.actorUid,
      },
    });
    audit = {
      event: "UNION_REMOVAL_UNDONE",
      revertsVersion: op.removeVersion,
      before: { removed: true },
      after: { spouseId, order },
    };
  }

  const json = JSON.stringify(data);
  if (new TextEncoder().encode(json).length > SNAPSHOT_MAX_BYTES)
    invalid("Ảnh chụp cây đã quá lớn.");
  writes.push({
    path: "treeSnapshots/main",
    mode: "merge",
    data: { data: json, editVersion: nextVersion },
  });
  writes.push({
    path: `auditLogs/edit-${nextVersion}`,
    mode: "create",
    data: {
      actorUid: input.actorUid,
      target: `persons/${personId}`,
      personId,
      createdPersonIds: [],
      relationIds: [],
      removedRelationIds: [],
      unionId,
      moreUnionIds: [],
      editVersion: nextVersion,
      fields: ["union"],
      timestamp: SERVER_TIME,
      schemaVersion: 1,
      ...audit,
    },
  });
  return { writes, nextVersion, focusId: personId };
}
