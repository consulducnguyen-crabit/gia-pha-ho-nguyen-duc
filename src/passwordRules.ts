// Kiểm tra mật khẩu mới khi đổi mật khẩu lần đầu (hàm thuần để kiểm thử).
export const NEW_PASSWORD_MIN = 8;

/** Trả thông báo lỗi tiếng Việt, hoặc chuỗi rỗng nếu hợp lệ. `login` là email đăng nhập (có thể là email ngầm của số điện thoại). */
export function checkNewPassword(
  next: string,
  confirm: string,
  login: string,
): string {
  if ([...next].length < NEW_PASSWORD_MIN)
    return `Mật khẩu mới phải có ít nhất ${NEW_PASSWORD_MIN} ký tự.`;
  if (next !== confirm) return "Hai lần nhập mật khẩu mới chưa khớp.";
  const phone = /^(\d{10})@gp\.nguyenduc$/i.exec(login.trim())?.[1];
  if (phone && (next === phone || next.replace(/\D/g, "") === phone))
    return "Không dùng số điện thoại làm mật khẩu.";
  return "";
}
