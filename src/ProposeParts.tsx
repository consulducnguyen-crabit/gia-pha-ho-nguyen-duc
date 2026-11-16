// Phần dùng chung cho chế độ "đề xuất" của biểu mẫu thêm con / thêm vợ chồng (thành viên thường; docs/MEMBER_PROPOSALS.md).
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { db } from "./firebase";
import { submitProposal } from "./editClient";
import { MAX_PENDING, SOURCE_MAX, THROTTLE_SECONDS } from "./memberProposal";
import type { ProposalDoc, ProposalInput } from "./memberProposal";
import {
  pendingFull,
  proposalErrorMessage,
  throttleLeft,
} from "./proposalView";

// Lần gửi gần nhất trong phiên này (đồng hồ máy, chỉ so với chính nó nên không lệch giờ máy chủ): khóa nút gửi
// trong 60 giây. Lần gửi từ phiên trước chỉ là nhắc (lastSentMs từ máy chủ), vì giờ máy có thể lệch; rules mới là chốt chặn.
const sentLocally = new Map<string, number>();

/** Gửi đề xuất; lỗi thành câu thân thiện. Gửi lại từ đề xuất TỪ CHỐI thì không rút đề xuất cũ (đã ở trạng thái cuối). */
export function useProposeSend(
  uid: string,
  initial: ProposalDoc | undefined,
  onSent: () => void,
  close: () => void,
  onError?: (error: unknown) => void,
) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  async function send(proposal: ProposalInput) {
    setBusy(true);
    setSaveError(null);
    try {
      await submitProposal(db!, proposal, {
        withdrawPrevious: initial?.status !== "REJECTED",
      });
      sentLocally.set(uid, Date.now());
      close();
      onSent();
    } catch (error) {
      setSaveError(proposalErrorMessage(error, { resubmit: !!initial }));
      // Trạng thái đề xuất cũ/giới hạn có thể đã đổi: nhờ nơi gọi tải lại dữ liệu (không đóng biểu mẫu).
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }
  return { busy, saveError, setSaveError, send };
}

/** Giới hạn phía giao diện: tối đa MAX_PENDING đề xuất chờ, cách nhau THROTTLE_SECONDS giây. */
export function useProposeGate(
  uid: string,
  pending: number,
  lastSentMs: number | null,
): { blocked: boolean; notice: ReactNode } {
  const [now, setNow] = useState(() => Date.now());
  const local = throttleLeft(sentLocally.get(uid) ?? null, now);
  const server = throttleLeft(lastSentMs, now);
  useEffect(() => {
    if (local === 0 && server === 0) return;
    const t = globalThis.setTimeout(() => setNow(Date.now()), 1000);
    return () => globalThis.clearTimeout(t);
  });
  const full = pendingFull(pending);
  let notice: ReactNode = null;
  if (full)
    notice = (
      <p className="notice" role="status">
        Bạn đang có {pending}/{MAX_PENDING} đề xuất chờ duyệt, chưa thể gửi
        thêm. Hãy chờ quản trị viên kiểm tra hoặc rút bớt ở{" "}
        <Link to="/my-proposals">Đề xuất của tôi</Link>.
      </p>
    );
  else if (local > 0)
    notice = (
      <p className="notice">
        Vừa gửi một đề xuất. Mỗi lần gửi cách nhau {THROTTLE_SECONDS} giây; gửi
        tiếp được sau {local} giây.
      </p>
    );
  else if (server > 0)
    notice = (
      <p className="notice">
        Bạn vừa gửi một đề xuất gần đây; nếu gửi ngay có thể bị từ chối (cần
        cách nhau {THROTTLE_SECONDS} giây).
      </p>
    );
  return { blocked: full || local > 0, notice };
}

export function SourceField({
  value,
  onChange,
  error,
  errId,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  errId: string;
}) {
  return (
    <label>
      Nguồn/căn cứ (không bắt buộc)
      <textarea
        className="form-note-field"
        value={value}
        maxLength={SOURCE_MAX}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
      />
      <span className="tree-meta">
        {value.length}/{SOURCE_MAX} ký tự. Ví dụ: ai cung cấp, giấy tờ, sách gia
        phả. Chỉ bạn và quản trị viên xem được; không đưa vào hồ sơ chính thức.
      </span>
      {error && (
        <span id={errId} role="alert" className="edit-error">
          {error}
        </span>
      )}
    </label>
  );
}
