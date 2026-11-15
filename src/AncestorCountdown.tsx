// Đếm ngược đến ngày giỗ Tổ (mùng 1 tháng 9 âm lịch) ở góc trên bên phải panel đăng nhập.
// Chỉ là thông tin công khai tính tại trình duyệt, không gọi máy chủ, không dùng dữ liệu gia phả.
import { useEffect, useState } from "react";
import { formatSolar, nextAncestorDay } from "./ancestorDay";

function CalendarIcon() {
  return (
    <svg
      className="ancestor-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function AncestorCountdown() {
  const [now, setNow] = useState(() => new Date());
  // Cập nhật mỗi phút để qua nửa đêm giờ Việt Nam thì số ngày tự giảm mà không cần tải lại trang.
  useEffect(() => {
    const id = globalThis.setInterval(() => setNow(new Date()), 60_000);
    return () => globalThis.clearInterval(id);
  }, []);
  // Phụ kiện trang trí: nếu trình duyệt không tính được (thiếu dữ liệu múi giờ...) thì ẩn đi, không làm hỏng form đăng nhập.
  let result;
  try {
    result = nextAncestorDay(now);
  } catch {
    return null;
  }
  const { date, daysLeft } = result;
  const iso = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  return (
    <div
      className="ancestor-countdown"
      role="group"
      aria-label="Đếm ngược đến ngày giỗ Tổ"
    >
      <div className="ancestor-title">Giỗ Tổ · 01/9 âm lịch</div>
      <div className="ancestor-date">
        <CalendarIcon />
        <time dateTime={iso}>{formatSolar(date)}</time>
      </div>
      <div className="ancestor-left">
        {daysLeft === 0 ? (
          <b>Hôm nay</b>
        ) : (
          <>
            Còn <b>{daysLeft}</b> ngày
          </>
        )}
      </div>
    </div>
  );
}
