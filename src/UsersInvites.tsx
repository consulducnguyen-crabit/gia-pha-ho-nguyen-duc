// Khu "Mời thành viên" của #/users: tạo/thu hồi/mời lại lời mời (chỉ quyền Chỉ xem) và gửi liên kết đăng nhập qua email.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { auth, db } from "./firebase";
import { formatVnTime } from "./auditView";
import { emailLinkErrorMessage, sendLoginLink } from "./emailLink";
import {
  createInvite,
  inviteErrorMessage,
  inviteStatus,
  listInvites,
  revokeInvite,
  type InviteStatus,
} from "./invitesClient";

interface InviteRow {
  id: string;
  email: string;
  displayName: string;
  nonce: string;
  status: InviteStatus;
  expires: string;
}

const STATUS_LABEL: Record<InviteStatus, string> = {
  PENDING: "Đang chờ",
  ACCEPTED: "Đã nhận",
  REVOKED: "Đã thu hồi",
  EXPIRED: "Hết hạn",
};

export function InvitesSection({
  enabled,
  loaded,
  existingEmails,
  uid,
}: {
  /** Sổ quản trị hợp lệ và chứa tài khoản của bạn. */
  enabled: boolean;
  /** Danh sách tài khoản (và sổ) đã tải xong; chưa tải xong hoặc lỗi tải thì không hiện thông báo khóa. */
  loaded: boolean;
  /** Email (viết thường) đã có hồ sơ users: không "Mời lại" cho các email này. */
  existingEmails: Set<string>;
  uid: string;
}) {
  const uniq = useId();
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const msgRef = useRef<HTMLParagraphElement>(null);
  const load = useCallback(async () => {
    setLoadError("");
    try {
      const items = await listInvites(db!);
      const now = Date.now();
      setRows(
        items.map(({ id, data }) => ({
          id,
          email: typeof data.email === "string" ? data.email : id,
          displayName:
            typeof data.displayName === "string" ? data.displayName : "",
          nonce: typeof data.nonce === "string" ? data.nonce : "",
          status: inviteStatus(data, now) ?? "EXPIRED",
          expires: formatVnTime(data.expiresAt),
        })),
      );
    } catch (error) {
      setRows([]);
      setLoadError(inviteErrorMessage(error, "list"));
    }
  }, []);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  useEffect(() => {
    if (message) msgRef.current?.focus();
  }, [message]);

  async function run(
    key: string,
    task: () => Promise<string>,
    context: "create" | "revoke",
  ): Promise<boolean> {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await task() });
      await load();
      return true;
    } catch (error) {
      setMessage({ ok: false, text: inviteErrorMessage(error, context) });
      return false;
    } finally {
      setBusy("");
    }
  }
  const invite = (address: string, displayName?: string) =>
    run(
      `create:${address}`,
      async () => {
        const r = await createInvite(db!, uid, { email: address, displayName });
        return `Đã tạo lời mời cho ${r.emailKey} (quyền Chỉ xem, hạn ${formatVnTime(new Date(r.expiresAtMs))}). Bấm "Gửi liên kết đăng nhập" để Firebase gửi thư.`;
      },
      "create",
    );
  async function sendLink(address: string) {
    setBusy(`send:${address}`);
    setMessage(null);
    try {
      await sendLoginLink(auth!, address, { remember: false });
      setMessage({
        ok: true,
        text: `Firebase gửi thư tới ${address}; người nhận mở liên kết trên thiết bị của họ. Thư có thể nằm trong mục thư rác; hạn mức thư theo ngày của Firebase chưa được kiểm chứng.`,
      });
    } catch (error) {
      setMessage({ ok: false, text: emailLinkErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="users-invites" aria-labelledby={`${uniq}-h`}>
      <h2 id={`${uniq}-h`}>Mời thành viên</h2>
      <p className="tree-meta">
        Lời mời chỉ cấp quyền <b>Chỉ xem</b> và hết hạn sau khoảng 7 ngày. Người
        được mời đăng nhập bằng liên kết gửi qua email (không cần mật khẩu) hoặc
        bằng Google với đúng email này, rồi bấm “Nhận lời mời”.
      </p>
      {loaded && !enabled && (
        <p role="alert" className="notice">
          Khu mời thành viên bị khóa vì sổ quản trị chưa được khởi tạo hoặc
          không chứa tài khoản của bạn; chạy gia-pha:accounts registry
          --rebuild.
        </p>
      )}
      <form
        className="users-invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          void invite(email, name || undefined).then((ok) => {
            if (!ok) return;
            setEmail("");
            setName("");
          });
        }}
      >
        <label>
          Email người được mời
          <input
            className="form-field"
            type="email"
            required
            value={email}
            disabled={!enabled || !!busy}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Họ tên người được mời (không bắt buộc)
          <input
            className="form-field"
            value={name}
            disabled={!enabled || !!busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="edit-actions">
          <button
            type="submit"
            className="primary"
            disabled={!enabled || !!busy}
          >
            {busy.startsWith("create:") ? "Đang tạo…" : "Tạo lời mời"}
          </button>
        </div>
      </form>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className="notice"
          tabIndex={-1}
          ref={msgRef}
        >
          {message.text}
        </p>
      )}
      {loadError && (
        <p role="alert" className="notice">
          {loadError}
        </p>
      )}
      {enabled && rows === null && (
        <p role="status" className="notice">
          Đang tải danh sách lời mời…
        </p>
      )}
      {enabled && rows && (
        <div className="users-table-wrap">
          <table className="users-table users-table-invites">
            <caption className="sr-only">
              Lời mời gần đây (tối đa 100, mới nhất trước)
            </caption>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Hạn</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4}>Chưa có lời mời nào.</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.email}
                    {r.displayName && (
                      <span className="users-self-note">{r.displayName}</span>
                    )}
                  </td>
                  <td>{STATUS_LABEL[r.status]}</td>
                  <td>{r.expires || "—"}</td>
                  <td className="users-invite-actions">
                    {r.status === "PENDING" ? (
                      <>
                        <button
                          type="button"
                          aria-label={`Gửi liên kết đăng nhập tới ${r.email}`}
                          disabled={!!busy}
                          onClick={() => void sendLink(r.email)}
                        >
                          Gửi liên kết đăng nhập
                        </button>
                        <button
                          type="button"
                          className="danger"
                          aria-label={`Thu hồi lời mời ${r.email}`}
                          disabled={!!busy}
                          onClick={() =>
                            void run(
                              `revoke:${r.email}`,
                              async () => {
                                await revokeInvite(db!, uid, r);
                                return `Đã thu hồi lời mời của ${r.email}.`;
                              },
                              "revoke",
                            )
                          }
                        >
                          Thu hồi
                        </button>
                      </>
                    ) : existingEmails.has(r.email.toLowerCase()) ? (
                      <span className="users-self-note">
                        Email này đã có tài khoản; dùng nút Sửa → Bật lại ở bảng
                        tài khoản.
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Mời lại ${r.email}`}
                        disabled={!!busy}
                        onClick={() =>
                          void invite(r.email, r.displayName || undefined)
                        }
                      >
                        Mời lại
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
