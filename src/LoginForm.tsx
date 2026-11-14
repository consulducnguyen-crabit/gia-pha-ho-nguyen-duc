// Khu đăng nhập: hai tab "Điện thoại | Email" (cùng Email/Mật khẩu của Firebase Auth) và nút Google cho tài khoản đã có.
// Đăng nhập không thành công luôn hiện cùng một thông báo, không tiết lộ số/email có tồn tại hay không.
import { useRef, useState, type KeyboardEvent } from "react";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "./firebase";
import { EmailLinkLogin } from "./EmailLinkLogin";
import { getPendingLink } from "./emailLink";
import { phoneToEmail, REGISTER_CONTACT } from "./phoneLogin";

type Tab = "phone" | "email";
const TABS: { id: Tab; label: string }[] = [
  { id: "phone", label: "Điện thoại" },
  { id: "email", label: "Email" },
];

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

export function LoginForm({
  onLinking,
}: {
  /** Đăng nhập bằng liên kết email (tạm giữ ở tab Email; gỡ cùng lời mời ở PR sau). */
  onLinking: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>(() =>
    getPendingLink() ? "email" : "phone",
  );
  const [failed, setFailed] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [busy, setBusy] = useState(false);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    phone: null,
    email: null,
  });

  function select(next: Tab) {
    setTab(next);
    setFailed(false);
    setGoogleError("");
  }
  // Mẫu tab WAI-ARIA: phím mũi tên chuyển tab, Home/End về đầu/cuối.
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    setGoogleError("");
    const data = new FormData(e.currentTarget);
    const identity = String(data.get(tab) ?? "");
    const email =
      tab === "phone" ? phoneToEmail(identity) : identity.trim().toLowerCase();
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
          "Không thể đăng nhập bằng Google. Cho phép cửa sổ bật lên rồi thử lại.",
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p>Đăng nhập bằng tài khoản đã được cấp quyền.</p>
      <div className="login-tabs" role="tablist" aria-label="Cách đăng nhập">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`login-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="login-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={onTabKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        id="login-panel"
        role="tabpanel"
        aria-label={
          tab === "phone"
            ? "Đăng nhập bằng số điện thoại"
            : "Đăng nhập bằng thư điện tử"
        }
        onSubmit={(e) => void onSubmit(e)}
        key={tab}
        noValidate={tab === "phone"}
      >
        <label>
          {tab === "phone" ? "Số điện thoại" : "Email"}
          <input
            name={tab}
            type={tab === "phone" ? "tel" : "email"}
            inputMode={tab === "phone" ? "tel" : "email"}
            autoComplete="username"
            placeholder={tab === "phone" ? "Ví dụ 0914 222 987" : undefined}
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
      <p className="login-or">hoặc dùng tài khoản Gmail đã được cấp quyền</p>
      <button type="button" disabled={busy} onClick={() => void onGoogle()}>
        Đăng nhập bằng Google
      </button>
      {googleError && <p role="alert">{googleError}</p>}
      <div hidden={tab !== "email"}>
        <EmailLinkLogin onCompleting={onLinking} />
      </div>
    </div>
  );
}
