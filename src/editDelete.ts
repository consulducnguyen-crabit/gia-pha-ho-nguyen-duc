// Xóa mềm một người và khôi phục (hàm thuần). KHÔNG xóa cứng: persons/relations/unions chỉ đánh dấu `deleted`;
// memberProfiles (bản thành viên đọc được) bị xóa để ẩn khỏi thành viên và được tạo lại khi khôi phục.
// Chính sách: chỉ xóa người KHÔNG còn con (kể cả con nuôi), không phải người sáng lập chi, có tối đa một
// quan hệ vợ/chồng. Các hàng của snapshot bị gỡ được lưu trong nhật ký (`before`) để khôi phục chính xác.
import {
  EditError,
  SERVER_TIME,
  currentEditVersion,
  invalid,
  type EditWrite,
} from "./editCore";
import { recomputeGenerations } from "./editRelation";

type Doc = Record<string, unknown>;
type Row = unknown[];

export interface DeletePersonOp {
  type: "deletePerson";
  personId: string;
  /** Bắt buộc true (người dùng đã xác nhận). */
  confirm: boolean;
}
export interface RestorePersonOp {
  type: "restorePerson";
  personId: string;
  /** Phiên bản nhật ký (edit-N) của lần xóa. */
  deleteVersion: number;
}
export type DeleteOp = DeletePersonOp | RestorePersonOp;

