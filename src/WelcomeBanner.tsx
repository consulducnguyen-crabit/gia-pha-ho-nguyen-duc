// Lời chào một lần sau khi nhận lời mời: cờ (sessionStorage) được đọc rồi xóa khi mount; giữ trong state tới khi "Đã hiểu".
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { clearWelcome, readWelcome, welcomeText } from "./welcome";

export function WelcomeBanner({
  uid,
  email,
}: {
  uid: string;
  email: string | null;
}) {
  const [welcome, setWelcome] = useState(() => readWelcome(uid));
  useEffect(() => {
    clearWelcome(); // hiện đúng một lần: tải lại trang không hiện nữa
  }, []);
  if (!welcome) return null;
  return (
    <div role="status" className="notice welcome-banner">
      <p>{welcomeText(welcome.name, email)}</p>
      <div className="edit-actions">
        <button type="button" onClick={() => setWelcome(null)}>
          Đã hiểu
        </button>
        <button type="button" onClick={() => void signOut(auth!)}>
          Không phải bạn? Đăng xuất
        </button>
      </div>
    </div>
  );
}
