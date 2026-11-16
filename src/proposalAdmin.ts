// Logic thuần cho giao diện QUẢN TRỊ VIÊN duyệt đề xuất thêm thành viên (docs/MEMBER_PROPOSALS.md, PR3).
// Không phụ thuộc React/Firebase. Dữ liệu đề xuất/nhật ký là dữ liệu không tin cậy: chỉ so sánh và dựng chuỗi thuần.
import { normalizeName } from "./domain";
import { EditError } from "./editCore";
import { readProposal } from "./memberProposal";
import type { ProposalDoc, ProposalStatus } from "./memberProposal";
import type { SnapPerson, TreeIndex } from "./treeModel";

/** Đang chờ quản trị viên xử lý (hàng đợi): CHỜ DUYỆT hoặc CẦN BỔ SUNG. */
export const OPEN_STATUSES: ProposalStatus[] = ["PENDING", "NEEDS_INFO"];
/** Trạng thái xem ở "Đã xử lý" (mỗi lần một trạng thái, tối đa HISTORY_LIMIT mục). */
export const HISTORY_STATUSES = ["APPROVED", "REJECTED", "WITHDRAWN"] as const;
export const QUEUE_LIMIT = 100;
export const HISTORY_LIMIT = 30;

/** Tên so trùng: bỏ dấu, hoa/thường, gộp khoảng trắng ("Đức Thịnh" ~ "duc thinh"). */
export function nameKey(name: string): string {
  return normalizeName(name).replace(/\s+/g, " ");
}

/**
 * Hai tên "gần giống": trùng sau chuẩn hóa, hoặc tên này nằm trọn trong tên kia (ví dụ thiếu tên đệm) khi phần ngắn
 * hơn có ít nhất 2 từ. Chỉ để CẢNH BÁO, không chặn duyệt.
 */
export function similarNames(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.split(" ").length < 2) return false;
  return ` ${long} `.includes(` ${short} `);
}

/** Con (CHILD) hoặc vợ/chồng (SPOUSE) hiện có của người được gắn mà tên gần giống tên đề xuất. */
export function similarExisting(
  index: TreeIndex,
  doc: Pick<ProposalDoc, "kind" | "anchorId">,
  name: string,
): SnapPerson[] {
  const ids =
    doc.kind === "CHILD"
      ? index.children(doc.anchorId)
      : index.spouses(doc.anchorId);
  const out: SnapPerson[] = [];
  for (const id of new Set(ids)) {
    const p = index.snapshot.persons.get(id);
    if (p && similarNames(p.name, name)) out.push(p);
  }
  return out;
}

/** Các đề xuất đang mở KHÁC cùng người được gắn (có thể trùng nhau). */
export function otherOpenForAnchor<
  T extends { doc: Pick<ProposalDoc, "id" | "anchorId" | "status"> },
>(items: T[], doc: Pick<ProposalDoc, "id" | "anchorId">): T[] {
  return items.filter(
    (i) =>
      i.doc.id !== doc.id &&
      i.doc.anchorId === doc.anchorId &&
      OPEN_STATUSES.includes(i.doc.status),
  );
}

/** Quản trị viên không tự duyệt/từ chối/yêu cầu bổ sung đề xuất của chính mình (rules cấm). */
export const isOwnProposal = (doc: Pick<ProposalDoc, "authorUid">, uid: string) =>
  doc.authorUid === uid;

/** Hành động quản trị viên làm được với đề xuất ở trạng thái này (khớp canTransition(.., "admin")). */
export function adminActions(status: ProposalStatus): {
  approve: boolean;
  reject: boolean;
  needInfo: boolean;
} {
  return {
    approve: status === "PENDING" || status === "NEEDS_INFO",
    reject: status === "PENDING" || status === "NEEDS_INFO",
    needInfo: status === "PENDING",
  };
}

/** Sắp theo thời điểm gửi, CŨ NHẤT trước (hàng đợi xử lý theo thứ tự gửi); không rõ thời điểm thì xuống cuối. */
export function sortOldestFirst<T extends { createdAtMs: number | null }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => (a.createdAtMs ?? Infinity) - (b.createdAtMs ?? Infinity),
  );
}

/**
 * "Gửi lại của …" chỉ đáng tin khi đề xuất cũ CÙNG tác giả và đã ĐÃ RÚT hoặc TỪ CHỐI. Rules không kiểm resubmitOf nên
 * giao diện phải kiểm. `old` = null khi không đọc được hoặc không tồn tại.
 */
export function verifiedResubmit(
  doc: Pick<ProposalDoc, "authorUid" | "resubmitOf">,
  old: ProposalDoc | null,
): ProposalDoc | null {
  if (!doc.resubmitOf || !old || old.id !== doc.resubmitOf) return null;
  if (old.authorUid !== doc.authorUid) return null;
  return old.status === "WITHDRAWN" || old.status === "REJECTED" ? old : null;
}

