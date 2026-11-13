// Lập kế hoạch đồng bộ giới tính vào treeSnapshots/main (hàm thuần, không I/O). Dùng cho lệnh
// gia-pha:snapshot-sex (scripts/gia-pha/snapshot-sex.ts). Kết quả chỉ chứa số đếm và mã người, KHÔNG chứa tên.
type Doc = Record<string, unknown>;

/** Phải khớp SNAPSHOT_MAX_BYTES ở src/editCore.ts (script không import được src); có test đối chiếu. */
export const SNAPSHOT_MAX_BYTES = 850000;
/** Số phần tử của bộ dữ liệu một người khi chưa có giới tính (bản trước quyết định 2026-11-13). */
const TUPLE_NO_SEX = 7;

export interface SexStats {
  persons: number;
  male: number;
  female: number;
  unknown: number;
  /** Số bộ dữ liệu thật sự bị đổi (0 = đã đồng bộ, lệnh idempotent). */
  changed: number;
}
export type SexPlan =
  { json: string; stats: SexStats; editVersion: number } | { errors: string[] };

/**
 * Điền (hoặc, với strip, cắt bỏ) phần tử giới tính của mọi bộ trong ảnh chụp, lấy từ persons/{id}.sex.
 * Dừng (trả errors) nếu: ảnh chụp hỏng; người trong ảnh chụp không có persons doc hoặc đã ẩn; sex ngoài M/F/null;
 * kết quả vượt trần kích thước. Không đổi editVersion (dữ liệu phái sinh, không phải một lần sửa của người dùng).
 */
export function planSnapshotSex(
  snapshot: Doc | null | undefined,
  persons: Map<string, Doc>,
  options: { strip?: boolean } = {},
): SexPlan {
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.data !== "string"
  )
    return { errors: ["treeSnapshots/main thiếu hoặc sai định dạng."] };
  const v = snapshot.editVersion;
  if (
    v !== undefined &&
    (typeof v !== "number" || !Number.isInteger(v) || v < 0)
  )
    return { errors: ["editVersion của ảnh chụp không hợp lệ."] };
  const editVersion = v ?? 0;
  let data: { v?: unknown; persons?: Record<string, unknown> };
  try {
    data = JSON.parse(snapshot.data);
  } catch {
    return { errors: ["Ảnh chụp cây không đọc được."] };
  }
  if (
    !data ||
    typeof data !== "object" ||
    data.v !== 1 ||
    !data.persons ||
    typeof data.persons !== "object"
  )
    return { errors: ["Ảnh chụp cây sai định dạng."] };

  const errors: string[] = [];
  const stats: SexStats = {
    persons: 0,
    male: 0,
    female: 0,
    unknown: 0,
    changed: 0,
  };
  for (const [id, raw] of Object.entries(data.persons)) {
    if (!Array.isArray(raw) || raw.length < 6 || raw.length > 8) {
      errors.push(`BAD_TUPLE: ${id}`);
      continue;
    }
    stats.persons++;
    if (options.strip) {
      if (raw.length > TUPLE_NO_SEX) {
        raw.length = TUPLE_NO_SEX;
        stats.changed++;
      }
      continue;
    }
    const doc = persons.get(id);
    if (!doc) {
      errors.push(`PERSON_DOC_MISSING: ${id}`);
      continue;
    }
    if (doc.deleted === true) {
      errors.push(`PERSON_HIDDEN: ${id}`);
      continue;
    }
    const sex = doc.sex ?? null;
    if (sex !== "M" && sex !== "F" && sex !== null) {
      errors.push(`SEX_INVALID: ${id}`);
      continue;
    }
    if (sex === "M") stats.male++;
    else if (sex === "F") stats.female++;
    else stats.unknown++;
    if (raw.length === 8 && raw[7] === sex) continue;
    // Bộ 6 phần tử: điền cờ rỗng ở vị trí 7 để không tạo mảng thưa.
    if (raw.length < 7) raw[6] = [];
    raw[7] = sex;
    stats.changed++;
  }
  if (errors.length) return { errors };
  const json = JSON.stringify(data);
  if (new TextEncoder().encode(json).length > SNAPSHOT_MAX_BYTES)
    return {
      errors: [
        `Ảnh chụp sau đồng bộ vượt trần ${SNAPSHOT_MAX_BYTES} byte; không ghi.`,
      ],
    };
  return { json, stats, editVersion };
}
