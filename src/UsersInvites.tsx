// Khu "Mời thành viên" của #/users: tạo/thu hồi/mời lại lời mời (chỉ quyền Chỉ xem) và gửi liên kết đăng nhập qua email.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { auth, db } from "./firebase";
import { formatVnTime } from "./auditView";
import {
  emailLinkErrorMessage,
  emailLinkShortReason,
  sendLoginLink,
} from "./emailLink";
import {
  createInvite,
  inviteErrorMessage,
  inviteStatus,
  listInvites,
  normalizeInviteEmail,
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
  /**
   * Một thao tác: tạo lời mời (trừ khi chỉ gửi lại) rồi NGAY SAU ĐÓ gửi thư đăng nhập qua Firebase. Tạo xong mà gửi lỗi thì
   * lời mời vẫn còn (không mất) và báo rõ để bấm "Gửi lại thư". Trả true nếu lời mời đã có (form có thể xóa).
   */
  async function sendMail(
    address: string,
    displayName: string | undefined,
    mode: "create+send" | "resend",
  ): Promise<boolean> {
    setBusy(`mail:${address}`);
    setMessage(null);
    let created = false;
    try {
      if (mode === "create+send") {
        await createInvite(db!, uid, { email: address, displayName });
        created = true;
      }
      await sendLoginLink(auth!, address, { remember: false, invitee: true });
      setMessage({
        ok: true,
        text: `Đã gửi thư mời tới ${address} (Firebase gửi thư; hạn mức ngày chưa kiểm chứng). Thư có thể nằm trong mục thư rác.`,
      });
      await load();
      return true;
    } catch (error) {
      if (created) {
        setMessage({
          ok: false,
          text: `Đã tạo lời mời nhưng chưa gửi được thư (${emailLinkShortReason(error)}). Bấm "Gửi lại thư" trong bảng.`,
        });
        await load();
        return true;
      }
      setMessage({
        ok: false,
        text:
          mode === "resend"
            ? emailLinkErrorMessage(error)
            : inviteErrorMessage(error, "create"),
      });
      return false;
    } finally {
      setBusy("");
    }
  }
  // Nhãn nút chính theo trạng thái lời mời hiện có của email đang nhập.
  const typed = (() => {
    try {
      return normalizeInviteEmail(email);
    } catch {
      return null;
    }
  })();
  const existing = typed
    ? rows?.find((r) => r.email.toLowerCase() === typed)
    : undefined;
  const resend = existing?.status === "PENDING";
  // Email đã có hồ sơ users (kể cả lời mời ACCEPTED): không tạo lời mời mới, dùng Sửa → Bật lại.
  const hasAccount = !!typed && existingEmails.has(typed);
  const mainLabel = busy.startsWith("mail:")
    ? "Đang gửi…"
    : resend
      ? "Gửi lại thư mời"
      : existing
        ? "Mời lại và gửi thư"
        : "Gửi thư mời";
  return (
    <section className="users-invites" aria-labelledby={`${uniq}-h`}>
      <h2 id={`${uniq}-h`}>Mời thành viên</h2>
      <p className="tree-meta">
        Bấm <b>Gửi thư mời</b> để tạo lời mời và gửi thư luôn. Lời mời chỉ cấp
        quyền <b>Chỉ xem</b>, hết hạn sau khoảng 7 ngày. Người được mời mở liên
        kết trong thư là vào thẳng hệ thống (không cần mật khẩu, không phải bấm
        thêm); hoặc đăng nhập bằng Google với đúng email này.
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
          if (hasAccount) return;
          void sendMail(
            email,
            name || undefined,
            resend ? "resend" : "create+send",
          ).then((ok) => {
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
            disabled={!enabled || !!busy || resend}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {resend && (
          <p className="tree-meta">Tên không đổi khi gửi lại thư mời.</p>
        )}
        {hasAccount && (
          <p role="alert" className="notice">
            Email này đã có tài khoản; dùng Sửa → Bật lại trong bảng tài khoản.
          </p>
        )}
        <div className="edit-actions">
          <button
            type="submit"
            className="primary"
            disabled={!enabled || !!busy || hasAccount}
          >
            {mainLabel}
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
                          aria-label={`Gửi lại thư tới ${r.email}`}
                          disabled={!!busy}
                          onClick={() =>
                            void sendMail(r.email, undefined, "resend")
                          }
                        >
                          Gửi lại thư
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
                        aria-label={`Mời lại và gửi thư tới ${r.email}`}
                        disabled={!!busy}
                        onClick={() =>
                          void sendMail(
                            r.email,
                            r.displayName || undefined,
                            "create+send",
                          )
                        }
                      >
                        Mời lại và gửi thư
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
