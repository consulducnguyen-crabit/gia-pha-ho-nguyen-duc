// Trang "Đề xuất của tôi" (thành viên thường; route #/my-proposals). Khác với /changes (luồng đề xuất thay đổi
// chỉ chạy trên emulator): đây là đề xuất THÊM THÀNH VIÊN qua Firestore rules (docs/MEMBER_PROPOSALS.md).
// Đề xuất là dữ liệu không tin cậy: mọi chuỗi chỉ render bằng text React. Không hiện tên/uid người duyệt.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "./firebase";
import {
  loadMyProposals,
  withdrawProposal,
  type MyProposal,
} from "./editClient";
import { loadTreeIndex } from "./Tree";
import type { TreeIndex } from "./treeModel";
import { formatVnTime } from "./auditView";
import { MAX_PENDING, statusLabel } from "./memberProposal";
import {
  canResubmit,
  canWithdraw,
  kindLabel,
  withdrawErrorMessage,
  sortNewestFirst,
} from "./proposalView";

type Data =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      items: MyProposal[];
      pending: number;
      truncated: boolean;
      index: TreeIndex | null;
    };

const when = (ms: number | null) =>
  ms === null ? "" : formatVnTime(new Date(ms));

export function MyProposalsPage({ uid }: { uid: string }) {
  const [data, setData] = useState<Data>({ status: "loading" });
  const [round, setRound] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  // Quản lý focus ở bước rút: mở xác nhận -> nút "Xác nhận rút"; Không rút -> về nút "Rút lại"; xong -> thông báo.
  const confirmBtn = useRef<HTMLButtonElement | null>(null);
  const withdrawBtns = useRef(new Map<string, HTMLButtonElement>());
  const [backTo, setBackTo] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (confirming) confirmBtn.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (backTo && !confirming) {
      withdrawBtns.current.get(backTo)?.focus();
      setBackTo(null);
    }
  }, [backTo, confirming]);
  useEffect(() => {
    if (withdrawn) doneRef.current?.focus();
  }, [withdrawn]);
  // Rút lỗi: đưa focus vào thông báo lỗi (nút xác nhận đã biến mất nên focus sẽ mất nếu không chuyển).
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  // Bộ đếm đổi mỗi lần lỗi để lỗi lặp cùng chuỗi vẫn chuyển focus.
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (actionError) errorRef.current?.focus();
  }, [actionError, errorNonce]);
  useEffect(() => {
    let live = true;
    Promise.all([
      loadMyProposals(db!, uid),
      // Tên người trong cây chỉ để dễ đọc: lỗi thì vẫn hiện danh sách.
      loadTreeIndex(uid, false).catch(() => null),
    ])
      .then(([r, index]) => {
        if (live)
          setData({
            status: "ready",
            items: sortNewestFirst(r.items),
            pending: r.pending,
            truncated: r.truncated,
            index,
          });
      })
      .catch(() => {
        if (live) setData({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [uid, round]);
  async function withdraw(id: string) {
    setBusy(true);
    setActionError(null);
    setWithdrawn(false);
    try {
      await withdrawProposal(db!, id);
      setConfirming(null);
      setWithdrawn(true);
    } catch (error) {
      setConfirming(null);
      setActionError(withdrawErrorMessage(error));
      setErrorNonce((n) => n + 1);
    } finally {
      setBusy(false);
      // Thành công hay lỗi (thường do quản trị viên vừa xử lý) đều tải lại để hiện trạng thái thật.
      setRound((n) => n + 1);
    }
  }
  return (
    <>
      <h1>Đề xuất của tôi</h1>
      <p className="tree-summary">
        Các đề xuất thêm thành viên bạn đã gửi. Quản trị viên sẽ kiểm tra thông
        tin rồi mới ghi vào gia phả; hiện chưa có thông báo đẩy nên hãy quay lại
        trang này để xem kết quả. Mỗi người được tối đa {MAX_PENDING} đề xuất
        chờ duyệt cùng lúc. Để gửi đề xuất mới, mở hồ sơ của người cần gắn thêm
        (từ Cây gia phả) rồi chọn "Đề xuất thêm con" hoặc "Đề xuất thêm
        vợ/chồng".
      </p>
      {data.status === "loading" && (
        <p role="status" className="notice">
          Đang tải các đề xuất của bạn…
        </p>
      )}
      {data.status === "error" && (
        <div role="alert" className="notice">
          Không tải được các đề xuất của bạn. Hãy kiểm tra kết nối rồi thử lại.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setData({ status: "loading" });
              setRound((n) => n + 1);
            }}
          >
            Thử lại
          </button>
        </div>
      )}
      {data.status === "ready" && (
        <>
          <p className="tree-meta" data-testid="pending-count">
            Đang chờ duyệt: {data.pending}/{MAX_PENDING}
          </p>
          {data.truncated && (
            <p role="status" className="notice">
              Chỉ hiển thị 50 đề xuất; các đề xuất cũ hơn có thể không hiện.
            </p>
          )}
          {actionError && (
            <p role="alert" className="notice" tabIndex={-1} ref={errorRef}>
              {actionError}
            </p>
          )}
          {withdrawn && (
            <p role="status" className="notice" tabIndex={-1} ref={doneRef}>
              Đã rút đề xuất.
            </p>
          )}
          {data.items.length === 0 ? (
            <p role="status" className="notice">
              Bạn chưa gửi đề xuất nào.
            </p>
          ) : (
            <ul className="my-proposals">
              {data.items.map((item) => {
                const d = item.doc;
                const anchor = data.index?.snapshot.persons.get(d.anchorId);
                const sent = when(item.createdAtMs);
                const updated = when(item.updatedAtMs);
                return (
                  <li key={d.id} className="my-proposal">
                    <h2>
                      {kindLabel(d.kind)}: {d.payload.name}
                    </h2>
                    <p>
                      <span className="proposal-status" data-status={d.status}>
                        {statusLabel(d.status)}
                      </span>
                    </p>
                    <p className="tree-meta">
                      Gắn với:{" "}
                      {anchor ? (
                        <Link to={`/person/${anchor.id}`}>{anchor.name}</Link>
                      ) : (
                        "một người trong cây"
                      )}
                      {sent && ` · Gửi lúc ${sent}`}
                      {updated && updated !== sent && d.status !== "PENDING"
                        ? ` · Cập nhật ${updated}`
                        : ""}
                    </p>
                    {d.source && (
                      <p className="tree-meta proposal-text">
                        Nguồn/căn cứ: {d.source}
                      </p>
                    )}
                    {d.status === "PENDING" && (
                      <p className="tree-meta">
                        Đang chờ quản trị viên kiểm tra.
                      </p>
                    )}
                    {d.status === "NEEDS_INFO" && d.infoRequestReason && (
                      <p className="proposal-text">
                        Quản trị viên cần bổ sung: {d.infoRequestReason}
                      </p>
                    )}
                    {d.status === "REJECTED" && d.decisionReason && (
                      <p className="proposal-text proposal-note-rejected">
                        Lý do từ chối: {d.decisionReason}
                      </p>
                    )}
                    {d.status === "APPROVED" && (
                      <p className="tree-meta proposal-note-approved">
                        Quản trị viên đã duyệt và ghi vào gia phả.
                        {d.decisionReason
                          ? ` Ghi chú: ${d.decisionReason}`
                          : ""}
                      </p>
                    )}
                    {(canWithdraw(d.status) || canResubmit(d.status)) && (
                      <div className="edit-actions">
                        {canResubmit(d.status) && anchor && (
                          <Link
                            className="link"
                            to={`/person/${anchor.id}?propose=${d.kind === "CHILD" ? "child" : "spouse"}&resubmit=${d.id}`}
                          >
                            Gửi lại (điền sẵn)
                          </Link>
                        )}
                        {canWithdraw(d.status) &&
                          (confirming === d.id ? (
                            <span className="edit-note">
                              Rút đề xuất này? Đề xuất sẽ chuyển sang ĐÃ RÚT và
                              không thể mở lại.{" "}
                              <button
                                type="button"
                                className="danger"
                                ref={confirmBtn}
                                disabled={busy}
                                onClick={() => void withdraw(d.id)}
                              >
                                {busy ? "Đang rút…" : "Xác nhận rút"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setBackTo(d.id);
                                  setConfirming(null);
                                }}
                              >
                                Không rút
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              ref={(el) => {
                                if (el) withdrawBtns.current.set(d.id, el);
                                else withdrawBtns.current.delete(d.id);
                              }}
                              onClick={() => {
                                setActionError(null);
                                setWithdrawn(false);
                                setConfirming(d.id);
                              }}
                            >
                              Rút lại
                            </button>
                          ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
