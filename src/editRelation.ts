// Đổi quan hệ cha/mẹ–con (hàm thuần): đặt/đổi cha hoặc mẹ, đổi loại con nuôi/ruột.
// Quan hệ bị thay KHÔNG bị xóa cứng: tài liệu được đánh dấu `deleted` (xóa mềm), snapshot bỏ dòng đó và ghi
// quan hệ cũ vào nhật ký. Chính sách: không tạo vòng lặp, không tạo thủy tổ thứ hai, mỗi người một cha theo dòng.
import {
  EditError,
  SERVER_TIME,
  currentEditVersion,
  exceedsSnapshotLimit,
  invalid,
  type EditWrite,
} from "./editCore";

type Doc = Record<string, unknown>;
type Row = unknown[];

export interface SetParentOp {
  type: "setParent";
  childId: string;
  role: "FATHER" | "MOTHER";
  parentId: string;
  adoptive: boolean;
  /** Bắt buộc true khi thay một cha/mẹ đang có. */
  confirmReplace: boolean;
}
export interface SetRelationTypeOp {
  type: "setRelationType";
  parentId: string;
  childId: string;
  adoptive: boolean;
}
/**
 * Hoàn tác MỘT lần thay cha/mẹ: quan hệ cũ (cha/mẹ `parentId`) sống lại, quan hệ hiện tại bị ẩn.
 * `changeVersion` là số phiên bản nhật ký (edit-N, sự kiện PARENT_CHANGED) của lần thay bị hoàn tác.
 */
export interface RevertParentOp {
  type: "revertParent";
  childId: string;
  role: "FATHER" | "MOTHER";
  /** Cha/mẹ CŨ cần đưa trở lại. */
  parentId: string;
  changeVersion: number;
}
/**
 * Gỡ quan hệ cha/mẹ nhập sai (không thay bằng người khác). Quan hệ KHÔNG bị xóa cứng: tài liệu được đánh dấu `deleted`
 * + `removedAtVersion`. Cấm gỡ quan hệ truyền dòng (chỉ được thay) để không làm đứt dòng/đời.
 */
export interface RemoveParentOp {
  type: "removeParent";
  childId: string;
  role: "FATHER" | "MOTHER";
  parentId: string;
  /** Bắt buộc true (người dùng đã xác nhận). */
  confirm: boolean;
}
/** Khôi phục việc gỡ cha/mẹ; `removeVersion` = số phiên bản nhật ký (edit-N, PARENT_REMOVED) của lần gỡ. */
export interface RestoreRemovedParentOp {
  type: "restoreRemovedParent";
  childId: string;
  role: "FATHER" | "MOTHER";
  parentId: string;
  removeVersion: number;
}
export type RelationOp =
  | SetParentOp
  | SetRelationTypeOp
  | RevertParentOp
  | RemoveParentOp
  | RestoreRemovedParentOp;

export interface RelationState {
  snapshot: Doc;
  /** persons/{id} của người liên quan (đọc giới tính). */
  docs: Record<string, Doc | null>;
  /** relations/{id} của quan hệ liên quan; quan hệ mới phải là null. */
  relations: Record<string, Doc | null>;
  /** auditLogs/edit-{changeVersion | removeVersion}; chỉ cần khi hoàn tác thay hoặc khôi phục việc gỡ. */
  audit?: Doc | null;
}
export interface RelationInput {
  op: RelationOp;
  expectedVersion: number;
  actorUid: string;
}
export interface RelationResult {
  writes: EditWrite[];
  nextVersion: number;
  focusId: string;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const rid = (parent: string, child: string) => `r-${parent}-${child}`;
const ROLE_CODE = { FATHER: "F", MOTHER: "M" } as const;
const ROLE_LABEL = { FATHER: "cha", MOTHER: "mẹ" } as const;

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
    !Array.isArray(d.relations)
  )
    throw new EditError("BAD_STATE", "Ảnh chụp cây sai định dạng.");
  return d as Data;
}

