// Logic thuần của biểu mẫu sửa hồ sơ: đổi giá trị nhập thành PersonChanges và dịch lỗi sang tiếng Việt.
import {
  EditError,
  NAME_MAX,
  NOTE_MAX,
  YEAR_MAX,
  YEAR_MIN,
  type PersonChanges,
} from "./editCore";
import { FLAG_ORDER, type FlagCode } from "./treeModel";

export interface FormValues {
  name: string;
  birthYear: string;
  deathYear: string;
  sex: "" | "M" | "F";
  branch: string;
  note: string;
  flags: FlagCode[];
  /** Xác nhận thay văn bản ngày gốc "không rõ/mâu thuẫn" bằng năm mới. */
  replaceRawDate: boolean;
}
export type FormErrors = Partial<Record<keyof FormValues | "form", string>>;

/** Chuẩn hóa tên giống lõi (NFC, gộp khoảng trắng) để so sánh ổn định. */
export function normalizeNameInput(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function parseYear(text: string, label: string): number | null | string {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,4}$/.test(t)) return `${label}: nhập số năm, ví dụ 1950.`;
  const n = Number(t);
  if (n < YEAR_MIN || n > YEAR_MAX)
    return `${label}: phải từ ${YEAR_MIN} đến ${YEAR_MAX}.`;
  return n;
}

/** So giá trị nhập với giá trị ban đầu; chỉ gửi những trường thật sự đổi. */
export function buildChanges(
  initial: FormValues,
  values: FormValues,
): { changes: PersonChanges } | { errors: FormErrors } {
  const errors: FormErrors = {};
  const changes: PersonChanges = {};
  const name = normalizeNameInput(values.name);
  if (!name) errors.name = "Nhập họ tên.";
  else if (name.length > NAME_MAX)
    errors.name = `Họ tên tối đa ${NAME_MAX} ký tự.`;
  else if (name !== initial.name) changes.name = name;

  for (const key of ["birthYear", "deathYear"] as const) {
    const label = key === "birthYear" ? "Năm sinh" : "Năm mất";
    const parsed = parseYear(values[key], label);
    if (typeof parsed === "string") errors[key] = parsed;
    else if (values[key].trim() !== initial[key].trim()) changes[key] = parsed;
  }
  const b =
    "birthYear" in changes
      ? changes.birthYear
      : parseYear(initial.birthYear, "");
  const d =
    "deathYear" in changes
      ? changes.deathYear
      : parseYear(initial.deathYear, "");
  if (
    !errors.deathYear &&
    typeof b === "number" &&
    typeof d === "number" &&
    d < b &&
    (changes.birthYear !== undefined || changes.deathYear !== undefined)
  )
    errors.deathYear = "Năm mất không được trước năm sinh.";

  if (values.note.trim().length > NOTE_MAX)
    errors.note = `Ghi chú tối đa ${NOTE_MAX} ký tự.`;
  else if (values.note.trim() !== initial.note.trim())
    changes.note = values.note.trim();
  if (values.sex !== initial.sex) changes.sex = values.sex || null;
  if (values.branch !== initial.branch) changes.branch = values.branch || null;

  const add = FLAG_ORDER.filter(
    (c) => values.flags.includes(c) && !initial.flags.includes(c),
  );
  const remove = FLAG_ORDER.filter(
    (c) => !values.flags.includes(c) && initial.flags.includes(c),
  );
  if (add.length) changes.addFlags = add;
  if (remove.length) changes.removeFlags = remove;
  if (values.replaceRawDate) changes.replaceRawDate = true;

  if (Object.keys(errors).length) return { errors };
  const meaningful = Object.keys(changes).filter((k) => k !== "replaceRawDate");
  if (!meaningful.length)
    return { errors: { form: "Chưa có thay đổi nào để lưu." } };
  return { changes };
}

/** Thông báo cho người dùng từ lỗi lõi hoặc lỗi Firestore. */
export function saveErrorMessage(error: unknown): string {
  if (error instanceof EditError) {
    if (error.code === "VERSION_CONFLICT")
      return "Dữ liệu vừa được thay đổi bởi lần sửa khác. Hãy tải lại hồ sơ rồi sửa lại.";
    return error.message;
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "permission-denied")
    return "Không có quyền lưu thay đổi này (chỉ quản trị viên, và máy chủ phải đã bật quy tắc sửa dữ liệu).";
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Không kết nối được máy chủ. Chưa có gì được lưu; hãy thử lại.";
  if (code === "aborted" || code === "failed-precondition")
    return "Dữ liệu vừa thay đổi hoặc bị tranh chấp. Hãy tải lại hồ sơ rồi sửa lại.";
  return "Không lưu được thay đổi. Chưa có gì được ghi; hãy thử lại.";
}
