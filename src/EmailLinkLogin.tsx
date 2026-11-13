// Đăng nhập không mật khẩu bằng liên kết gửi qua email (khối trong màn cổng). Không có đăng ký mật khẩu.
// Liên kết đã được chụp và làm sạch khỏi URL ở cấp App (capturePendingLink); ở đây chỉ hoàn tất khi chưa đăng nhập.
import { useEffect, useRef, useState } from "react";
import { signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import {
  clearStoredEmail,
  completeLoginLink,
  consumePendingLink,
  emailLinkErrorMessage,
  getPendingEmail,
  getPendingLink,
  isDeadLinkError,
  restorePendingLink,
  sendLoginLink,
} from "./emailLink";

// StrictMode chạy effect hai lần; oobCode chỉ dùng được một lần nên hoàn tất tự động đúng một lần cho mỗi liên kết.
let autoAttemptedHref = "";

export function EmailLinkLogin() {
  const hasLink = !!getPendingLink();
  const [phase, setPhase] = useState<
    "idle" | "sent" | "completing" | "needEmail"
  >(hasLink ? (getPendingEmail() ? "completing" : "needEmail") : "idle");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const msgRef = useRef<HTMLParagraphElement>(null);

  async function complete(address: string) {
    const href = getPendingLink();
    if (!href) return;
    setPhase("completing");
    setError("");
    // Bỏ liên kết khỏi bộ nhớ trước khi đăng nhập để App không hiện màn "đang đăng nhập bằng tài khoản khác";
    // khôi phục nếu lỗi còn thử lại được (email sai, mất mạng).
    consumePendingLink();
    try {
      await completeLoginLink(auth!, address, href);
    } catch (cause) {
      setError(emailLinkErrorMessage(cause));
      if (isDeadLinkError(cause)) {
        // Liên kết đã hỏng/dùng rồi: bỏ href và email tạm.
        clearStoredEmail();
        setPhase("idle");
      } else {
        restorePendingLink(href);
        setPhase("needEmail");
      }
    }
  }
  useEffect(() => {
    const href = getPendingLink();
    if (!href || autoAttemptedHref === href) return;
    autoAttemptedHref = href;
    // Email điền sẵn (?invitee= hoặc email tạm cùng thiết bị) chỉ là đầu vào cho Firebase, nơi tự kiểm khớp với oobCode;
    // chỉ hỏi người dùng khi cả hai nguồn đều thiếu.
    const prefilled = getPendingEmail();
    if (prefilled) void complete(prefilled);
    else setPhase("needEmail");
  }, []);
  useEffect(() => {
    if (phase === "sent" || error) msgRef.current?.focus();
  }, [phase, error]);

  if (phase === "completing")
    return (
      <p role="status" className="login-link-status">
        Đang hoàn tất đăng nhập bằng liên kết…
      </p>
    );
  return (
    <section className="login-link">
      <p className="login-or">hoặc nhận liên kết đăng nhập gửi qua email</p>
      {phase === "needEmail" && (
        <p role="status" className="notice">
          Bạn đang mở liên kết đăng nhập. Nhập lại đúng email đã nhận thư để
          hoàn tất.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (phase === "needEmail") {
              await complete(email);
            } else {
              const address = await sendLoginLink(auth!, email, {
                remember: true,
              });
              setSentTo(address);
              setPhase("sent");
            }
          } catch (cause) {
            setError(emailLinkErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email nhận liên kết
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" tabIndex={-1} ref={msgRef}>
            {error}
          </p>
        )}
        {phase === "sent" && (
          <p role="status" tabIndex={-1} ref={msgRef}>
            Đã gửi liên kết tới {sentTo}. Mở thư (kiểm tra cả mục thư rác) và
            bấm liên kết; nên mở trên thiết bị và trình duyệt này.
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy
            ? "Đang xử lý…"
            : phase === "needEmail"
              ? "Hoàn tất đăng nhập"
              : "Gửi liên kết"}
        </button>
      </form>
    </section>
  );
}

/** Đang đăng nhập bằng tài khoản khác trong khi mở liên kết đăng nhập: cho chọn đăng xuất hoặc bỏ liên kết. */
export function LinkConflict({
  user,
  onDiscard,
}: {
  user: User;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="gate">
      <main className="login">
        <h2>Liên kết đăng nhập</h2>
        <p role="alert" tabIndex={-1} ref={ref}>
          Bạn đang đăng nhập bằng {user.email ?? "một tài khoản khác"}; đăng
          xuất để dùng liên kết đăng nhập cho email khác.
        </p>
        <div className="edit-actions">
          <button
            type="button"
            className="primary"
            onClick={() => void signOut(auth!)}
          >
            Đăng xuất
          </button>
          <button type="button" onClick={onDiscard}>
            Bỏ liên kết và tiếp tục
          </button>
        </div>
      </main>
    </div>
  );
}
