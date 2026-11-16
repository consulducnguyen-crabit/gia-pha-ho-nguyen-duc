// Trang quản trị viên "Đề xuất chờ duyệt" (route #/member-proposals, chỉ khi canManageMembership).
// Khác /review "Hộp duyệt" và /changes (luồng đề xuất thay đổi chỉ chạy trên emulator): đây là đề xuất THÊM THÀNH VIÊN
// qua Firestore rules (docs/MEMBER_PROPOSALS.md). Không dùng onSnapshot: đọc một lần khi mở và sau mỗi quyết định.
// Đề xuất là dữ liệu không tin cậy: mọi chuỗi chỉ render bằng text React.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { db } from "./firebase";
import {
  getAccountProfile,
  getProposalById,
  loadProposalHistory,
  loadProposalQueue,
  type MyProposal,
} from "./editClient";
import { loadTreeIndex } from "./Tree";
import { yearsLabel, type TreeIndex } from "./treeModel";
import { formatVnTime } from "./auditView";
import { statusLabel } from "./memberProposal";
import { kindLabel, sortNewestFirst } from "./proposalView";
import {
  HISTORY_LIMIT,
  HISTORY_STATUSES,
  QUEUE_LIMIT,
  authorInfo,
  authorText,
  otherOpenForAnchor,
  sortOldestFirst,
  type AuthorInfo,
} from "./proposalAdmin";
import { ProposalReview, type ReviewDone } from "./ProposalReview";

type Box<T> = { status: "loading" } | { status: "error" } | ({ status: "ready" } & T);
type ListData = { items: MyProposal[]; truncated: boolean };
type HistoryStatus = (typeof HISTORY_STATUSES)[number];

const when = (ms: number | null) =>
  ms === null ? "" : formatVnTime(new Date(ms));