/** Mã tài liệu cần đọc trước khi gọi applyRelation (cần ảnh chụp để biết quan hệ cũ). */
export function relationReads(
  snapshot: Doc,
  op: RelationOp,
): { persons: string[]; relations: string[]; audit?: string } {
  const data = parse(snapshot);
  if (op.type === "removeParent")
    return {
      persons: [op.parentId, op.childId],
      relations: [rid(op.parentId, op.childId)],
    };
  if (op.type === "restoreRemovedParent")
    return {
      persons: [op.parentId, op.childId],
      relations: [rid(op.parentId, op.childId)],
      audit: `edit-${op.removeVersion}`,
    };
  if (op.type === "revertParent") {
    const cur = data.relations.find(
      (r) => r[1] === op.childId && r[2] === ROLE_CODE[op.role],
    );
    return {
      persons: [op.parentId, op.childId],
      relations: [
        rid(op.parentId, op.childId),
        ...(cur ? [rid(String(cur[0]), op.childId)] : []),
      ],
      audit: `edit-${op.changeVersion}`,
    };
  }
  if (op.type === "setRelationType")
    return {
      persons: [op.parentId, op.childId],
      relations: [rid(op.parentId, op.childId)],
    };
  const old = data.relations.find(
    (r) => r[1] === op.childId && r[2] === ROLE_CODE[op.role],
  );
  return {
    persons: [op.parentId, op.childId],
    relations: [
      rid(op.parentId, op.childId),
      ...(old ? [rid(String(old[0]), op.childId)] : []),
    ],
  };
}

/** Tính lại đời theo cạnh truyền dòng từ thủy tổ duy nhất; chỉ ghi vào snapshot (đời là giá trị suy ra). */
export function recomputeGenerations(data: Data) {
  const lineageChildren = new Map<string, string[]>();
  const hasLineageParent = new Set<string>();
  for (const r of data.relations)
    if (r[4] === 1) {
      const list = lineageChildren.get(String(r[0])) ?? [];
      list.push(String(r[1]));
      lineageChildren.set(String(r[0]), list);
      hasLineageParent.add(String(r[1]));
    }
  // Thủy tổ = người dòng họ có đời, có con theo dòng, không có cha theo dòng. Nhóm "mồ côi" (chưa có đời)
  // không tính để dữ liệu chưa làm sạch không chặn các thao tác khác.
  const roots = [...lineageChildren.keys()].filter(
    (id) =>
      !hasLineageParent.has(id) &&
      data.persons[id]?.[4] === "C" &&
      typeof data.persons[id]?.[3] === "number",
  );
  if (roots.length !== 1)
    throw new EditError(
      "BAD_STATE",
      "Cây không có đúng một thủy tổ; không thể tính đời.",
    );
  const start =
    typeof data.persons[roots[0]][3] === "number"
      ? (data.persons[roots[0]][3] as number)
      : 1;
  const depth = new Map<string, number>([[roots[0], start]]);
  const queue = [roots[0]];
  while (queue.length) {
    const id = queue.shift()!;
    for (const c of lineageChildren.get(id) ?? [])
      if (!depth.has(c)) {
        depth.set(c, depth.get(id)! + 1);
        queue.push(c);
      }
  }
  for (const [id, tuple] of Object.entries(data.persons)) {
    if (depth.has(id)) tuple[3] = depth.get(id)!;
    else if (typeof tuple[3] === "number") tuple[3] = null;
  }
}

function descendants(rows: Row[], id: string): Set<string> {
  const down = new Map<string, string[]>();
  for (const r of rows) {
    const list = down.get(String(r[0])) ?? [];
    list.push(String(r[1]));
    down.set(String(r[0]), list);
  }
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    for (const c of down.get(stack.pop()!) ?? [])
      if (!seen.has(c)) {
        seen.add(c);
        stack.push(c);
      }
  }
  return seen;
}

