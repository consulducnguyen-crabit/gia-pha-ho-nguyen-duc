// Ngày giỗ Tổ hàng năm: mùng 1 tháng 9 âm lịch. Tính ngày dương của lần giỗ tiếp theo và số ngày còn lại (giờ Việt Nam).
import { jdFromDate, lunarToSolar, type SolarDate } from "./lunarCalendar";

export interface AncestorCountdown {
  /** Ngày dương của lần giỗ Tổ tiếp theo (hôm nay cũng tính nếu trùng). */
  date: SolarDate;
  /** Số ngày từ hôm nay đến ngày giỗ; 0 nghĩa là hôm nay. */
  daysLeft: number;
}

/** Ngày hôm nay theo giờ Việt Nam (Asia/Ho_Chi_Minh), không phụ thuộc múi giờ máy. */
export function todayInVietnam(now: Date): SolarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const r = { day: get("day"), month: get("month"), year: get("year") };
  if (!Number.isFinite(r.day + r.month + r.year))
    throw Error("Không đọc được ngày theo giờ Việt Nam");
  return r;
}

export function nextAncestorDay(now: Date): AncestorCountdown {
  const today = todayInVietnam(now);
  const todayJd = jdFromDate(today.day, today.month, today.year);
  for (let year = today.year; year <= today.year + 1; year++) {
    const date = lunarToSolar(1, 9, year);
    if (!date) continue;
    const daysLeft = jdFromDate(date.day, date.month, date.year) - todayJd;
    if (daysLeft >= 0) return { date, daysLeft };
  }
  throw Error("Không tính được ngày giỗ Tổ tiếp theo");
}

const two = (n: number) => String(n).padStart(2, "0");
export const formatSolar = (d: SolarDate) =>
  `${two(d.day)}/${two(d.month)}/${d.year}`;
