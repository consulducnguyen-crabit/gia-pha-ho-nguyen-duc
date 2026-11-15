import { describe, expect, it } from "vitest";
import {
  formatSolar,
  nextAncestorDay,
  todayInVietnam,
  weekdayName,
} from "../src/ancestorDay";
import { jdFromDate, jdToDate, lunarToSolar } from "../src/lunarCalendar";

const iso = (d: { year: number; month: number; day: number } | null) =>
  d
    ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
    : null;

describe("đổi âm lịch → dương lịch (UTC+7)", () => {
  it("ngày Julian đi và về đúng", () => {
    expect(jdToDate(jdFromDate(10, 10, 2026))).toEqual({
      day: 10,
      month: 10,
      year: 2026,
    });
  });
  it("mùng 1 Tết các năm 2020–2029 khớp lịch Việt Nam", () => {
    const tet = [
      [2020, "2020-01-25"],
      [2021, "2021-02-12"],
      [2022, "2022-02-01"],
      [2023, "2023-01-22"],
      [2024, "2024-02-10"],
      [2025, "2025-01-29"],
      [2026, "2026-02-17"],
      [2027, "2027-02-06"],
      [2028, "2028-01-26"],
      [2029, "2029-02-13"],
    ] as const;
    for (const [year, expected] of tet)
      expect(iso(lunarToSolar(1, 1, year))).toBe(expected);
  });
  it("Rằm tháng 8 (Trung thu) 2023–2026", () => {
    expect(iso(lunarToSolar(15, 8, 2023))).toBe("2023-09-29");
    expect(iso(lunarToSolar(15, 8, 2024))).toBe("2024-09-17");
    expect(iso(lunarToSolar(15, 8, 2025))).toBe("2025-10-06");
    expect(iso(lunarToSolar(15, 8, 2026))).toBe("2026-09-25");
  });
  it("mùng 1 tháng 9 âm lịch 2024–2030 (trùng cả lịch Intl Trung Quốc lẫn lịch Việt Nam)", () => {
    const expected: Record<number, string> = {
      2024: "2024-10-03",
      2025: "2025-10-21",
      2026: "2026-10-10",
      2027: "2027-09-30",
      2028: "2028-10-18",
      2029: "2029-10-08",
      2030: "2030-09-27",
    };
    for (const [y, e] of Object.entries(expected))
      expect(iso(lunarToSolar(1, 9, Number(y)))).toBe(e);
  });
  it("hồi quy: 2023 nhuận tháng 2 (không phải tháng 1); sóc sát nửa đêm 1/7/2026", () => {
    expect(iso(lunarToSolar(1, 2, 2023, false))).toBe("2023-02-20");
    expect(iso(lunarToSolar(1, 2, 2023, true))).toBe("2023-03-22");
    expect(lunarToSolar(1, 1, 2023, true)).toBeNull();
    // Sóc rơi vào 00:4x giờ Việt Nam ngày 13/8/2026: tháng 7 bắt đầu 13/8 chứ không phải 12/8.
    expect(iso(lunarToSolar(1, 7, 2026))).toBe("2026-08-13");
  });
  it("tháng nhuận: 2025 nhuận tháng 6, tháng 7 bắt đầu sau tháng nhuận", () => {
    expect(iso(lunarToSolar(1, 6, 2025, false))).toBe("2025-06-25");
    expect(iso(lunarToSolar(1, 6, 2025, true))).toBe("2025-07-25");
    expect(iso(lunarToSolar(1, 7, 2025))).toBe("2025-08-23");
    expect(lunarToSolar(1, 5, 2025, true)).toBeNull();
  });
});

describe("đếm ngược giỗ Tổ", () => {
  it("lấy ngày hôm nay theo giờ Việt Nam, không theo múi giờ máy", () => {
    // 18:00 UTC ngày 9/10 = 01:00 ngày 10/10 giờ Việt Nam
    expect(todayInVietnam(new Date("2026-10-09T18:00:00Z"))).toEqual({
      day: 10,
      month: 10,
      year: 2026,
    });
    expect(todayInVietnam(new Date("2026-10-09T16:59:00Z"))).toEqual({
      day: 9,
      month: 10,
      year: 2026,
    });
  });
  it("trước ngày giỗ: còn bao nhiêu ngày", () => {
    const r = nextAncestorDay(new Date("2026-10-09T05:00:00Z"));
    expect(iso(r.date)).toBe("2026-10-10");
    expect(r.daysLeft).toBe(1);
    const far = nextAncestorDay(new Date("2026-01-01T05:00:00Z"));
    expect(iso(far.date)).toBe("2026-10-10");
    expect(far.daysLeft).toBe(282);
  });
  it("đúng ngày giỗ: còn 0 ngày (hôm nay), kể cả khi giờ máy chưa sang ngày", () => {
    expect(nextAncestorDay(new Date("2026-10-10T05:00:00Z")).daysLeft).toBe(0);
    expect(nextAncestorDay(new Date("2026-10-09T18:00:00Z")).daysLeft).toBe(0);
  });
  it("sau ngày giỗ: chuyển sang năm sau", () => {
    const r = nextAncestorDay(new Date("2026-10-11T05:00:00Z"));
    expect(iso(r.date)).toBe("2027-09-30");
    expect(r.daysLeft).toBe(354);
  });
  it("cuối năm dương vẫn ra năm kế tiếp, định dạng dd/mm/yyyy", () => {
    const r = nextAncestorDay(new Date("2030-12-31T05:00:00Z"));
    expect(iso(r.date)).toBe("2031-10-16");
    expect(formatSolar(r.date)).toBe("16/10/2031");
  });
});

describe("thứ trong tuần", () => {
  it("khớp lịch: 30/09/2027 Thứ Năm, 10/10/2026 Thứ Bảy, 15/11/2026 Chủ nhật", () => {
    expect(weekdayName({ day: 30, month: 9, year: 2027 })).toBe("Thứ Năm");
    expect(weekdayName({ day: 10, month: 10, year: 2026 })).toBe("Thứ Bảy");
    expect(weekdayName({ day: 15, month: 11, year: 2026 })).toBe("Chủ nhật");
  });
  it("đủ bảy thứ liên tiếp từ Thứ Hai 05/10/2026", () => {
    const names = [5, 6, 7, 8, 9, 10, 11].map((day) =>
      weekdayName({ day, month: 10, year: 2026 }),
    );
    expect(names).toEqual([
      "Thứ Hai",
      "Thứ Ba",
      "Thứ Tư",
      "Thứ Năm",
      "Thứ Sáu",
      "Thứ Bảy",
      "Chủ nhật",
    ]);
  });
  it("mốc cố định 01/01/2000 là Thứ Bảy", () => {
    expect(weekdayName({ day: 1, month: 1, year: 2000 })).toBe("Thứ Bảy");
  });
});