export function applyRelation(
  state: RelationState,
  input: RelationInput,
): RelationResult {
  const { op } = input;
  if (
    op.type !== "setParent" &&
    op.type !== "setRelationType" &&
    op.type !== "revertParent" &&
    op.type !== "removeParent" &&
    op.type !== "restoreRemovedParent"
  )
    invalid("Loại thao tác chưa được hỗ trợ.");
  if (!input.actorUid) invalid("Thiếu người thực hiện.");
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
  const audit = `auditLogs/edit-${nextVersion}`;
  const known = (id: unknown): id is string =>
    typeof id === "string" &&
    ID.test(id) &&
    Object.hasOwn(data.persons, id) &&
    Array.isArray(data.persons[id]);
  if (op.type === "revertParent")
    return applyRevert(state, input, op, data, version, nextVersion, known);
  if (op.type === "removeParent")
    return applyRemove(state, input, op, data, nextVersion, known);
  if (op.type === "restoreRemovedParent")
    return applyRestoreRemoved(
      state,
      input,
      op,
      data,
      version,
      nextVersion,
      known,
    );
  if (typeof op.adoptive !== "boolean") invalid("Thiếu loại con (nuôi/ruột).");
  if (!known(op.childId) || !known(op.parentId))
    invalid("Người không có trong cây.");
  if (op.childId === op.parentId)
    invalid("Một người không thể là cha/mẹ của chính mình.");
  const writes: EditWrite[] = [];
  const newId = rid(op.parentId, op.childId);
  let relationIds: string[];
  let removedRelationIds: string[] = [];
  let event: string;
  let before: Doc;
  let after: Doc;

  if (op.type === "setRelationType") {
    const row = data.relations.find(
      (r) => r[0] === op.parentId && r[1] === op.childId,
    );
    if (!row) throw new EditError("NOT_FOUND", "Không thấy quan hệ này.");
    if ((row[3] === "A") === op.adoptive)
      throw new EditError("NO_CHANGE", "Loại con không thay đổi.");
    const doc = state.relations[newId];
    const v = doc?.version;
    if (!doc || typeof v !== "number" || !Number.isInteger(v))
      throw new EditError("BAD_STATE", "Thiếu hoặc sai phiên bản quan hệ.");
    writes.push({
      path: `relations/${newId}`,
      mode: "merge",
      data: {
        relationType: op.adoptive ? "ADOPTIVE" : "BIOLOGICAL",
        version: v + 1,
        updatedAt: SERVER_TIME,
        updatedBy: input.actorUid,
      },
    });
    before = { relationType: row[3] === "A" ? "ADOPTIVE" : "BIOLOGICAL" };
    after = { relationType: op.adoptive ? "ADOPTIVE" : "BIOLOGICAL" };
    row[3] = op.adoptive ? "A" : "B";
    relationIds = [newId];
    event = "RELATION_TYPE_CHANGED";
  } else {
    if (op.role !== "FATHER" && op.role !== "MOTHER")
      invalid("Vai trò phải là cha hoặc mẹ.");
    const sex = state.docs[op.parentId]?.sex;
    if (op.role === "FATHER" && sex === "F")
      invalid("Người được chọn làm cha đang ghi giới tính nữ.");
    if (op.role === "MOTHER" && sex === "M")
      invalid("Người được chọn làm mẹ đang ghi giới tính nam.");
    const existing = data.relations.find(
      (r) => r[1] === op.childId && r[2] === ROLE_CODE[op.role],
    );
    if (existing && existing[0] === op.parentId)
      invalid("Người này đã là cha/mẹ đó; dùng 'đổi loại con' nếu cần.");
    if (data.relations.some((r) => r[0] === op.parentId && r[1] === op.childId))
      invalid(
        "Người này đã là cha/mẹ (vai trò khác) của người con này; không đặt thêm vai trò thứ hai.",
      );
    if (state.relations[newId] !== null)
      invalid(
        "Từng có quan hệ này (đã ẩn hoặc còn tồn tại); không tạo lại bằng cách này.",
      );
    if (descendants(data.relations, op.childId).has(op.parentId))
      invalid(
        "Không thể chọn con cháu của người này làm cha/mẹ (tạo vòng lặp).",
      );
    const child = data.persons[op.childId];
    const parent = data.persons[op.parentId];
    const lineage =
      op.role === "FATHER" && parent[4] === "C" && child[4] === "C";
    // Người thuộc dòng họ phải luôn có cha thuộc dòng họ đã nối tới thủy tổ.
    if (child[4] === "C" && op.role === "FATHER") {
      if (parent[4] !== "C")
        invalid("Người thuộc dòng họ chỉ có thể có cha thuộc dòng họ.");
      if (typeof parent[3] !== "number")
        invalid("Cha chưa nối được tới thủy tổ (chưa có đời).");
    }
    if (existing) {
      if (!op.confirmReplace)
        throw new EditError(
          "CONFIRM_REQUIRED",
          `Người này đang có ${ROLE_LABEL[op.role]} là ${String(data.persons[String(existing[0])]?.[0] ?? existing[0])}. Xác nhận để thay; quan hệ cũ được ẩn và ghi vào nhật ký.`,
        );
      const oldId = rid(String(existing[0]), op.childId);
      const old = state.relations[oldId];
      const v = old?.version;
      if (!old || typeof v !== "number" || !Number.isInteger(v))
        throw new EditError(
          "BAD_STATE",
          "Thiếu hoặc sai phiên bản quan hệ cũ.",
        );
      removedRelationIds = [oldId];
      writes.push({
        path: `relations/${oldId}`,
        mode: "merge",
        data: {
          deleted: true,
          deletedAt: SERVER_TIME,
          deletedBy: input.actorUid,
          replacedBy: newId,
          version: v + 1,
        },
      });
      before = {
        removed: {
          parentId: existing[0],
          role: op.role,
          relationType: existing[3] === "A" ? "ADOPTIVE" : "BIOLOGICAL",
          lineageTransmission: existing[4] === 1,
        },
      };
      data.relations.splice(data.relations.indexOf(existing), 1);
    } else {
      before = { removed: null };
    }
    writes.push({
      path: `relations/${newId}`,
      mode: "create",
      data: {
        parentId: op.parentId,
        childId: op.childId,
        parentRole: op.role,
        relationType: op.adoptive ? "ADOPTIVE" : "BIOLOGICAL",
        lineageTransmission: lineage,
        verificationStatus: "APPROVED",
        version: 1,
        schemaVersion: 1,
        sourceRefs: [audit],
        createdAt: SERVER_TIME,
      },
    });
    data.relations.push([
      op.parentId,
      op.childId,
      ROLE_CODE[op.role],
      op.adoptive ? "A" : "B",
      lineage ? 1 : 0,
    ]);
    recomputeGenerations(data);
    relationIds = [newId];
    event = "PARENT_CHANGED";
    after = {
      parentId: op.parentId,
      role: op.role,
      adoptive: op.adoptive,
      lineageTransmission: lineage,
    };
  }

  const json = JSON.stringify(data);
  if (exceedsSnapshotLimit(json)) invalid("Ảnh chụp cây đã quá lớn.");
  writes.push({
    path: "treeSnapshots/main",
    mode: "merge",
    data: { data: json, editVersion: nextVersion },
  });
  writes.push({
    path: audit,
    mode: "create",
    data: {
      event,
      actorUid: input.actorUid,
      target: `persons/${op.childId}`,
      personId: op.childId,
      createdPersonIds: [],
      relationIds,
      removedRelationIds,
      unionId: null,
      editVersion: nextVersion,
      fields: [op.type === "setParent" ? "parent" : "relationType"],
      before,
      after,
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
  });
  return { writes, nextVersion, focusId: op.childId };
}

function applyRevert(
  state: RelationState,
  input: RelationInput,
  op: RevertParentOp,
  data: Data,
  version: number,
  nextVersion: number,
  known: (id: unknown) => id is string,
): RelationResult {
  if (op.role !== "FATHER" && op.role !== "MOTHER")
    invalid("Vai trò phải là cha hoặc mẹ.");
  if (
    !Number.isInteger(op.changeVersion) ||
    op.changeVersion < 1 ||
    op.changeVersion > version
  )
    invalid("Số phiên bản của lần thay không hợp lệ.");
  if (!known(op.childId)) invalid("Người này không có trong cây.");
  if (!known(op.parentId))
    invalid("Cha/mẹ cũ hiện không có trong cây; hãy khôi phục người đó trước.");
  if (state.docs[op.childId]?.deleted === true)
    invalid("Người này đang bị ẩn; hãy khôi phục trước.");
  if (state.docs[op.parentId]?.deleted === true)
    invalid("Cha/mẹ cũ đang bị ẩn; hãy khôi phục người đó trước.");
  const role = ROLE_CODE[op.role];
  const curRow = data.relations.find(
    (r) => r[1] === op.childId && r[2] === role,
  );
  if (!curRow)
    invalid(`Người này hiện không có ${ROLE_LABEL[op.role]} để hoàn tác.`);
  const curId = rid(String(curRow[0]), op.childId);
  const oldId = rid(op.parentId, op.childId);
  const cur = state.relations[curId];
  const old = state.relations[oldId];
  const audit = state.audit;
  const num = (v: unknown): v is number => Number.isInteger(v);
  if (!cur || !old || !audit || !num(cur.version) || !num(old.version))
    throw new EditError("BAD_STATE", "Thiếu dữ liệu quan hệ hoặc nhật ký.");
  const refs = cur.sourceRefs;
  const after = audit.after as Doc | undefined;
  const removed = (audit.before as Doc | undefined)?.removed as
    Doc | null | undefined;
  // Chỉ hoàn tác được lần thay MỚI NHẤT của vai trò này: quan hệ hiện tại phải do chính lần thay đó tạo ra.
  if (
    !Array.isArray(refs) ||
    refs[0] !== `auditLogs/edit-${op.changeVersion}` ||
    audit.event !== "PARENT_CHANGED" ||
    audit.personId !== op.childId ||
    !Array.isArray(audit.relationIds) ||
    audit.relationIds[0] !== curId ||
    !Array.isArray(audit.removedRelationIds) ||
    audit.removedRelationIds[0] !== oldId ||
    !removed ||
    removed.parentId !== op.parentId ||
    removed.role !== op.role ||
    !after ||
    after.parentId !== curRow[0]
  )
    throw new EditError(
      "BAD_STATE",
      "Đây không phải lần thay gần nhất của quan hệ này; không hoàn tác được.",
    );
  if (
    old.deleted !== true ||
    old.replacedBy !== curId ||
    old.parentRole !== op.role ||
    cur.parentRole !== op.role ||
    cur.deleted === true
  )
    throw new EditError(
      "BAD_STATE",
      "Trạng thái quan hệ không còn khớp với lần thay; không hoàn tác được.",
    );
  const oldAdoptive = old.relationType === "ADOPTIVE";
  const oldLineage = old.lineageTransmission === true;
  if (
    !["ADOPTIVE", "BIOLOGICAL"].includes(String(old.relationType)) ||
    typeof old.lineageTransmission !== "boolean" ||
    (removed.relationType === "ADOPTIVE") !== oldAdoptive ||
    removed.lineageTransmission !== oldLineage
  )
    throw new EditError(
      "BAD_STATE",
      "Quan hệ cũ không khớp nhật ký; chạy đối soát trước.",
    );
  const sex = state.docs[op.parentId]?.sex;
  if (op.role === "FATHER" && sex === "F")
    invalid("Cha cũ hiện đang ghi giới tính nữ.");
  if (op.role === "MOTHER" && sex === "M")
    invalid("Mẹ cũ hiện đang ghi giới tính nam.");
  if (data.relations.some((r) => r[0] === op.parentId && r[1] === op.childId))
    invalid("Người này hiện đã là cha/mẹ của người con ở vai trò khác.");
  if (descendants(data.relations, op.childId).has(op.parentId))
    invalid("Không thể hoàn tác: sẽ tạo vòng lặp (cha/mẹ cũ nay là con cháu).");
  const child = data.persons[op.childId];
  const parent = data.persons[op.parentId];
  if (child[4] === "C" && op.role === "FATHER") {
    if (parent[4] !== "C")
      invalid("Người thuộc dòng họ chỉ có thể có cha thuộc dòng họ.");
    if (typeof parent[3] !== "number")
      invalid("Cha cũ chưa nối được tới thủy tổ (chưa có đời).");
  }
  data.relations.splice(data.relations.indexOf(curRow), 1);
  data.relations.push([
    op.parentId,
    op.childId,
    role,
    oldAdoptive ? "A" : "B",
    oldLineage ? 1 : 0,
  ]);
  recomputeGenerations(data);
  const json = JSON.stringify(data);
  if (exceedsSnapshotLimit(json)) invalid("Ảnh chụp cây đã quá lớn.");
  const writes: EditWrite[] = [
    {
      path: `relations/${oldId}`,
      mode: "merge",
      data: {
        deleted: false,
        replacedBy: null,
        restoredAt: SERVER_TIME,
        restoredBy: input.actorUid,
        version: old.version + 1,
      },
    },
    {
      path: `relations/${curId}`,
      mode: "merge",
      data: {
        deleted: true,
        deletedAt: SERVER_TIME,
        deletedBy: input.actorUid,
        revertedAtVersion: nextVersion,
        version: cur.version + 1,
      },
    },
    {
      path: "treeSnapshots/main",
      mode: "merge",
      data: { data: json, editVersion: nextVersion },
    },
    {
      path: `auditLogs/edit-${nextVersion}`,
      mode: "create",
      data: {
        event: "PARENT_REVERTED",
        actorUid: input.actorUid,
        target: `persons/${op.childId}`,
        personId: op.childId,
        createdPersonIds: [],
        relationIds: [oldId],
        removedRelationIds: [curId],
        revertsVersion: op.changeVersion,
        unionId: null,
        editVersion: nextVersion,
        fields: ["parent"],
        before: {
          reverted: {
            parentId: curRow[0],
            role: op.role,
            relationType: cur.relationType ?? null,
            lineageTransmission: cur.lineageTransmission ?? null,
          },
        },
        after: {
          parentId: op.parentId,
          role: op.role,
          adoptive: oldAdoptive,
          lineageTransmission: oldLineage,
        },
        timestamp: SERVER_TIME,
        schemaVersion: 1,
      },
    },
  ];
  return { writes, nextVersion, focusId: op.childId };
}

const isNum = (v: unknown): v is number => Number.isInteger(v);
const empty = (v: unknown) => v === undefined || v === null;

function applyRemove(
  state: RelationState,
  input: RelationInput,
  op: RemoveParentOp,
  data: Data,
  nextVersion: number,
  known: (id: unknown) => id is string,
): RelationResult {
  if (op.confirm !== true)
    throw new EditError(
      "CONFIRM_REQUIRED",
      "Cần xác nhận gỡ quan hệ cha/mẹ này; quan hệ được ẩn và ghi vào nhật ký, có thể khôi phục.",
    );
  if (op.role !== "FATHER" && op.role !== "MOTHER")
    invalid("Vai trò phải là cha hoặc mẹ.");
  if (!known(op.childId) || !known(op.parentId))
    invalid("Người không có trong cây.");
  if (
    state.docs[op.childId]?.deleted === true ||
    state.docs[op.parentId]?.deleted === true
  )
    invalid("Người liên quan đang bị ẩn; hãy khôi phục trước.");
  const row = data.relations.find(
    (r) =>
      r[0] === op.parentId &&
      r[1] === op.childId &&
      r[2] === ROLE_CODE[op.role],
  );
  if (!row) throw new EditError("NOT_FOUND", "Không thấy quan hệ này.");
  // Quan hệ truyền dòng quyết định đời của cả nhánh: chỉ được thay bằng người khác, không được gỡ trống.
  if (row[4] === 1)
    invalid(
      "Quan hệ cha theo dòng không gỡ được (sẽ đứt dòng); chỉ thay được bằng người khác.",
    );
  const relId = rid(op.parentId, op.childId);
  const rel = state.relations[relId];
  if (!rel || !isNum(rel.version))
    throw new EditError("BAD_STATE", "Thiếu hoặc sai phiên bản quan hệ.");
  if (rel.lineageTransmission === true)
    invalid("Quan hệ cha theo dòng không gỡ được; chỉ thay được.");
  if (
    rel.deleted === true ||
    rel.parentRole !== op.role ||
    !empty(rel.replacedBy) ||
    !empty(rel.removedAtVersion) ||
    rel.relationType !== (row[3] === "A" ? "ADOPTIVE" : "BIOLOGICAL") ||
    rel.lineageTransmission !== false
  )
    throw new EditError(
      "BAD_STATE",
      "Trạng thái quan hệ không khớp ảnh chụp cây; chạy đối soát trước.",
    );
  const relationType = row[3] === "A" ? "ADOPTIVE" : "BIOLOGICAL";
  // Không truyền dòng nên không đổi đời; cố ý không gọi recomputeGenerations.
  data.relations.splice(data.relations.indexOf(row), 1);
  const writes: EditWrite[] = [
    {
      path: `relations/${relId}`,
      mode: "merge",
      data: {
        deleted: true,
        deletedAt: SERVER_TIME,
        deletedBy: input.actorUid,
        // Xóa dấu "ẩn cùng người" cũ còn sót để quan hệ đã gỡ không bị hồi sinh qua khôi phục người.
        deletedWith: null,
        removedAtVersion: nextVersion,
        version: rel.version + 1,
      },
    },
    {
      path: "treeSnapshots/main",
      mode: "merge",
      data: { data: JSON.stringify(data), editVersion: nextVersion },
    },
    {
      path: `auditLogs/edit-${nextVersion}`,
      mode: "create",
      data: {
        event: "PARENT_REMOVED",
        actorUid: input.actorUid,
        target: `persons/${op.childId}`,
        personId: op.childId,
        createdPersonIds: [],
        relationIds: [],
        removedRelationIds: [relId],
        unionId: null,
        editVersion: nextVersion,
        fields: ["parent"],
        before: {
          removed: {
            parentId: op.parentId,
            role: op.role,
            relationType,
            lineageTransmission: false,
          },
        },
        after: { removed: true },
        timestamp: SERVER_TIME,
        schemaVersion: 1,
      },
    },
  ];
  return { writes, nextVersion, focusId: op.childId };
}

function applyRestoreRemoved(
  state: RelationState,
  input: RelationInput,
  op: RestoreRemovedParentOp,
  data: Data,
  version: number,
  nextVersion: number,
  known: (id: unknown) => id is string,
): RelationResult {
  if (op.role !== "FATHER" && op.role !== "MOTHER")
    invalid("Vai trò phải là cha hoặc mẹ.");
  if (
    !Number.isInteger(op.removeVersion) ||
    op.removeVersion < 1 ||
    op.removeVersion > version
  )
    invalid("Số phiên bản của lần gỡ không hợp lệ.");
  if (!known(op.childId)) invalid("Người này không có trong cây.");
  if (!known(op.parentId))
    invalid(
      "Cha/mẹ đã gỡ hiện không có trong cây; hãy khôi phục người đó trước.",
    );
  if (state.docs[op.childId]?.deleted === true)
    invalid("Người này đang bị ẩn; hãy khôi phục trước.");
  if (state.docs[op.parentId]?.deleted === true)
    invalid("Cha/mẹ đã gỡ đang bị ẩn; hãy khôi phục người đó trước.");
  const relId = rid(op.parentId, op.childId);
  const rel = state.relations[relId];
  const audit = state.audit;
  if (!rel || !audit || !isNum(rel.version))
    throw new EditError("BAD_STATE", "Thiếu dữ liệu quan hệ hoặc nhật ký.");
  const removed = (audit.before as Doc | undefined)?.removed as
    Doc | null | undefined;
  if (
    audit.event !== "PARENT_REMOVED" ||
    audit.personId !== op.childId ||
    audit.editVersion !== op.removeVersion ||
    !Array.isArray(audit.removedRelationIds) ||
    audit.removedRelationIds[0] !== relId ||
    !removed ||
    removed.parentId !== op.parentId ||
    removed.role !== op.role ||
    removed.lineageTransmission !== false
  )
    throw new EditError(
      "BAD_STATE",
      "Nhật ký không phải lần gỡ quan hệ này; không khôi phục được.",
    );
  if (
    rel.deleted !== true ||
    rel.removedAtVersion !== op.removeVersion ||
    !empty(rel.replacedBy) ||
    !empty(rel.revertedAtVersion) ||
    !empty(rel.deletedWith) ||
    rel.parentRole !== op.role ||
    rel.lineageTransmission !== false ||
    !["ADOPTIVE", "BIOLOGICAL"].includes(String(rel.relationType)) ||
    rel.relationType !== removed.relationType
  )
    throw new EditError(
      "BAD_STATE",
      "Quan hệ không còn ở trạng thái đã gỡ khớp nhật ký; không khôi phục được.",
    );
  const role = ROLE_CODE[op.role];
  // Một người có thể có một cha/mẹ ruột và một cha/mẹ nuôi cùng vai trò: chỉ chặn khi trùng cả vai trò lẫn loại.
  const typeCode = rel.relationType === "ADOPTIVE" ? "A" : "B";
  if (
    data.relations.some(
      (r) => r[1] === op.childId && r[2] === role && r[3] === typeCode,
    )
  )
    invalid(
      `Người này hiện đã có ${ROLE_LABEL[op.role]} cùng loại (ruột/nuôi); gỡ hoặc thay người đó trước khi khôi phục.`,
    );
  const sex = state.docs[op.parentId]?.sex;
  if (op.role === "FATHER" && sex === "F")
    invalid("Cha đã gỡ hiện đang ghi giới tính nữ.");
  if (op.role === "MOTHER" && sex === "M")
    invalid("Mẹ đã gỡ hiện đang ghi giới tính nam.");
  if (data.relations.some((r) => r[0] === op.parentId && r[1] === op.childId))
    invalid("Người này hiện đã là cha/mẹ của người con ở vai trò khác.");
  if (descendants(data.relations, op.childId).has(op.parentId))
    invalid(
      "Không thể khôi phục: sẽ tạo vòng lặp (cha/mẹ đã gỡ nay là con cháu).",
    );
  const adoptive = rel.relationType === "ADOPTIVE";
  // Không truyền dòng nên không đổi đời; cố ý không gọi recomputeGenerations.
  data.relations.push([op.parentId, op.childId, role, adoptive ? "A" : "B", 0]);
  const json = JSON.stringify(data);
  if (exceedsSnapshotLimit(json)) invalid("Ảnh chụp cây đã quá lớn.");
  const writes: EditWrite[] = [
    {
      path: `relations/${relId}`,
      mode: "merge",
      data: {
        deleted: false,
        // Xóa dấu gỡ để quan hệ sống lại hành xử như quan hệ thường (ẩn/khôi phục người, gỡ lại).
        removedAtVersion: null,
        restoredAt: SERVER_TIME,
        restoredBy: input.actorUid,
        version: rel.version + 1,
      },
    },
    {
      path: "treeSnapshots/main",
      mode: "merge",
      data: { data: json, editVersion: nextVersion },
    },
    {
      path: `auditLogs/edit-${nextVersion}`,
      mode: "create",
      data: {
        event: "PARENT_REMOVAL_UNDONE",
        actorUid: input.actorUid,
        target: `persons/${op.childId}`,
        personId: op.childId,
        createdPersonIds: [],
        relationIds: [relId],
        removedRelationIds: [],
        revertsVersion: op.removeVersion,
        unionId: null,
        editVersion: nextVersion,
        fields: ["parent"],
        before: { removed: true },
        after: {
          parentId: op.parentId,
          role: op.role,
          adoptive,
          lineageTransmission: false,
        },
        timestamp: SERVER_TIME,
        schemaVersion: 1,
      },
    },
  ];
  return { writes, nextVersion, focusId: op.childId };
}