export function MemberProposalsAdminPage({
  uid,
  onChanged,
}: {
  uid: string;
  /** Sau mỗi quyết định: nơi gọi đếm lại số chờ duyệt ở menu. */
  onChanged: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [round, setRound] = useState(0);
  const [queue, setQueue] = useState<Box<ListData>>({ status: "loading" });
  const [tree, setTree] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; index: TreeIndex | null }
  >({ status: "loading" });
  const [tab, setTab] = useState<"open" | "history">("open");
  const [histStatus, setHistStatus] = useState<HistoryStatus>("APPROVED");
  const [history, setHistory] = useState<Box<ListData>>({ status: "loading" });
  const [opened, setOpened] = useState<MyProposal | null>(null);
  const [notice, setNotice] = useState<ReviewDone | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [authors, setAuthors] = useState<Record<string, AuthorInfo>>({});
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const openBtns = useRef(new Map<string, HTMLButtonElement>());
  const backTo = useRef<string | null>(null);
  const h1Ref = useRef<HTMLHeadingElement | null>(null);
  // Tăng khi mở chi tiết: cho phép tra lại tên người gửi bị lỗi tạm thời.
  const [authorRetry, setAuthorRetry] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Hàng đợi + ảnh chụp cây (đọc mới từ máy chủ để editVersion đúng khi duyệt).
  useEffect(() => {
    let live = true;
    setQueue((q) => (q.status === "ready" ? q : { status: "loading" }));
    loadProposalQueue(db!, QUEUE_LIMIT)
      .then((r) => live && setQueue({ status: "ready", ...r }))
      .catch(() => live && setQueue({ status: "error" }));
    loadTreeIndex(uid, true)
      .then((index) => live && setTree({ status: "ready", index }))
      // Đã có cây tốt thì giữ (không bỏ biểu mẫu đang mở chỉ vì một lần tải lại lỗi).
      .catch(() => live && setTree((t) => (t.status === "ready" ? t : { status: "error" })));
    return () => {
      live = false;
    };
  }, [uid, round]);

  // Lịch sử: chỉ tải khi mở tab "Đã xử lý" (mỗi lần một trạng thái, tối đa HISTORY_LIMIT mục).
  useEffect(() => {
    if (tab !== "history") return;
    let live = true;
    setHistory({ status: "loading" });
    loadProposalHistory(db!, histStatus, HISTORY_LIMIT)
      .then((r) => live && setHistory({ status: "ready", ...r }))
      .catch(() => live && setHistory({ status: "error" }));
    return () => {
      live = false;
    };
  }, [tab, histStatus, round]);

  // Tên người gửi: mỗi uid một lần (get users/{uid}); lỗi tạm thời được thử lại ở lần mở kế tiếp.
  const lookupAuthor = useCallback((authorUid: string) => {
    if (asked.current.has(authorUid)) return;
    asked.current.add(authorUid);
    getAccountProfile(db!, authorUid).then(
      (r) =>
        alive.current &&
        setAuthors((a) => ({ ...a, [authorUid]: authorInfo(r.exists, r.data) })),
      (error: unknown) => {
        const code = (error as { code?: string } | null)?.code;
        if (code !== "permission-denied") asked.current.delete(authorUid);
        if (alive.current)
          setAuthors((a) => ({ ...a, [authorUid]: { kind: "error" } }));
      },
    );
  }, []);
  const visible = [
    ...(queue.status === "ready" ? queue.items : []),
    ...(tab === "history" && history.status === "ready" ? history.items : []),
    ...(opened ? [opened] : []),
  ];
  const authorKey = [...new Set(visible.map((i) => i.doc.authorUid))].join(" ");
  useEffect(() => {
    for (const a of authorKey.split(" ")) if (a) lookupAuthor(a);
  }, [authorKey, lookupAuthor, authorRetry]);

  // Mở thẳng một đề xuất từ liên kết (?id=…, ví dụ từ Nhật ký chỉnh sửa).
  const linkId = params.get("id");
  useEffect(() => {
    if (!linkId) return;
    let live = true;
    getProposalById(db!, linkId)
      .then((r) => {
        if (!live) return;
        if (r) setOpened(r);
        else setLookupMsg("Không tìm thấy đề xuất này.");
      })
      .catch(() => live && setLookupMsg("Không đọc được đề xuất này. Hãy thử lại."));
    return () => {
      live = false;
    };
  }, [linkId]);

  // Focus: sau quyết định → thông báo; đóng chi tiết → nút "Xem và xử lý" của đúng mục (nếu còn).
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (!opened && backTo.current) {
      // Không còn nút đích (mở từ liên kết ?id=, hoặc mục đã rời hàng đợi): focus vào tiêu đề trang.
      const btn = openBtns.current.get(backTo.current);
      (btn ?? h1Ref.current)?.focus();
      backTo.current = null;
    }
  }, [opened]);

  const clearLink = () => {
    if (params.has("id")) {
      const next = new URLSearchParams(params);
      next.delete("id");
      setParams(next, { replace: true });
    }
  };
  function close() {
    if (opened) backTo.current = opened.doc.id;
    setOpened(null);
    clearLink();
  }
  function open(item: MyProposal) {
    setNotice(null);
    setLookupMsg(null);
    setAuthorRetry((n) => n + 1);
    setOpened(item);
  }
  function done(result: ReviewDone) {
    setOpened(null);
    backTo.current = null;
    clearLink();
    setNotice(result);
    setRound((n) => n + 1);
    onChanged();
  }
  // Dữ liệu có thể đã đổi (xung đột, đã xử lý...): tải lại cây + hàng đợi + chính đề xuất đang mở.
  function stale(id: string) {
    setRound((n) => n + 1);
    onChanged();
    getProposalById(db!, id)
      .then((r) => alive.current && r && setOpened((cur) => (cur?.doc.id === id ? r : cur)))
      .catch(() => {
        /* giữ nguyên chi tiết đang mở; thông báo lỗi đã hiện */
      });
  }

  const index = tree.status === "ready" ? tree.index : null;
  const queueItems = queue.status === "ready" ? queue.items : [];
  const list = (items: MyProposal[], isOpenQueue: boolean) => (
    <ul className="my-proposals proposal-admin-list">
      {items.map((item) => {
        const d = item.doc;
        const anchor = index?.snapshot.persons.get(d.anchorId);
        const when1 = when(item.createdAtMs);
        const upd = when(item.updatedAtMs);
        return (
          <li key={d.id} className="my-proposal">
            <h2>
              {kindLabel(d.kind)}: {d.payload.name}{" "}
              <span className="tree-meta">{yearsLabel(d.payload)}</span>
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
              ) : index ? (
                "người không còn trong cây"
              ) : (
                "một người trong cây"
              )}
              {` · Người gửi: ${authorText(authors[d.authorUid])}`}
              {when1 && ` · Gửi lúc ${when1}`}
              {!isOpenQueue && upd ? ` · Cập nhật ${upd}` : ""}
            </p>
            {d.source && (
              <p className="tree-meta proposal-text">Nguồn/căn cứ: {d.source}</p>
            )}
            {d.status === "NEEDS_INFO" && d.infoRequestReason && (
              <p className="proposal-text">
                Đã yêu cầu bổ sung: {d.infoRequestReason}
              </p>
            )}
            {d.status === "REJECTED" && d.decisionReason && (
              <p className="proposal-text proposal-note-rejected">
                Lý do từ chối: {d.decisionReason}
              </p>
            )}
            <div className="edit-actions">
              <button
                type="button"
                ref={(el) => {
                  if (el) openBtns.current.set(d.id, el);
                  else openBtns.current.delete(d.id);
                }}
                onClick={() => open(item)}
              >
                {isOpenQueue ? "Xem và xử lý" : "Xem chi tiết"}
                <span className="sr-only"> đề xuất {d.payload.name}</span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <h1 tabIndex={-1} ref={h1Ref}>
        Đề xuất chờ duyệt
      </h1>
      <p className="tree-summary">
        Đề xuất thêm thành viên do thành viên thường gửi. Hãy kiểm tra thông
        tin, đối chiếu cảnh báo trùng, có thể sửa nội dung rồi Duyệt để ghi vào
        gia phả (kèm nhật ký), hoặc Từ chối / Cần bổ sung kèm lý do. Người gửi
        đọc được lý do. Bạn không tự duyệt được đề xuất của chính mình. Ghi chú
        trong đề xuất sẽ hiện cho mọi thành viên sau khi duyệt.
      </p>
      {notice && (
        <div role="status" className="notice" tabIndex={-1} ref={noticeRef}>
          {notice.message}{" "}
          {notice.personId && (
            <Link to={`/person/${notice.personId}`}>Mở hồ sơ người vừa thêm</Link>
          )}
        </div>
      )}
      {lookupMsg && (
        <p role="alert" className="notice">
          {lookupMsg}
        </p>
      )}
      {opened ? (
        <ProposalReview
          key={opened.doc.id}
          item={opened}
          index={index}
          tree={tree.status}
          onRetryTree={() => setRound((n) => n + 1)}
          uid={uid}
          author={authors[opened.doc.authorUid]}
          otherOpen={otherOpenForAnchor(queueItems, opened.doc)}
          onClose={close}
          onDone={done}
          onStale={stale}
        />
      ) : (
        <>
          {tree.status === "error" && (
            <p role="alert" className="notice">
              Không tải được cây gia phả nên chưa duyệt được và chưa hiện tên
              người được gắn.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => setRound((n) => n + 1)}
              >
                Thử lại
              </button>
            </p>
          )}
          <div className="proposal-tabs" role="group" aria-label="Chọn danh sách">
            <button
              type="button"
              aria-pressed={tab === "open"}
              className={tab === "open" ? "primary" : undefined}
              onClick={() => setTab("open")}
            >
              Đang chờ xử lý
            </button>
            <button
              type="button"
              aria-pressed={tab === "history"}
              className={tab === "history" ? "primary" : undefined}
              onClick={() => setTab("history")}
            >
              Đã xử lý
            </button>
          </div>
          {tab === "open" ? (
            <>
              {queue.status === "loading" && (
                <p role="status" className="notice">
                  Đang tải các đề xuất…
                </p>
              )}
              {queue.status === "error" && (
                <div role="alert" className="notice">
                  Không tải được danh sách đề xuất. Hãy kiểm tra kết nối và quyền
                  truy cập (quy tắc máy chủ cho đề xuất có thể chưa được triển
                  khai).{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setRound((n) => n + 1)}
                  >
                    Thử lại
                  </button>
                </div>
              )}
              {queue.status === "ready" && (
                <>
                  <p className="tree-meta">
                    {queue.items.length} đề xuất đang chờ xử lý (cũ nhất trước).
                    {queue.truncated &&
                      ` Chỉ tải tối đa ${QUEUE_LIMIT} đề xuất; xử lý bớt rồi tải lại để thấy phần còn lại.`}
                  </p>
                  {queue.items.length === 0 ? (
                    <p role="status" className="notice">
                      Không có đề xuất nào đang chờ xử lý.
                    </p>
                  ) : (
                    list(sortOldestFirst(queue.items), true)
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <label className="proposal-filter">
                Trạng thái
                <select
                  className="form-field"
                  value={histStatus}
                  onChange={(e) => setHistStatus(e.target.value as HistoryStatus)}
                >
                  {HISTORY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              {history.status === "loading" && (
                <p role="status" className="notice">
                  Đang tải lịch sử…
                </p>
              )}
              {history.status === "error" && (
                <p role="alert" className="notice">
                  Không tải được lịch sử đề xuất.
                </p>
              )}
              {history.status === "ready" && (
                <>
                  <p className="tree-meta">
                    Hiển thị tối đa {HISTORY_LIMIT} đề xuất mỗi trạng thái (không
                    đảm bảo là các đề xuất mới nhất).
                  </p>
                  {history.items.length === 0 ? (
                    <p role="status" className="notice">
                      Chưa có đề xuất nào ở trạng thái này.
                    </p>
                  ) : (
                    list(sortNewestFirst(history.items), false)
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