/**
 * Nhật ký `edit-{n}` chỉ được coi là "từ đề xuất" khi đề xuất tương ứng đã APPROVED và appliedEditVersion đúng bằng
 * n (chống nhật ký có after.proposalId giả mạo, do admin thêm trực tiếp với mã trùng). `data` = dữ liệu thô của
 * memberProposals/{id}.
 */
export function proposalMatchesAudit(
  proposalId: string,
  data: unknown,
  auditVersion: number,
): boolean {
  const p = readProposal(proposalId, data);
  return (
    !!p &&
    p.status === "APPROVED" &&
    Number.isInteger(auditVersion) &&
    p.appliedEditVersion === auditVersion
  );
}

/** Lỗi quản trị viên gặp khi duyệt/từ chối/yêu cầu bổ sung -> câu tiếng Việt, kèm gợi ý xử lý. */
export function decisionErrorMessage(error: unknown): string {
  if (error instanceof EditError) {
    const m = error.message;
    if (error.code === "VERSION_CONFLICT")
      return "Cây gia phả vừa được người khác thay đổi. Dữ liệu đã được tải lại; hãy kiểm tra rồi bấm Duyệt lại. Chưa có gì được ghi.";
    if (error.code === "BAD_STATE" && m.includes("trạng thái duyệt"))
      return "Đề xuất này đã được xử lý (hoặc người gửi đã rút). Danh sách đã được tải lại; chưa có gì được ghi.";
    if (error.code === "NOT_FOUND")
      return "Không tìm thấy đề xuất này. Chưa có gì được ghi.";
    if (
      /không có trong cây/.test(m) &&
      (m.includes("Cha/mẹ") || m.includes("Người này"))
    )
      return "Người được gắn không còn trong cây (có thể đã bị ẩn). Chưa có gì được ghi; hãy Từ chối hoặc Cần bổ sung đề xuất này.";
    if (/Mã người mới đã tồn tại/.test(m))
      return "Mã người mới đã tồn tại nên không thể duyệt đề xuất này. Chưa có gì được ghi; hãy Từ chối đề xuất.";
    if (/dòng họ|thủy tổ|chưa có đời/.test(m))
      return `${m} Gợi ý: đổi "Loại" thành Họ ngoại rồi duyệt, hoặc Từ chối. Chưa có gì được ghi.`;
    return `${m} Chưa có gì được ghi.`;
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "permission-denied")
    return "Máy chủ không cho phép thao tác này (có thể đề xuất vừa được xử lý, sổ quản trị viên đã đổi, hoặc quy tắc chưa được triển khai). Danh sách đã được tải lại; chưa có gì được ghi.";
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Không kết nối được máy chủ. Chưa có gì được ghi; hãy thử lại.";
  if (code === "aborted" || code === "failed-precondition")
    return "Dữ liệu vừa thay đổi hoặc bị tranh chấp. Đã tải lại; hãy kiểm tra rồi thử lại. Chưa có gì được ghi.";
  return "Không xử lý được đề xuất. Chưa có gì được ghi; hãy thử lại.";
}

/** Tên người gửi từ users/{uid} (admin được get): hiển thị tên hoặc email; không có thì coi là đã thu hồi. */
export type AuthorInfo =
  | { kind: "named"; label: string; revoked: boolean }
  | { kind: "gone" }
  | { kind: "error" };
export function authorInfo(
  exists: boolean,
  data: Record<string, unknown> | null,
): AuthorInfo {
  if (!exists || !data) return { kind: "gone" };
  const clip = (s: string) => s.replace(/\p{Cc}/gu, " ").slice(0, 120);
  const label =
    typeof data.displayName === "string" && data.displayName.trim()
      ? clip(data.displayName)
      : typeof data.email === "string" && data.email.trim()
        ? clip(data.email)
        : "";
  return label
    ? { kind: "named", label, revoked: data.enabled !== true }
    : { kind: "gone" };
}
export function authorText(a: AuthorInfo | undefined): string {
  if (!a) return "đang tra…";
  if (a.kind === "gone") return "tài khoản đã thu hồi";
  if (a.kind === "error") return "chưa tra được tên tài khoản";
  return a.revoked ? `${a.label} (đã thu hồi)` : a.label;
}

/**
 * Đề xuất có ghi cha/mẹ còn lại nhưng ô trên biểu mẫu đang rỗng: Duyệt sẽ bỏ quan hệ đó (proposalToAddOp ghi đè
 * null). Phải được xác nhận rõ, không bao giờ bỏ âm thầm.
 */
export function droppedOtherParent(
  payload: { otherParentId: string | null },
  formOtherParent: string,
): boolean {
  return !!payload.otherParentId && formOtherParent === "";
}
