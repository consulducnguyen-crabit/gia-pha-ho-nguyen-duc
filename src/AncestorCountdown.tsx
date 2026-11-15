// Đếm ngược đến ngày giỗ Tổ (mùng 1 tháng 9 âm lịch) ở góc trên bên phải panel đăng nhập.
// Chỉ là thông tin công khai tính tại trình duyệt, không gọi máy chủ, không dùng dữ liệu gia phả.
import { useEffect, useState } from "react";
import { formatSolar, nextAncestorDay, weekdayName } from "./ancestorDay";

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
      {/* Tờ lịch bloc: gáy lịch phía trên, ô tháng/năm, thứ và số ngày lớn (chỉ trang trí; nội dung đọc nằm ở khối bên phải). */}
      <div className="ancestor-binding" aria-hidden="true" />
      <div className="ancestor-body">
        <div className="ancestor-page" aria-hidden="true">
          <div className="ancestor-mini">
            <span>
              <small>Tháng</small>
              <b>{date.month}</b>
            </span>
            <span>
              <small>Năm</small>
              <b>{date.year}</b>
            </span>
          </div>
          <div className="ancestor-weekday">{weekdayName(date)}</div>
          <div className="ancestor-day">{date.day}</div>
        </div>
        <div className="ancestor-info">
          <div className="ancestor-title">Giỗ Tổ</div>
          <div className="ancestor-sub">01/9 âm lịch</div>
          <div className="ancestor-date">
            <CalendarIcon />
            <time dateTime={iso}>
              <span className="sr-only">{weekdayName(date)}, </span>
              {formatSolar(date)}
            </time>
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
      </div>
    </div>
  );
}
