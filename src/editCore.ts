// Lõi sửa dữ liệu trực tiếp trong app (hàm thuần, không phụ thuộc React/Firebase).
// Mỗi lần sửa tạo ra MỘT lô ghi nguyên tử: persons + memberProfiles + personPrivate +
// treeSnapshots/main + auditLogs/edit-{phiên bản}. firestore.rules kiểm tra lô này (xem editGate).
import {
  FLAG_ORDER,
  setTupleDeceased,
  setTupleSex,
  type FlagCode,
} from "./treeModel";
import { normalizeName } from "./domain";

/**
 * Trần kích thước JSON ảnh chụp cây (byte UTF-8). Phải nhỏ hơn giới hạn
 * `data.size() < 900000` của treeSnapshots/main trong firestore.rules (chừa biên cho
 * phần siêu dữ liệu); đổi một nơi phải đổi nơi kia.
 */
export const SNAPSHOT_MAX_BYTES = 850000;
/** Đếm byte UTF-8 (không phải số ký tự) vì rules/Firestore tính theo byte. */
export const exceedsSnapshotLimit = (json: string) =>
  new TextEncoder().encode(json).length > SNAPSHOT_MAX_BYTES;

export class EditError extends Error {
  constructor(
    public code:
      | "NO_CHANGE"
      | "INVALID"
      | "NOT_FOUND"
      | "VERSION_CONFLICT"
      | "BAD_STATE"
      | "CONFIRM_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}

export interface PersonChanges {
  name?: string;
  birthYear?: number | null;
  deathYear?: number | null;
  note?: string;
  branch?: string | null;
  sex?: "M" | "F" | null;
  /** Đã mất (không rõ năm). Chỉ có nghĩa là true/false; năm mất vẫn quản lý riêng bằng deathYear. */
  deceased?: boolean;
  addFlags?: FlagCode[];
  /** Gỡ cờ = đã xác minh. */
  removeFlags?: FlagCode[];
  /** Cho phép thay văn bản ngày gốc "không rõ/mâu thuẫn" bằng năm mới. */
  replaceRawDate?: boolean;
}
export interface UpdatePersonOp {
  type: "updatePerson";
  personId: string;
  changes: PersonChanges;
}
export type EditOp = UpdatePersonOp;

type Doc = Record<string, unknown>;
/** Trạng thái hiện tại đọc trong cùng giao dịch với lúc ghi. */
export interface EditState {
  /** treeSnapshots/main */
  snapshot: Doc;
  /** persons/{id} (bắt buộc tồn tại) */
  person: Doc | null;
  /** memberProfiles/{id} (bắt buộc tồn tại) */
  profile: Doc | null;
  /** personPrivate/{id} (có thể chưa có) */
  priv: Doc | null;
}
/** Dấu thay bằng serverTimestamp() ở editClient; rules đòi thời điểm == request.time. */
export const SERVER_TIME = { __serverTime: true } as const;
export interface EditInput {
  op: EditOp;
  /** Phiên bản mà người sửa đã nhìn thấy; lệch với dữ liệu hiện tại thì từ chối. */
  expectedVersion: number;
  actorUid: string;
}
export interface EditWrite {
  path: string;
  /** "set" ghi cả tài liệu; "merge" chỉ ghi các trường đưa vào; "delete" xóa tài liệu (chỉ memberProfiles). */
  mode: "set" | "merge" | "create" | "delete";
  data: Doc;
}
export interface EditResult {
  writes: EditWrite[];
  nextVersion: number;
  changedFields: string[];
}

export const NAME_MAX = 120;
export const NOTE_MAX = 2000;
export const YEAR_MIN = 1000;
export const YEAR_MAX = 2200;
const KNOWN_FIELDS = [
  "name",
  "birthYear",
  "deathYear",
  "note",
  "branch",
  "sex",
  "deceased",
  "addFlags",
  "removeFlags",
  "replaceRawDate",
];
export const CONTROL = /[\p{Cc}\p{Cf}]/u;

export function currentEditVersion(snapshot: Doc): number {
  const v = snapshot.editVersion;
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
    throw new EditError("BAD_STATE", "editVersion của ảnh chụp không hợp lệ.");
  return v;
}

export function invalid(message: string): never {
  throw new EditError("INVALID", message);
}
export function checkYear(label: string, v: unknown) {
  if (v === null) return;
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < YEAR_MIN ||
    v > YEAR_MAX
  )
    invalid(`${label} phải là số nguyên từ ${YEAR_MIN} đến ${YEAR_MAX}.`);
}
/** Đổi năm nhưng giữ tháng/ngày của ngày gốc; ngày "không rõ" chỉ thay khi đã xác nhận. */
function dateWithYear(
  existing: unknown,
  year: number | null,
  confirm: boolean,
) {
  if (year === null) return null;
  const e = existing && typeof existing === "object" ? (existing as Doc) : null;
  if (
    e &&
    typeof e.month === "number" &&
    (e.precision === "DAY" || e.precision === "MONTH")
  ) {
    const parts =
      e.precision === "DAY" && typeof e.day === "number"
        ? [e.day, e.month, year]
        : [e.month, year];
    return { ...e, year, originalText: parts.join("/") };
  }
  if (e && e.precision === "UNKNOWN" && !confirm)
    invalid(
      "Ngày gốc đang ghi không rõ hoặc mâu thuẫn; cần xác nhận thay thế (replaceRawDate).",
    );
  return yearDate(year);
}
export function yearDate(year: number | null) {
  return year === null
    ? null
    : {
        calendar: "SOLAR",
        year,
        month: null,
        day: null,
        precision: "YEAR",
        approximate: false,
        originalText: String(year),
      };
}
function sameFlags(a: FlagCode[], b: FlagCode[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function flagSet(codes: unknown, label: string): FlagCode[] {
  if (codes === undefined) return [];
  if (!Array.isArray(codes)) invalid(`${label} phải là danh sách.`);
  for (const c of codes)
    if (!(FLAG_ORDER as string[]).includes(c as string))
      invalid(`${label}: mã cờ không hợp lệ.`);
  return codes as FlagCode[];
}

/** Áp một thao tác sửa lên trạng thái hiện tại và trả về lô ghi; ném EditError nếu không hợp lệ. */
export function applyEdit(state: EditState, input: EditInput): EditResult {
  const { op } = input;
  if (op.type !== "updatePerson") invalid("Loại thao tác chưa được hỗ trợ.");
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
  const id = op.personId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    invalid("Mã người không hợp lệ.");
  for (const key of Object.keys(op.changes))
    if (!KNOWN_FIELDS.includes(key)) invalid(`Trường không được phép: ${key}.`);

  if (
    state.snapshot.schemaVersion !== 1 ||
    typeof state.snapshot.data !== "string"
  )
    throw new EditError("BAD_STATE", "Ảnh chụp cây không hợp lệ.");
  let data: {
    persons: Record<string, unknown[]>;
    branches?: Record<string, unknown[]>;
  };
  try {
    data = JSON.parse(state.snapshot.data);
  } catch {
    throw new EditError("BAD_STATE", "Ảnh chụp cây không đọc được.");
  }
  const tuple = data.persons?.[id];
  if (!Array.isArray(tuple) || tuple.length < 6)
    throw new EditError("NOT_FOUND", "Không thấy người này trong cây.");
  if (!state.person || !state.profile)
    throw new EditError("NOT_FOUND", "Thiếu hồ sơ của người này.");

  const cur = {
    name: tuple[0] as string,
    birthYear: tuple[1] as number | null,
    deathYear: tuple[2] as number | null,
    branch: tuple[5] as string | null,
    flags: FLAG_ORDER.filter((c) =>
      ((tuple[6] as FlagCode[] | undefined) ?? []).includes(c),
    ),
    sex: (state.person.sex === "M"
      ? "M"
      : state.person.sex === "F"
        ? "F"
        : null) as "M" | "F" | null,
    note: typeof state.priv?.note === "string" ? state.priv.note : "",
    deceased: state.person.deceased === true,
  };
  const ch = op.changes;
  const next = { ...cur };

  if (ch.name !== undefined) {
    if (typeof ch.name !== "string") invalid("Tên phải là chữ.");
    const name = ch.name.normalize("NFC").trim().replace(/\s+/g, " ");
    if (!name || name.length > NAME_MAX || CONTROL.test(name))
      invalid(
        `Tên không được trống, tối đa ${NAME_MAX} ký tự, không có ký tự điều khiển.`,
      );
    next.name = name;
  }
  if (ch.birthYear !== undefined) {
    checkYear("Năm sinh", ch.birthYear);
    next.birthYear = ch.birthYear;
  }
  if (ch.deathYear !== undefined) {
    checkYear("Năm mất", ch.deathYear);
    next.deathYear = ch.deathYear;
  }
  if (
    (ch.birthYear !== undefined || ch.deathYear !== undefined) &&
    next.birthYear !== null &&
    next.deathYear !== null &&
    next.deathYear < next.birthYear
  )
    invalid("Năm mất không được trước năm sinh.");
  if (ch.note !== undefined) {
    if (typeof ch.note !== "string") invalid("Ghi chú phải là chữ.");
    const note = ch.note.trim();
    if (note.length > NOTE_MAX) invalid(`Ghi chú tối đa ${NOTE_MAX} ký tự.`);
    if (/[\p{Cc}\p{Cf}]/u.test(note.replace(/[\n\t]/g, "")))
      invalid("Ghi chú có ký tự điều khiển.");
    next.note = note;
  }
  if (ch.branch !== undefined) {
    if (
      ch.branch !== null &&
      !(
        typeof ch.branch === "string" &&
        Object.hasOwn(data.branches ?? {}, ch.branch)
      )
    )
      invalid("Chi không tồn tại.");
    next.branch = ch.branch;
  }
  if (ch.deceased !== undefined) {
    if (typeof ch.deceased !== "boolean") invalid("Đã mất phải là đúng/sai.");
    next.deceased = ch.deceased;
  }
  if (ch.sex !== undefined) {
    if (ch.sex !== null && ch.sex !== "M" && ch.sex !== "F")
      invalid("Giới tính không hợp lệ.");
    // Không âm thầm ghi đè mâu thuẫn phả hệ: cha phải là nam, mẹ phải là nữ (nếu đã có giới tính).
    const rels = ((data as { relations?: unknown[][] }).relations ??
      []) as unknown[][];
    const conflict = rels.some(
      (r) =>
        r[0] === id &&
        ((r[2] === "F" && ch.sex === "F") || (r[2] === "M" && ch.sex === "M")),
    );
    if (conflict)
      invalid(
        "Giới tính mới mâu thuẫn với vai trò cha/mẹ trong quan hệ; hãy xử lý quan hệ trước.",
      );
    next.sex = ch.sex;
  }
  const add = flagSet(ch.addFlags, "addFlags");
  const remove = flagSet(ch.removeFlags, "removeFlags");
  if (add.some((c) => remove.includes(c)))
    invalid("Một cờ không thể vừa thêm vừa gỡ.");
  if (add.length || remove.length) {
    const set = new Set(cur.flags);
    for (const c of add) set.add(c);
    for (const c of remove) set.delete(c);
    next.flags = FLAG_ORDER.filter((c) => set.has(c));
  }

  const changedFields: string[] = [];
  const before: Doc = {};
  const after: Doc = {};
  const track = (field: string, a: unknown, b: unknown) => {
    changedFields.push(field);
    before[field] = a;
    after[field] = b;
  };
  if (next.name !== cur.name) track("name", cur.name, next.name);
  if (next.birthYear !== cur.birthYear)
    track("birthYear", cur.birthYear, next.birthYear);
  if (next.deathYear !== cur.deathYear)
    track("deathYear", cur.deathYear, next.deathYear);
  // Nhật ký không lưu nguyên văn ghi chú (riêng tư, không xóa được); chỉ ghi độ dài.
  if (next.note !== cur.note)
    track("note", { chars: cur.note.length }, { chars: next.note.length });
  if (next.branch !== cur.branch) track("branch", cur.branch, next.branch);
  if (next.sex !== cur.sex) track("sex", cur.sex, next.sex);
  if (next.deceased !== cur.deceased)
    track("deceased", cur.deceased, next.deceased);
  if (
    !sameFlags(
      next.flags,
      FLAG_ORDER.filter((c) => cur.flags.includes(c)),
    )
  )
    track("flags", cur.flags, next.flags);
  if (!changedFields.length)
    throw new EditError("NO_CHANGE", "Không có thay đổi nào.");

  const nextVersion = version + 1;
  const profileVersion = state.profile.profileVersion;
  const personVersion = state.person.profileVersion;
  if (
    typeof profileVersion !== "number" ||
    typeof personVersion !== "number" ||
    !Number.isInteger(profileVersion) ||
    !Number.isInteger(personVersion)
  )
    throw new EditError("BAD_STATE", "profileVersion thiếu hoặc không hợp lệ.");
  const confirm = ch.replaceRawDate === true;
  const birthDoc = changedFields.includes("birthYear")
    ? dateWithYear(state.person.birth, next.birthYear, confirm)
    : undefined;
  const deathDoc = changedFields.includes("deathYear")
    ? dateWithYear(state.person.death, next.deathYear, confirm)
    : undefined;
  if (birthDoc !== undefined) {
    before.birth = state.person.birth ?? null;
    after.birth = birthDoc;
  }
  if (deathDoc !== undefined) {
    before.death = state.person.death ?? null;
    after.death = deathDoc;
  }

  // Ảnh chụp cây: cập nhật đúng bộ dữ liệu của người này, giữ nguyên phần còn lại.
  const newTuple = tuple.slice();
  newTuple[0] = next.name;
  newTuple[1] = next.birthYear;
  newTuple[2] = next.deathYear;
  newTuple[5] = next.branch;
  newTuple[6] = next.flags;
  // Giới tính luôn ghi theo persons (nguồn chuẩn) để ảnh chụp không lệch; bộ 6 phần tử được nâng lên 8.
  setTupleSex(newTuple, next.sex);
  setTupleDeceased(newTuple, next.deceased);
  data.persons[id] = newTuple;

  const writes: EditWrite[] = [];
  const personData: Doc = {
    profileVersion: personVersion + 1,
    updatedAt: SERVER_TIME,
    updatedBy: input.actorUid,
  };
  if (changedFields.includes("name")) {
    personData.displayName = next.name;
    personData.normalizedName = normalizeName(next.name);
  }
  if (birthDoc !== undefined) personData.birth = birthDoc;
  if (deathDoc !== undefined) personData.death = deathDoc;
  if (changedFields.includes("branch")) personData.branchCode = next.branch;
  if (changedFields.includes("sex")) {
    personData.sex = next.sex;
    personData.sexBasis = "MANUAL";
  }
  if (changedFields.includes("deceased")) personData.deceased = next.deceased;
  if (changedFields.includes("flags")) personData.reviewFlags = next.flags;
  writes.push({ path: `persons/${id}`, mode: "merge", data: personData });

  // memberProfiles chỉ chứa phần thành viên được thấy; dựng lại đầy đủ để không còn trường cũ.
  const profile: Doc = {
    displayName: next.name,
    normalizedName: normalizeName(next.name),
    profileVersion: profileVersion + 1,
    schemaVersion: 1,
  };
  if (next.birthYear !== null) profile.birthYear = next.birthYear;
  if (next.deathYear !== null) profile.deathYear = next.deathYear;
  writes.push({ path: `memberProfiles/${id}`, mode: "set", data: profile });

  if (changedFields.includes("note"))
    writes.push({
      path: `personPrivate/${id}`,
      mode: "merge",
      data: { note: next.note, schemaVersion: 1 },
    });

  writes.push({
    path: "treeSnapshots/main",
    mode: "merge",
    data: { data: JSON.stringify(data), editVersion: nextVersion },
  });
  writes.push({
    path: `auditLogs/edit-${nextVersion}`,
    mode: "create",
    data: {
      event: "PERSON_EDITED",
      actorUid: input.actorUid,
      target: `persons/${id}`,
      personId: id,
      editVersion: nextVersion,
      fields: changedFields,
      before,
      after,
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
  });
  return { writes, nextVersion, changedFields };
}
