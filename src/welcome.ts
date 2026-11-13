// Cờ chào mừng sau khi nhận lời mời: lưu tạm trong sessionStorage ({uid, name}), chỉ hiện cho đúng người vừa kích hoạt,
// đọc rồi xóa ngay khi banner mount (hiện đúng một lần) và bị xóa khi đăng xuất/đổi tài khoản.
export const WELCOME_KEY = "gia-pha:welcome";

export function welcomeText(name: string, email?: string | null): string {
  const who = name.trim();
  const tail = email
    ? ` Bạn đang đăng nhập bằng ${email}; bạn được mời xem gia phả dòng họ với quyền Chỉ xem.`
    : " Bạn đã được mời xem gia phả dòng họ với quyền Chỉ xem.";
  return `Chào mừng${who ? ` ${who}` : ""}!${tail}`;
}

export function setWelcome(uid: string, name: string) {
  try {
    sessionStorage.setItem(
      WELCOME_KEY,
      JSON.stringify({ uid, name: name.slice(0, 120) }),
    );
  } catch {
    /* bỏ qua: trình duyệt chặn sessionStorage */
  }
}
/** Đọc cờ chào mừng cho đúng uid; null nếu không có, hỏng hoặc của người khác. Không xóa. */
export function readWelcome(uid: string): { name: string } | null {
  try {
    const raw = sessionStorage.getItem(WELCOME_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { uid?: unknown; name?: unknown };
    if (v.uid !== uid) return null;
    return { name: typeof v.name === "string" ? v.name : "" };
  } catch {
    return null;
  }
}
export function clearWelcome() {
  try {
    sessionStorage.removeItem(WELCOME_KEY);
  } catch {
    /* bỏ qua */
  }
}
/** Xóa cờ nếu không thuộc người đang đăng nhập (uid null = đã đăng xuất). */
export function pruneWelcome(uid: string | null) {
  try {
    const raw = sessionStorage.getItem(WELCOME_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { uid?: unknown };
    if (uid === null || v.uid !== uid) clearWelcome();
  } catch {
    clearWelcome();
  }
}
