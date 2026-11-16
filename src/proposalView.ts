// Logic thuần cho giao diện thành viên của "đề xuất thêm thành viên" (docs/MEMBER_PROPOSALS.md): đếm chờ, đếm ngược,
// điền sẵn biểu mẫu khi gửi lại, thông báo lỗi thân thiện. Không phụ thuộc React/Firebase.
import { MAX_PENDING, THROTTLE_SECONDS } from "./memberProposal";
import type {
  ChildPayload,
  ProposalDoc,
  ProposalKind,
  ProposalStatus,
  SpousePayload,
} from "./memberProposal";
import type { ChildForm, SpouseForm } from "./addForm";

/** Số đề xuất đang CHỜ DUYỆT (CẦN BỔ SUNG không tính: tác giả đã có thể rút hoặc gửi lại). */
export function countPending(items: { status: ProposalStatus }[]): number {
  return items.filter((i) => i.status === "PENDING").length;
}
export const pendingFull = (pending: number) => pending >= MAX_PENDING;

/** Số giây còn phải chờ trước khi gửi đề xuất kế tiếp (0 = gửi được). `lastMs`/`nowMs` cùng một đồng hồ. */
export function throttleLeft(lastMs: number | null, nowMs: number): number {
  if (lastMs === null) return 0;
  const left = Math.ceil((lastMs + THROTTLE_SECONDS * 1000 - nowMs) / 1000);
  return Math.min(THROTTLE_SECONDS, Math.max(0, left));
}

export const kindLabel = (kind: ProposalKind) =>
  kind === "CHILD" ? "Thêm con" : "Thêm vợ/chồng";

/** Tác giả rút được khi đang chờ hoặc cần bổ sung (khớp canTransition(.., "author")). */
export const canWithdraw = (s: ProposalStatus) =>
  s === "PENDING" || s === "NEEDS_INFO";
/** Gửi lại (tạo đề xuất mới điền sẵn) khi quản trị viên cần bổ sung hoặc đã từ chối. */
export const canResubmit = (s: ProposalStatus) =>
  s === "NEEDS_INFO" || s === "REJECTED";

/** Mới nhất trước; không rõ thời điểm thì xuống cuối. */
export function sortNewestFirst<T extends { createdAtMs: number | null }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => (b.createdAtMs ?? -Infinity) - (a.createdAtMs ?? -Infinity),
  );
}

const yearText = (y: number | null) => (y === null ? "" : String(y));

/** Điền sẵn biểu mẫu thêm con từ nội dung đề xuất cũ. `spouseIds` = người chọn được làm cha/mẹ còn lại. */
export function payloadToChildForm(
  p: ChildPayload,
  spouseIds: string[],
): ChildForm {
  return {
    name: p.name,
    sex: p.sex ?? "",
    birthYear: yearText(p.birthYear),
    deathYear: yearText(p.deathYear),
    deceased: p.deceased,
    note: p.note,
    role: p.role,
    otherParent:
      p.otherParentId && spouseIds.includes(p.otherParentId)
        ? p.otherParentId
        : "",
    category: p.category,
    adoptive: p.adoptive,
    branch: p.branch ?? "",
  };
}
export function payloadToSpouseForm(p: SpousePayload): SpouseForm {
  return {
    name: p.name,
    sex: p.sex ?? "",
    birthYear: yearText(p.birthYear),
    deathYear: yearText(p.deathYear),
    deceased: p.deceased,
    note: p.note,
    kind: "new",
    existingId: "",
    category: p.category,
    order: p.order ?? "",
  };
}

/** Đề xuất cũ có dùng làm gốc "gửi lại" cho người này/loại này không (tác giả, neo, loại, trạng thái). */
export function resubmitSource(
  doc: ProposalDoc | undefined,
  uid: string,
  anchorId: string,
  kind: ProposalKind,
): ProposalDoc | null {
  return doc &&
    doc.authorUid === uid &&
    doc.anchorId === anchorId &&
    doc.kind === kind &&
    canResubmit(doc.status)
    ? doc
    : null;
}

/**
 * Lỗi GỬI đề xuất -> câu tiếng Việt (không lộ chi tiết kỹ thuật). Khi gửi lại, permission-denied còn có thể do đề xuất
 * cũ vừa được quản trị viên xử lý (không rút được nữa) nên nhắc kiểm tra trạng thái.
 */
export function proposalErrorMessage(
  error: unknown,
  opts: { resubmit?: boolean } = {},
): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "permission-denied")
    return opts.resubmit
      ? `Chưa gửi được. Có thể đề xuất cũ vừa được quản trị viên xử lý, hoặc bạn gửi quá nhanh (cần cách nhau ít nhất ${THROTTLE_SECONDS} giây). Thông tin đã được tải lại; hãy kiểm tra trạng thái ở "Đề xuất của tôi" rồi thử lại.`
      : `Chưa gửi được. Mỗi lần gửi cần cách nhau ít nhất ${THROTTLE_SECONDS} giây; hãy chờ một lát rồi thử lại. Nếu vẫn lỗi, tài khoản có thể đã bị đổi quyền.`;
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Không kết nối được máy chủ. Chưa có gì được gửi; hãy thử lại.";
  if (code === "already-exists" || code === "aborted")
    return "Đề xuất vừa thay đổi. Hãy tải lại trang rồi thử lại.";
  return "Không gửi được đề xuất. Chưa có gì được ghi; hãy thử lại.";
}

/** Lỗi RÚT đề xuất: permission-denied thường do quản trị viên vừa xử lý xong (không còn rút được). */
export function withdrawErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "permission-denied" || code === "failed-precondition")
    return "Chưa rút được: đề xuất có thể đã được quản trị viên xử lý. Danh sách đã được tải lại; hãy xem trạng thái mới.";
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Không kết nối được máy chủ. Đề xuất chưa được rút; hãy thử lại.";
  return "Không rút được đề xuất. Danh sách đã được tải lại; hãy thử lại.";
}

/** Người cha/mẹ còn lại đã chọn ở đề xuất cũ mà nay không còn trong danh sách vợ/chồng để chọn (bị bỏ khi điền sẵn). */
export function lostOtherParent(p: ChildPayload, spouseIds: string[]): boolean {
  return !!p.otherParentId && !spouseIds.includes(p.otherParentId);
}
