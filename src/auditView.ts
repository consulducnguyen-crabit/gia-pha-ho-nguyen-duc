// Lõi thuần cho trang "Nhật ký chỉnh sửa" (chỉ quản trị viên): biến bản ghi auditLogs/edit-{n} thành dòng hiển thị.
// Không phụ thuộc React/Firebase để kiểm thử được. Bản ghi là dữ liệu KHÔNG TIN CẬY: mọi trường đều kiểm kiểu,
// cắt độ dài và chỉ trả về chuỗi thuần (giao diện render bằng text React, không HTML).
// Quyền riêng tư: ghi chú riêng không bao giờ hiện nguyên văn (chỉ độ dài); ngày đầy đủ (ngày/tháng, âm lịch)
// chỉ nằm ở `details`, bảng chính chỉ hiện năm.
import { normalizeName } from "./domain";
import { FLAG_LABELS } from "./treeModel";

export const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
export const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;
export const MAX_TEXT = 200;
const MAX_ROWS_JSON = 100_000;
const MAX_LIST = 20;

/** Số bản ghi mỗi lần tải và trần của nút "Tải toàn bộ" (mỗi bản là một lượt đọc Firestore). */
export const PAGE_SIZE = 20;
export const LOAD_ALL_CAP = 500;

// Phải khớp danh sách ở firestore.rules (allow get của auditLogs và auditCreateOk); có test đối chiếu.
export const EVENT_LABELS: Record<string, string> = {
  PERSON_EDITED: "Sửa hồ sơ",
  PERSON_ADDED: "Thêm người con",
  SPOUSE_ADDED: "Thêm vợ/chồng",
  PARENT_CHANGED: "Đặt hoặc đổi cha/mẹ",
  PARENT_REVERTED: "Hoàn tác lần thay cha/mẹ",
  PARENT_REMOVED: "Gỡ quan hệ cha/mẹ",
  PARENT_REMOVAL_UNDONE: "Khôi phục quan hệ cha/mẹ đã gỡ",
  RELATION_TYPE_CHANGED: "Đổi loại con (ruột/nuôi)",
  PERSON_DELETED: "Ẩn người khỏi cây",
  PERSON_RESTORED: "Khôi phục người đã ẩn",
  UNION_REMOVED: "Gỡ liên kết vợ/chồng",
  UNION_REMOVAL_UNDONE: "Khôi phục liên kết vợ/chồng đã gỡ",
};
export const AUDIT_EVENTS = Object.keys(EVENT_LABELS);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Bỏ ký tự điều khiển và cắt độ dài. */
function clip(value: string, max = MAX_TEXT): string {
  const clean = value.replace(/\p{Cc}/gu, " ");
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}
function text(value: unknown): string | null {
  if (typeof value === "string") return clip(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "có" : "không";
  return null;
}
function int(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Math.abs(value) < 1e9
    ? value
    : null;
}
function idOf(value: unknown): string | null {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

const fmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Ho_Chi_Minh",
});
/** Định dạng thời điểm theo giờ Việt Nam; nhận Timestamp của Firestore (có toDate), Date; sai kiểu thì trả "". */
export function formatVnTime(value: unknown): string {
  let date: unknown = value;
  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    try {
      date = (value as { toDate(): unknown }).toDate();
    } catch {
      return "";
    }
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  // Ghép tay thành dd/mm/yyyy HH:mm (thứ tự mặc định của vi-VN đặt giờ trước ngày).
  const p = Object.fromEntries(
    fmt.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Mã người rút gọn để hiện khi không tra được tên: abcd…wxyz. */
export function shortUid(uid: string): string {
  const s = clip(uid, 128);
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

/** Danh sách phiên bản của một trang, giảm dần từ `next` xuống tối đa `size` bản, dừng ở 1. */
export function pageVersions(next: number, size: number): number[] {
  if (!Number.isInteger(next) || next < 1) return [];
  if (!Number.isInteger(size) || size < 1) return [];
  const low = Math.max(1, next - size + 1);
  const out: number[] = [];
  for (let v = next; v >= low; v--) out.push(v);
  return out;
}

// ---- Kết quả đọc từng bản ghi -------------------------------------------------------------------------------------
// Mã nhật ký không tồn tại cũng trả permission-denied (rules cần resource.data), nên "denied" gồm cả bản thiếu.
export type ReadOutcome =
  | { version: number; status: "ok"; data: unknown }
  | { version: number; status: "denied" }
  | { version: number; status: "missing" }
  | { version: number; status: "failed" };
export type RawRead = PromiseSettledResult<{ exists: boolean; data: unknown }>;

export function classifyRead(version: number, read: RawRead): ReadOutcome {
  if (read.status === "fulfilled")
    return read.value.exists
      ? { version, status: "ok", data: read.value.data }
      : { version, status: "missing" };
  const code =
    read.reason && typeof read.reason === "object" && "code" in read.reason
      ? String((read.reason as { code: unknown }).code)
      : "";
  // Chỉ permission-denied mới là "thiếu/ngoài phạm vi"; lỗi mạng/unavailable thì thử lại được.
  return code === "permission-denied" || code === "firestore/permission-denied"
    ? { version, status: "denied" }
    : { version, status: "failed" };
}

/** Cả loạt (>= 2 bản) đều bị từ chối: gần như chắc chắn mất quyền, không phải do bản thiếu rải rác. */
export function lostAccess(batch: ReadOutcome[]): boolean {
  return batch.length >= 2 && batch.every((o) => o.status === "denied");
}

// ---- Mô tả một bản ghi -------------------------------------------------------------------------------------------
export interface PersonRef {
  /** Mã an toàn (khớp SAFE_ID) hoặc null nếu mã lạ. */
  id: string | null;
  label: string;
  /** Chỉ true khi mã an toàn VÀ người có trong ảnh chụp cây hiện tại. */
  link: boolean;
  /** Mã an toàn nhưng không có trong cây (đã ẩn hoặc không tồn tại). */
  hidden: boolean;
}
export type PersonLookup = (id: string) => { name: string } | null;

export interface AuditView {
  version: number;
  event: string;
  eventLabel: string;
  known: boolean;
  time: string;
  /** Mã người thực hiện (chỉ khi hợp lệ), rỗng nếu không đọc được. */
  actorUid: string;
  person: PersonRef;
  summary: string[];
  details: string[];
  /** Mã và tên (đã chuẩn hóa) của mọi người liên quan, dùng cho ô lọc. */
  searchIds: string;
  searchNames: string[];
}

export function refText(ref: PersonRef): string {
  return ref.hidden ? `${ref.label} (đã ẩn)` : ref.label;
}

/** rows của PERSON_DELETED là chuỗi JSON do client ghi: chỉ parse khi nhỏ, lỗi thì bỏ qua. */
export function parseDeletedRows(
  rows: unknown,
): { name: string | null; relations: number; unions: number } | null {
  if (typeof rows !== "string" || rows.length > MAX_ROWS_JSON) return null;
  let value: unknown;
  try {
    value = JSON.parse(rows);
  } catch {
    return null;
  }
  if (!isRec(value)) return null;
  const person = Array.isArray(value.person) ? value.person : null;
  return {
    name: person && typeof person[0] === "string" ? clip(person[0]) : null,
    relations: Array.isArray(value.relations) ? value.relations.length : 0,
    unions:
      (Array.isArray(value.union) ? 1 : 0) +
      (Array.isArray(value.moreUnions) ? value.moreUnions.length : 0),
  };
}

const ROLE = (v: unknown) =>
  v === "FATHER" ? "cha" : v === "MOTHER" ? "mẹ" : "cha/mẹ";
const CATEGORY: Record<string, string> = {
  CLAN: "thuộc dòng họ",
  SPOUSE: "vợ/chồng",
  EXTERNAL: "họ ngoại",
};
function relType(v: unknown): string | null {
  return v === "ADOPTIVE" ? "con nuôi" : v === "BIOLOGICAL" ? "con ruột" : null;
}
function adoptiveType(v: unknown): string | null {
  return v === true ? "con nuôi" : v === false ? "con ruột" : null;
}
const FIELD_LABEL: Record<string, string> = {
  name: "Họ tên",
  birthYear: "Năm sinh",
  deathYear: "Năm mất",
  note: "Ghi chú riêng",
  branch: "Chi",
  sex: "Giới tính",
  flags: "Cờ cần kiểm tra",
};

function fieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "không có";
  if (field === "sex")
    return value === "M" ? "nam" : value === "F" ? "nữ" : "chưa rõ";
  if (field === "flags") {
    if (!Array.isArray(value)) return "không hợp lệ";
    if (!value.length) return "không có";
    return value
      .slice(0, MAX_LIST)
      .map((c) =>
        typeof c === "string" && Object.hasOwn(FLAG_LABELS, c)
          ? FLAG_LABELS[c as keyof typeof FLAG_LABELS]
          : "mã cờ lạ",
      )
      .join("; ");
  }
  return text(value) ?? "không hợp lệ";
}

/** Ngày đầy đủ: chỉ dùng ở phần chi tiết. */
function dateText(value: unknown): string {
  if (value === null || value === undefined) return "không có";
  if (!isRec(value)) return "không hợp lệ";
  const parts = [int(value.day), int(value.month), int(value.year)].filter(
    (n) => n !== null,
  );
  const calendar =
    value.calendar === "LUNAR"
      ? " âm lịch"
      : value.calendar === "SOLAR"
        ? " dương lịch"
        : "";
  const approx = value.approximate === true ? " (ước chừng)" : "";
  const raw =
    typeof value.originalText === "string"
      ? ` · bản gốc: “${clip(value.originalText, 80)}”`
      : "";
  return (parts.join("/") || "không rõ") + calendar + approx + raw;
}

function noteLine(before: unknown, after: unknown): string {
  const b = isRec(before) ? int(before.chars) : null;
  const a = isRec(after) ? int(after.chars) : null;
  return b !== null && a !== null
    ? `Ghi chú riêng: đã thay đổi (${b} → ${a} ký tự)`
    : "Ghi chú riêng: đã thay đổi";
}

/**
 * Biến bản ghi nhật ký thành các dòng hiển thị. `lookup` tra người trong ảnh chụp cây hiện tại; mã không có trong
 * cây được coi là đã ẩn và không có liên kết.
 */
export function describeAudit(
  version: number,
  data: unknown,
  lookup: PersonLookup,
): AuditView {
  const d: Rec = isRec(data) ? data : {};
  const before: Rec = isRec(d.before) ? d.before : {};
  const after: Rec = isRec(d.after) ? d.after : {};
  const event = typeof d.event === "string" ? clip(d.event, 60) : "";
  const known = Object.hasOwn(EVENT_LABELS, event);
  const summary: string[] = [];
  const details: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  const ref = (raw: unknown, hint: string | null = null): PersonRef => {
    const id = idOf(raw);
    if (!id)
      return {
        id: null,
        label: hint ?? "mã người không hợp lệ",
        link: false,
        hidden: false,
      };
    ids.add(id.toLowerCase());
    const found = lookup(id);
    const label = found ? clip(found.name) : (hint ?? id);
    if (found || hint) names.add(normalizeName(label));
    return found
      ? { id, label, link: true, hidden: false }
      : { id, label, link: false, hidden: true };
  };

  const personId = d.personId;
  const created = Array.isArray(d.createdPersonIds)
    ? d.createdPersonIds.slice(0, MAX_LIST)
    : [];
  for (const c of created) ref(c);
  const revertsVersion = int(d.revertsVersion);
  const revertText =
    revertsVersion !== null && revertsVersion >= 1
      ? `hoàn tác lần ở phiên bản #${revertsVersion}`
      : "";
  let hint: string | null = null;
  const removed = isRec(before.removed) ? before.removed : null;

  switch (event) {
    case "PERSON_EDITED": {
      const fields = Array.isArray(d.fields) ? d.fields : null;
      if (!fields) summary.push("Không đọc được danh sách trường đã đổi.");
      for (const f of (fields ?? []).slice(0, MAX_LIST)) {
        if (typeof f !== "string") continue;
        if (f === "note") summary.push(noteLine(before.note, after.note));
        else if (Object.hasOwn(FIELD_LABEL, f))
          summary.push(
            `${FIELD_LABEL[f]}: ${fieldValue(f, before[f])} → ${fieldValue(f, after[f])}`,
          );
        else summary.push(`Trường khác: ${clip(f, 40)}`);
      }
      if (typeof after.name === "string") hint = clip(after.name);
      else if (typeof before.name === "string") hint = clip(before.name);
      for (const [key, label] of [
        ["birth", "Ngày sinh đầy đủ"],
        ["death", "Ngày mất đầy đủ"],
      ] as const)
        if (key in before || key in after)
          details.push(
            `${label}: ${dateText(before[key])} → ${dateText(after[key])}`,
          );
      break;
    }
    case "PERSON_ADDED": {
      const name = typeof after.name === "string" ? clip(after.name) : null;
      hint = name;
      const cat =
        typeof after.category === "string" &&
        Object.hasOwn(CATEGORY, after.category)
          ? CATEGORY[after.category]
          : null;
      summary.push(
        `Thêm người: ${name ?? "(không rõ tên)"}${cat ? ` (${cat})` : ""}`,
      );
      if (after.fatherId) summary.push(`Cha: ${refText(ref(after.fatherId))}`);
      if (after.motherId) summary.push(`Mẹ: ${refText(ref(after.motherId))}`);
      const kind = adoptiveType(after.adoptive);
      if (kind) summary.push(`Loại con: ${kind}`);
      const chars = int(after.noteChars);
      if (chars !== null && chars > 0)
        details.push(`Có ghi chú riêng (${chars} ký tự); nội dung không hiện.`);
      break;
    }
    case "SPOUSE_ADDED": {
      const spouse = ref(after.spouseId);
      summary.push(
        `Thêm vợ/chồng: ${refText(spouse)}${after.newPerson === true ? " (người mới tạo)" : ""}`,
      );
      const order = text(after.order);
      if (order) details.push(`Thứ tự: ${order}`);
      break;
    }
    case "PARENT_CHANGED": {
      const role = ROLE(after.role);
      const now = refText(ref(after.parentId));
      const kind = adoptiveType(after.adoptive);
      const suffix = kind ? ` (${kind})` : "";
      summary.push(
        removed
          ? `Thay ${role}: ${refText(ref(removed.parentId))} → ${now}${suffix}`
          : `Đặt ${role}: ${now}${suffix}`,
      );
      break;
    }
    case "PARENT_REVERTED": {
      const reverted = isRec(before.reverted) ? before.reverted : null;
      summary.push(
        `Hoàn tác lần thay ${ROLE(after.role)}: ${reverted ? refText(ref(reverted.parentId)) : "?"} → ${refText(ref(after.parentId))}`,
      );
      if (revertText) details.push(`Đã ${revertText}.`);
      break;
    }
    case "PARENT_REMOVED":
      summary.push(
        `Gỡ ${ROLE(removed?.role)}: ${removed ? refText(ref(removed.parentId)) : "?"}`,
      );
      break;
    case "PARENT_REMOVAL_UNDONE":
      summary.push(
        `Khôi phục ${ROLE(after.role)}: ${refText(ref(after.parentId))}`,
      );
      if (revertText) details.push(`Đã ${revertText}.`);
      break;
    case "RELATION_TYPE_CHANGED": {
      // relationIds[0] có dạng r-{cha/mẹ}-{con}; lấy mã cha/mẹ từ đó để nêu rõ đang đổi quan hệ nào.
      const rel = Array.isArray(d.relationIds) ? d.relationIds[0] : null;
      const child = idOf(personId);
      let parent: PersonRef | null = null;
      if (
        typeof rel === "string" &&
        child &&
        rel.startsWith("r-") &&
        rel.endsWith(`-${child}`)
      )
        parent = ref(rel.slice(2, rel.length - child.length - 1));
      summary.push(
        `Loại con${parent ? ` (với ${refText(parent)})` : ""}: ${relType(before.relationType) ?? "không rõ"} → ${relType(after.relationType) ?? "không rõ"}`,
      );
      break;
    }
    case "PERSON_DELETED": {
      const rows = parseDeletedRows(before.rows);
      hint = rows?.name ?? null;
      summary.push("Ẩn người này khỏi cây (xóa mềm, có thể khôi phục).");
      if (rows)
        details.push(
          `Kèm ${rows.relations} quan hệ cha/mẹ và ${rows.unions} liên kết vợ/chồng bị ẩn theo.`,
        );
      break;
    }
    case "PERSON_RESTORED": {
      const from = int(after.restoredFromVersion);
      summary.push(
        from !== null
          ? `Khôi phục người đã ẩn (lần ẩn ở phiên bản #${from}).`
          : "Khôi phục người đã ẩn.",
      );
      break;
    }
    case "UNION_REMOVED": {
      summary.push(
        `Gỡ liên kết vợ/chồng với ${removed ? refText(ref(removed.spouseId)) : "?"}`,
      );
      const order = text(removed?.order);
      if (order) details.push(`Thứ tự: ${order}`);
      break;
    }
    case "UNION_REMOVAL_UNDONE": {
      summary.push(
        `Khôi phục liên kết vợ/chồng với ${refText(ref(after.spouseId))}${revertText ? ` (${revertText})` : ""}`,
      );
      const order = text(after.order);
      if (order) details.push(`Thứ tự: ${order}`);
      break;
    }
    default: {
      const fields = Array.isArray(d.fields)
        ? d.fields
            .slice(0, MAX_LIST)
            .filter((f): f is string => typeof f === "string")
            .map((f) => clip(f, 40))
        : [];
      summary.push(
        fields.length
          ? `Trường liên quan: ${fields.join(", ")}`
          : "Không có mô tả cho sự kiện này.",
      );
    }
  }

  const person = ref(personId, hint);
  const actorUid =
    typeof d.actorUid === "string" && SAFE_UID.test(d.actorUid)
      ? d.actorUid
      : "";
  if (!summary.length) summary.push("Không đọc được nội dung thay đổi.");
  return {
    version,
    event,
    eventLabel: known
      ? EVENT_LABELS[event]
      : `Sự kiện khác (${event || "không rõ"})`,
    known,
    time: formatVnTime(d.timestamp),
    actorUid,
    person,
    summary,
    details,
    searchIds: [...ids].join(" "),
    searchNames: [...names],
  };
}

export interface AuditFilter {
  /** Mã sự kiện; rỗng = tất cả. */
  event: string;
  /** Mã người hoặc phần tên (không cần gõ dấu); rỗng = tất cả. */
  text: string;
}

/** Lọc trong các bản đã tải: mã người (personId, người mới tạo, vợ/chồng, cha/mẹ...) hoặc tên. */
export function matchesFilter(view: AuditView, filter: AuditFilter): boolean {
  if (filter.event && view.event !== filter.event) return false;
  const t = filter.text.trim();
  if (!t) return true;
  return (
    view.searchIds.split(" ").some((id) => id.includes(t.toLowerCase())) ||
    view.searchNames.some((n) => n.includes(normalizeName(t)))
  );
}
