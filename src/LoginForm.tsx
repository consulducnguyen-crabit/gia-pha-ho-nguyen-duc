// Khu đăng nhập: một ô "Số điện thoại" + Mật khẩu (Email/Mật khẩu của Firebase Auth) và nút Gmail cho tài khoản đã đăng ký.
// Ô nhập cũng nhận email (có "@") để tài khoản email/mật khẩu sẵn có vẫn vào được, không cần tab riêng.
// Đăng nhập không thành công luôn hiện cùng một thông báo, không tiết lộ số/email có tồn tại hay không.
import { useState } from "react";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "./firebase";
import { loginInputToEmail, REGISTER_CONTACT } from "./phoneLogin";

/** Biểu tượng Gmail (nhiều màu) để dễ nhận biết nút đăng nhập bằng Gmail. */
function GmailIcon() {
  return (
    <svg
      className="gmail-icon"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4caf50"
        d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"
      />
      <path
        fill="#1e88e5"
        d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"
      />
      <polygon
        fill="#e53935"
        points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"
      />
      <path
        fill="#c62828"
        d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z"
      />
      <path
        fill="#fbc02d"
        d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0C43.076,8,45,9.924,45,12.298z"
      />
    </svg>
  );
}

export function LoginFailedNotice({ id }: { id?: string }) {
  return (
    <div role="alert" id={id} className="login-error">
      <p>Vui lòng kiểm tra thông tin vừa nhập.</p>
      <p>
        Nếu chưa có tài khoản, xin liên hệ zalo:{" "}
        <a
          href={`https://zalo.me/${REGISTER_CONTACT.zalo}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {REGISTER_CONTACT.zalo}
        </a>{" "}
        ({REGISTER_CONTACT.label}) để đăng ký.
      </p>
    </div>
  );
}

export function LoginForm() {
  const [failed, setFailed] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    setGoogleError("");
    const data = new FormData(e.currentTarget);
    const email = loginInputToEmail(String(data.get("login") ?? ""));
    try {
      if (!email) throw new Error("INVALID_IDENTITY");
      await signInWithEmailAndPassword(
        auth!,
        email,
        String(data.get("password") ?? ""),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    setFailed(false);
    setGoogleError("");
    try {
      await signInWithPopup(auth!, new GoogleAuthProvider());
    } catch (cause) {
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? String(cause.code)
          : "";
      if (
        code !== "auth/popup-closed-by-user" &&
        code !== "auth/cancelled-popup-request"
      )
        setGoogleError(
          "Không thể đăng nhập bằng Gmail. Cho phép cửa sổ bật lên rồi thử lại.",
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p>Đăng nhập bằng tài khoản đã được cấp quyền.</p>
      <form noValidate onSubmit={(e) => void onSubmit(e)}>
        <label>
          Số điện thoại
          <input
            name="login"
            type="tel"
            inputMode="tel"
            autoComplete="username"
            placeholder="Ví dụ: 0912345678"
            aria-describedby={failed ? "login-error" : undefined}
            required
          />
        </label>
        <label>
          Mật khẩu
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            aria-describedby={failed ? "login-error" : undefined}
            required
          />
        </label>
        {failed && <LoginFailedNotice id="login-error" />}
        <button className="primary" disabled={busy}>
          {busy ? "Đang đăng nhập…" : "Đăng nhập →"}
        </button>
      </form>
      <p className="login-or">hoặc</p>
      <button
        type="button"
        className="gmail-button"
        disabled={busy}
        onClick={() => void onGoogle()}
      >
        <GmailIcon />
        Đăng nhập bằng Gmail đã đăng ký
      </button>
      {googleError && <p role="alert">{googleError}</p>}
    </div>
  );
}