export interface DeleteState {
  snapshot: Doc;
  /** persons/{personId} (bắt buộc tồn tại). */
  person: Doc | null;
  /** relations/{id} của các quan hệ cha/mẹ của người đó. */
  relations: Record<string, Doc | null>;
  /** auditLogs/edit-{deleteVersion}; chỉ cần khi khôi phục. */
  audit?: Doc | null;
}
export interface DeleteInput {
  op: DeleteOp;
  expectedVersion: number;
  actorUid: string;
}
export interface DeleteResult {
  writes: EditWrite[];
  nextVersion: number;
  focusId: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const SNAPSHOT_MAX_BYTES = 850000;
const rid = (parent: string, child: string) => `r-${parent}-${child}`;
const uid2 = (a: string, b: string) => `u-${[a, b].sort().join("-")}`;

interface Data {
  persons: Record<string, unknown[]>;
  relations: Row[];
  unions: Row[];
  branches?: Record<string, unknown[]>;
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

/** Mã quan hệ cha/mẹ của người cần đọc khi xóa (lấy từ ảnh chụp). */
export function deleteReads(snapshot: Doc, personId: string): string[] {
  return parse(snapshot)
    .relations.filter((r) => r[1] === personId)
    .map((r) => rid(String(r[0]), personId));
}

const isRow = (r: unknown, len: number): r is Row =>
  Array.isArray(r) && r.length === len;
/** Đọc và kiểm tra dữ liệu gỡ khỏi snapshot đã lưu trong nhật ký của lần xóa. */
export function parseDeletedAudit(
  audit: Doc,
  personId: string,
  deleteVersion: number,
) {
  // Firestore không cho mảng lồng mảng: các hàng snapshot gỡ ra được lưu thành MỘT chuỗi JSON.
  let b: Doc | undefined;
  try {
    const raw = (audit.before as Doc | undefined)?.rows;
    b = typeof raw === "string" ? (JSON.parse(raw) as Doc) : undefined;
  } catch {
    b = undefined;
  }
  const person = b?.person;
  const rels = b?.relations;
  const union = b?.union;
  if (
    audit.event !== "PERSON_DELETED" ||
    audit.personId !== personId ||
    audit.editVersion !== deleteVersion ||
    !isRow(person, 7) ||
    typeof person[0] !== "string" ||
    !["C", "S", "E"].includes(String(person[4])) ||
    !Array.isArray(rels) ||
    rels.length > 2 ||
    !rels.every(
      (r) =>
        isRow(r, 5) &&
        typeof r[0] === "string" &&
        ID.test(r[0]) &&
        r[1] === personId &&
        (r[2] === "F" || r[2] === "M") &&
        (r[3] === "A" || r[3] === "B") &&
        (r[4] === 0 || r[4] === 1),
    ) ||
    !(
      union === null ||
      (isRow(union, 3) &&
        typeof union[0] === "string" &&
        typeof union[1] === "string" &&
        (union[0] === personId || union[1] === personId) &&
        (union[2] === null || typeof union[2] === "string"))
    )
  )
    throw new EditError(
      "BAD_STATE",
      "Nhật ký của lần xóa này không đúng hoặc không đọc được.",
    );
  return {
    person: person as unknown[],
    relations: rels as Row[],
    union: union as Row | null,
  };
}

function versionOf(d: Doc | null | undefined): number {
  const v = d?.version;
  if (typeof v !== "number" || !Number.isInteger(v))
    throw new EditError("BAD_STATE", "Thiếu hoặc sai phiên bản quan hệ.");
  return v;
}

export function applyDelete(
  state: DeleteState,
  input: DeleteInput,
): DeleteResult {
  const { op } = input;
  if (op.type !== "deletePerson" && op.type !== "restorePerson")
    invalid("Loại thao tác chưa được hỗ trợ.");
  if (!input.actorUid) invalid("Thiếu người thực hiện.");
  if (typeof op.personId !== "string" || !ID.test(op.personId))
    invalid("Mã người không hợp lệ.");
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
  const id = op.personId;
  const person = state.person;
  if (!person) throw new EditError("NOT_FOUND", "Không thấy người này.");
  const pv = person.profileVersion;
  if (typeof pv !== "number" || !Number.isInteger(pv))
    throw new EditError("BAD_STATE", "Thiếu phiên bản hồ sơ.");
  const writes: EditWrite[] = [];
  let event: "PERSON_DELETED" | "PERSON_RESTORED";
  let relationIds: string[];
  let unionId: string | null;
  let before: Doc;
  let after: Doc;

  if (op.type === "deletePerson") {
    event = "PERSON_DELETED";
    if (op.confirm !== true)
      throw new EditError(
        "CONFIRM_REQUIRED",
        "Cần xác nhận ẩn người này khỏi cây.",
      );
    const tuple = data.persons[id];
    if (!Object.hasOwn(data.persons, id) || !Array.isArray(tuple))
      invalid("Người này không có trong cây.");
    if (person.deleted === true) invalid("Người này đã bị ẩn.");
    const kids = data.relations.filter((r) => r[0] === id);
    if (kids.length)
      invalid(
        `Người này còn ${kids.length} con trong cây; hãy đổi cha/mẹ của các con trước khi ẩn.`,
      );
    if (
      data.branches &&
      Object.values(data.branches).some((b) => Array.isArray(b) && b[1] === id)
    )
      invalid("Người này là người sáng lập một chi; không thể ẩn.");
    const unions = data.unions.filter((u) => u[0] === id || u[1] === id);
    if (unions.length > 1)
      invalid("Người này có nhiều quan hệ vợ/chồng; chưa hỗ trợ ẩn.");
    const parentRows = data.relations.filter((r) => r[1] === id);
    relationIds = parentRows.map((r) => rid(String(r[0]), id));
    unionId = unions[0]
      ? uid2(String(unions[0][0]), String(unions[0][1]))
      : null;
    writes.push({
      path: `persons/${id}`,
      mode: "merge",
      data: {
        deleted: true,
        deletedAt: SERVER_TIME,
        deletedBy: input.actorUid,
        deletedAtVersion: nextVersion,
        profileVersion: pv + 1,
        updatedAt: SERVER_TIME,
        updatedBy: input.actorUid,
      },
    });
    writes.push({ path: `memberProfiles/${id}`, mode: "delete", data: {} });
    for (const rel of relationIds) {
      writes.push({
        path: `relations/${rel}`,
        mode: "merge",
        data: {
          deleted: true,
          deletedAt: SERVER_TIME,
          deletedBy: input.actorUid,
          deletedWith: id,
          version: versionOf(state.relations[rel]) + 1,
        },
      });
    }
    if (unionId)
      writes.push({
        path: `unions/${unionId}`,
        mode: "merge",
        data: {
          deleted: true,
          deletedAt: SERVER_TIME,
          deletedBy: input.actorUid,
          deletedWith: id,
        },
      });
    before = {
      rows: JSON.stringify({
        person: tuple,
        relations: parentRows,
        union: unions[0] ?? null,
      }),
    };
    after = { deleted: true };
    delete data.persons[id];
    data.relations = data.relations.filter((r) => r[1] !== id);
    data.unions = data.unions.filter((u) => u[0] !== id && u[1] !== id);
  } else {
    event = "PERSON_RESTORED";
    if (!Number.isInteger(op.deleteVersion) || op.deleteVersion < 1)
      invalid("Phiên bản nhật ký của lần xóa không hợp lệ.");
    if (person.deleted !== true) invalid("Người này không ở trạng thái ẩn.");
    if (person.deletedAtVersion !== op.deleteVersion)
      invalid("Số phiên bản không khớp với lần ẩn gần nhất của người này.");
    if (Object.hasOwn(data.persons, id))
      throw new EditError("BAD_STATE", "Người này đã có trong cây.");
    if (!state.audit) throw new EditError("NOT_FOUND", "Không thấy nhật ký.");
    const saved = parseDeletedAudit(state.audit, id, op.deleteVersion);
    const known = (x: unknown) =>
      typeof x === "string" && Object.hasOwn(data.persons, x);
    for (const r of saved.relations)
      if (!known(r[0]))
        invalid(
          `Cha/mẹ ${String(r[0])} hiện không có trong cây; hãy khôi phục người đó trước.`,
        );
    if (saved.union) {
      const other = saved.union[0] === id ? saved.union[1] : saved.union[0];
      if (!known(other))
        invalid(
          "Vợ/chồng hiện không có trong cây; hãy khôi phục người đó trước.",
        );
    }
    relationIds = saved.relations.map((r) => rid(String(r[0]), id));
    unionId = saved.union
      ? uid2(String(saved.union[0]), String(saved.union[1]))
      : null;
    const tuple = saved.person;
    const profile: Doc = {
      displayName: person.displayName,
      normalizedName: person.normalizedName,
      profileVersion: pv + 1,
      schemaVersion: 1,
    };
    if (typeof tuple[1] === "number") profile.birthYear = tuple[1];
    if (typeof tuple[2] === "number") profile.deathYear = tuple[2];
    writes.push({
      path: `persons/${id}`,
      mode: "merge",
      data: {
        deleted: false,
        profileVersion: pv + 1,
        updatedAt: SERVER_TIME,
        updatedBy: input.actorUid,
      },
    });
    writes.push({
      path: `memberProfiles/${id}`,
      mode: "create",
      data: profile,
    });
    for (const rel of relationIds)
      writes.push({
        path: `relations/${rel}`,
        mode: "merge",
        data: {
          deleted: false,
          version: versionOf(state.relations[rel]) + 1,
          restoredAt: SERVER_TIME,
          restoredBy: input.actorUid,
        },
      });
    if (unionId)
      writes.push({
        path: `unions/${unionId}`,
        mode: "merge",
        data: {
          deleted: false,
          restoredAt: SERVER_TIME,
          restoredBy: input.actorUid,
        },
      });
    data.persons[id] = tuple;
    for (const r of saved.relations) data.relations.push(r);
    if (saved.union) data.unions.push(saved.union);
    recomputeGenerations(data);
    before = { deleted: true };
    after = { restoredFromVersion: op.deleteVersion };
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
    path: audit,
    mode: "create",
    data: {
      event,
      actorUid: input.actorUid,
      target: `persons/${id}`,
      personId: id,
      createdPersonIds: [],
      relationIds,
      removedRelationIds: [],
      unionId,
      editVersion: nextVersion,
      fields: [op.type === "deletePerson" ? "delete" : "restore"],
      before,
      after,
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
  });
  return {
    writes,
    nextVersion,
    focusId: op.type === "restorePerson" ? id : null,
  };
}
