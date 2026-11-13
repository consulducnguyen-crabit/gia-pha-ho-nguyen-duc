// Lập kế hoạch công bố ghi chú vào treeSnapshots/main (hàm thuần, không I/O). Dùng cho lệnh
// gia-pha:snapshot-note (scripts/gia-pha/snapshot-note.ts). Quyết định 2026-11-14: ghi chú hiển thị cho mọi thành viên
// (tooltip ở Cây gia phả); ghi chú cũ KHÔNG tự công bố, chỉ công bố qua lệnh này sau dry-run và rà soát.
// Kết quả mặc định chỉ chứa số đếm và mã người; nội dung ghi chú chỉ nằm trong `review` để lệnh in khi có --show.
type Doc = Record<string, unknown>;

/** Phải khớp SNAPSHOT_MAX_BYTES ở src/editCore.ts (script không import được src); có test đối chiếu. */
export const SNAPSHOT_MAX_BYTES = 850000;
/** Phải khớp NOTE_CLIP và clipNote ở src/treeModel.ts; có test đối chiếu. */
export const NOTE_CLIP = 300;
/** Số phần tử của bộ dữ liệu một người khi chưa có "đã mất" và ghi chú (sau quyết định giới tính 2026-11-13). */
const TUPLE_NO_DECEASED = 8;
/** Bộ có "đã mất" nhưng chưa có ghi chú. */
const TUPLE_NO_NOTE = 9;

export function clipNote(note: string): string | null {
  const text = note.trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length <= NOTE_CLIP
    ? text
    : `${chars.slice(0, NOTE_CLIP).join("").trimEnd()}…`;
}

export interface NoteStats {
  persons: number;
  /** Người có ghi chú (không rỗng) sau khi cắt. */
  withNote: number;
  /** Trong đó ghi chú dài hơn NOTE_CLIP và bị cắt. */
  clipped: number;
  /** Số bộ dữ liệu thật sự bị đổi (0 = đã đồng bộ, lệnh idempotent). */
  changed: number;
  /** Trong số bị đổi: ghi chú được công bố lần đầu (bộ cũ chưa có phần tử ghi chú). */
  newlyPublished: number;
}
export interface NoteReview {
  id: string;
  /** Độ dài ghi chú đầy đủ (ký tự Unicode). */
  chars: number;
  /** Bản đã cắt sẽ hiện cho mọi thành viên. */
  published: string;
}
export type NotePlan =
  | {
      json: string;
      stats: NoteStats;
      editVersion: number;
      review: NoteReview[];
    }
  | { errors: string[] };

/**
 * Điền (hoặc, với strip, cắt bỏ) phần tử "đã mất" (9) và ghi chú (10) của mọi bộ trong ảnh chụp: đã mất lấy từ
 * persons/{id}.deceased, ghi chú lấy từ personPrivate/{id}.note (cắt NOTE_CLIP ký tự). Dừng (trả errors) nếu: ảnh
 * chụp hỏng; bộ chưa có giới tính (chạy gia-pha:snapshot-sex trước); người không có persons doc hoặc đã ẩn;
 * deceased/note sai kiểu; kết quả vượt trần kích thước. Không đổi editVersion (dữ liệu phái sinh).
 */
export function planSnapshotNote(
  snapshot: Doc | null | undefined,
  persons: Map<string, Doc>,
  privates: Map<string, Doc>,
  options: { strip?: boolean } = {},
): NotePlan {
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
  const review: NoteReview[] = [];
  const stats: NoteStats = {
    persons: 0,
    withNote: 0,
    clipped: 0,
    changed: 0,
    newlyPublished: 0,
  };
  for (const [id, raw] of Object.entries(data.persons)) {
    if (!Array.isArray(raw) || raw.length < 6 || raw.length > 10) {
      errors.push(`BAD_TUPLE: ${id}`);
      continue;
    }
    stats.persons++;
    if (options.strip) {
      if (raw.length > TUPLE_NO_NOTE) {
        raw.length = TUPLE_NO_NOTE;
        stats.changed++;
      }
      continue;
    }
    if (raw.length < TUPLE_NO_DECEASED) {
      errors.push(`NEEDS_SEX_FIRST: ${id}`);
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
    if (doc.deceased !== undefined && typeof doc.deceased !== "boolean") {
      errors.push(`DECEASED_INVALID: ${id}`);
      continue;
    }
    const priv = privates.get(id);
    const full = priv?.note;
    if (full !== undefined && typeof full !== "string") {
      errors.push(`NOTE_INVALID: ${id}`);
      continue;
    }
    const deceased = doc.deceased === true;
    const note = clipNote(full ?? "");
    if (note !== null) {
      stats.withNote++;
      if (Array.from((full as string).trim()).length > NOTE_CLIP)
        stats.clipped++;
    }
    if (raw.length === 10 && raw[8] === deceased && raw[9] === note) continue;
    if (note !== null)
      review.push({
        id,
        chars: Array.from((full as string).trim()).length,
        published: note,
      });
    if (raw.length < 10 && note !== null) stats.newlyPublished++;
    raw[8] = deceased;
    raw[9] = note;
    stats.changed++;
  }
  if (errors.length) return { errors };
  const json = JSON.stringify(data);
  if (new TextEncoder().encode(json).length > SNAPSHOT_MAX_BYTES)
    return {
      errors: [
        `Ảnh chụp sau khi công bố vượt trần ${SNAPSHOT_MAX_BYTES} byte; không ghi.`,
      ],
    };
  return { json, stats, editVersion, review };
}
