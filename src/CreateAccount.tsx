// Khu "Tạo tài khoản" của #/users: quản trị viên tạo tài khoản đăng nhập bằng số điện thoại hoặc email cho thành viên đã
// đăng ký trực tiếp. Mật khẩu tạm sinh ngẫu nhiên, hiện đúng MỘT lần để gửi riêng (Zalo); thành viên phải đổi ở lần đầu.
import { useId, useRef, useState } from "react";
import { db, emulator, firebaseApp } from "./firebase";
import {
  CreateAccountError,
  createLoginAccount,
  generatePassword,
  loginEmailFor,
  type CreatedAccount,
  type LoginKind,
} from "./accountCreate";
import { accountErrorMessage } from "./accountsClient";

export function CreateAccountSection({
  enabled,
  uid,
  existingEmails,
  onCreated,
}: {
  /** Sổ quản trị hợp lệ và chứa tài khoản của bạn. */
  enabled: boolean;
  uid: string;
  /** Email đăng nhập (viết thường) đã có hồ sơ users. */
  existingEmails: Set<string>;
  onCreated: () => void;
}) {
  const uniq = useId();
  const [kind, setKind] = useState<LoginKind>("phone");
  const [value, setValue] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [result, setResult] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);
  // Giữ mật khẩu giữa các lần thử cùng một danh tính để thử lại an toàn sau khi Auth đã tạo mà ghi hồ sơ lỗi.
  const pending = useRef<{ key: string; password: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCopied(false);
    let email: string;
    try {
      email = loginEmailFor(kind, value);
    } catch (cause) {
      setError((cause as Error).message);
      setRetryable(false);
      return;
    }
    if (existingEmails.has(email)) {
      setError(
        "Đã có tài khoản với số điện thoại/email này trong danh sách bên dưới.",
      );
      setRetryable(false);
      return;
    }
    if (!pending.current || pending.current.key !== email)
      pending.current = { key: email, password: generatePassword() };
    setBusy(true);
    try {
      const created = await createLoginAccount(
        db!,
        firebaseApp!,
        emulator,
        uid,
        {
          kind,
          value,
          displayName: name,
          password: pending.current.password,
        },
      );
      pending.current = null;
      setResult(created);
      setValue("");
      setName("");
      setRetryable(false);
      onCreated();
    } catch (cause) {
      const known = cause instanceof CreateAccountError;
      setError(known ? cause.message : accountErrorMessage(cause));
      // Chỉ cho "Thử lại" khi Auth đã tạo/đăng nhập được nhưng chưa ghi hồ sơ.
      setRetryable(known && cause.code === "GRANT_FAILED");
      if (known && cause.code === "TAKEN_OUTSIDE") pending.current = null;
    } finally {
      setBusy(false);
    }
  }

  const shareText = result
    ? [
        "Gia phả dòng họ Nguyễn Đức - Thôn Hạ - Phùng Xá",
        `Trang đăng nhập: ${globalThis.location.origin}${globalThis.location.pathname}`,
        result.phone
          ? `Số điện thoại đăng nhập: ${result.phone}`
          : `Email đăng nhập: ${result.email}`,
        `Mật khẩu tạm: ${result.password}`,
        "Vui lòng đổi mật khẩu ở lần đăng nhập đầu tiên.",
      ].join("\n")
    : "";

  return (
    <section className="users-create" aria-labelledby={`${uniq}-h`}>
      <h2 id={`${uniq}-h`}>Tạo tài khoản</h2>
      <p className="tree-summary">
        Thành viên đăng ký trực tiếp với quản trị viên. Tạo tài khoản theo số
        điện thoại hoặc email; hệ thống sinh mật khẩu tạm để bạn gửi riêng cho
        thành viên (Zalo), thành viên phải đổi mật khẩu ở lần đăng nhập đầu. Tài
        khoản mới chỉ có quyền Chỉ xem.
      </p>
      {!enabled && (
        <p role="alert" className="notice">
          Sổ quản trị chưa sẵn sàng nên chưa tạo được tài khoản.
        </p>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={!enabled || busy}>
          <legend>Đăng nhập bằng</legend>
          <label className="inline-choice">
            <input
              type="radio"
              name={`${uniq}-kind`}
              checked={kind === "phone"}
              onChange={() => setKind("phone")}
            />{" "}
            Số điện thoại
          </label>
          <label className="inline-choice">
            <input
              type="radio"
              name={`${uniq}-kind`}
              checked={kind === "email"}
              onChange={() => setKind("email")}
            />{" "}
            Email
          </label>
          <label>
            {kind === "phone" ? "Số điện thoại" : "Email"}
            <input
              type={kind === "phone" ? "tel" : "email"}
              inputMode={kind === "phone" ? "tel" : "email"}
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "phone" ? "Ví dụ 0914 222 987" : undefined}
              required
            />
          </label>
          <label>
            Họ và tên thành viên (không bắt buộc)
            <input
              type="text"
              autoComplete="off"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary" type="submit">
            {busy ? "Đang tạo…" : retryable ? "Thử lại" : "Tạo tài khoản"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="notice users-created">
          <p>
            <strong>Đã tạo tài khoản.</strong> Mật khẩu chỉ hiện một lần; hãy
            gửi riêng cho thành viên rồi bấm “Đã ghi lại”.
          </p>
          <dl>
            <dt>{result.phone ? "Số điện thoại" : "Email"}</dt>
            <dd>{result.phone ?? result.email}</dd>
            <dt>Mật khẩu tạm</dt>
            <dd>
              <code>{result.password}</code>
            </dd>
          </dl>
          <button
            type="button"
            onClick={() => {
              void globalThis.navigator.clipboard
                .writeText(shareText)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            Sao chép nội dung để gửi Zalo
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setCopied(false);
            }}
          >
            Đã ghi lại
          </button>
          {copied && <p>Đã sao chép.</p>}
        </div>
      )}
    </section>
  );
}
