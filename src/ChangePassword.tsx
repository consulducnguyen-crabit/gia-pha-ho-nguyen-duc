// Đổi mật khẩu bắt buộc ở lần đăng nhập đầu (users.mustChangePassword == true) cho tài khoản Email/Mật khẩu.
// Cờ chỉ điều khiển màn hình này (rules cho người dùng tự hạ cờ); mật khẩu mới do Firebase Auth lưu.
import { useState } from "react";
import { signOut, updatePassword, type User } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { checkNewPassword, NEW_PASSWORD_MIN } from "./passwordRules";

export function ChangePasswordGate({ user }: { user: User }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = String(data.get("next") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    const problem = checkNewPassword(next, confirm, user.email ?? "");
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updatePassword(user, next);
      await updateDoc(doc(db!, "users", user.uid), {
        mustChangePassword: false,
        passwordChangedAt: serverTimestamp(),
      });
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code ?? "";
      setError(
        code === "auth/requires-recent-login"
          ? "Phiên đăng nhập đã cũ. Hãy bấm Đăng xuất, đăng nhập lại bằng mật khẩu tạm rồi đổi mật khẩu."
          : code === "auth/weak-password"
            ? "Mật khẩu mới quá yếu. Chọn mật khẩu khó đoán hơn."
            : "Không đổi được mật khẩu. Kiểm tra mạng rồi thử lại.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gate">
      <main className="login" id="main">
        <div className="eyebrow">GÌN GIỮ CỘI NGUỒN</div>
        <h1>Đổi mật khẩu</h1>
        <p>
          Đây là lần đăng nhập đầu tiên bằng mật khẩu tạm do quản trị viên cấp.
          Hãy đặt mật khẩu của riêng bạn trước khi tiếp tục.
        </p>
        <form noValidate onSubmit={(e) => void submit(e)}>
          <label>
            Mật khẩu mới
            <input
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={NEW_PASSWORD_MIN}
              required
            />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={NEW_PASSWORD_MIN}
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu mật khẩu mới"}
          </button>
        </form>
        <p>
          <button type="button" onClick={() => void signOut(auth!)}>
            Đăng xuất
          </button>
        </p>
      </main>
    </div>
  );
}
