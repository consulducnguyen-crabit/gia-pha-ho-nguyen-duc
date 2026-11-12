// Logic thuần mô tả thông tin chi (ngành) từ ảnh chụp cây; không phụ thuộc React.
// Chỉ ĐỌC/HIỂN THỊ. Lưu ý bảo mật: ghi chú chi (note) vẫn nằm trong ảnh chụp mà mọi thành viên đọc được,
// nên việc `isAdmin` ẩn nó chỉ là giảm hiển thị ở giao diện, KHÔNG phải kiểm soát truy cập.
import type { Snapshot } from "./treeModel";

export const BRANCH_TEXT_LIMIT = 500;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export interface ClippedText {
  /** Đoạn hiển thị mặc định (đã cắt kèm "…" nếu quá dài). */
  short: string;
  /** Toàn văn (đã trim). */
  full: string;
  truncated: boolean;
}

/** Trim, bỏ chuỗi rỗng/null, cắt theo ký tự Unicode (không chẻ đôi cặp thay thế). */
export function clipText(
  value: string | null | undefined,
  limit = BRANCH_TEXT_LIMIT,
): ClippedText | null {
  if (typeof value !== "string") return null;
  const full = value.trim();
  if (!full) return null;
  const chars = Array.from(full);
  if (chars.length <= limit) return { short: full, full, truncated: false };
  return {
    short: chars.slice(0, limit).join("").trimEnd() + "…",
    full,
    truncated: true,
  };
}

export interface BranchInfo {
  code: string;
  name: string;
  /** Thủy tổ chi: chỉ có khi mã người có trong ảnh chụp VÀ hợp lệ để dựng đường dẫn /person/{id}. */
  founder: { id: string; name: string } | null;
  mergedFrom: ClippedText | null;
  /** Chỉ khác null khi isAdmin; xem lưu ý bảo mật ở đầu tệp. */
  note: ClippedText | null;
}

export function branchInfo(
  snapshot: Pick<Snapshot, "branches" | "persons">,
  code: string | null | undefined,
  opts: { isAdmin: boolean },
): BranchInfo | null {
  if (!code) return null;
  const b = snapshot.branches.find((x) => x.code === code);
  if (!b) return null;
  const f = b.founderId ? snapshot.persons.get(b.founderId) : undefined;
  return {
    code: b.code,
    name: b.name,
    founder: f && SAFE_ID.test(f.id) ? { id: f.id, name: f.name } : null,
    mergedFrom: clipText(b.mergedFrom),
    note: opts.isAdmin ? clipText(b.note) : null,
  };
}
