// Kiểm tra trình duyệt cho tab "Danh sách thành viên" của trang cây, chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Cần: emulator (auth+firestore) và Vite với VITE_USE_EMULATORS=true đang chạy, đã `npm run seed`.
// Chạy: CHROMIUM_PATH=... node scripts/tree-browser-check.mjs
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { parseDsl } from "./gia-pha/dsl.ts";
import { buildImportPlan } from "./gia-pha/import-plan.ts";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");

// Dữ liệu hoàn toàn giả.
const source = [
  "P|cct|Cụ cao tổ|M|CLAN|I|||",
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|II|I||",
  "P|a|Giả Văn Hải|M|CLAN|III|I|b=1927|",
  "P|b|Giả Minh Hải|M|CLAN|III|II|b=1930|",
  "P|c|Giả Hải|M|CLAN|IV|II|b=1955|",
  "P|d|Giả Văn Ân|M|CLAN|IV|I|b=1960|",
  "P|e|Giả Văn Đức|M|CLAN|IV|I|b=1962|",
  "P|va|Vợ Giả Hải|F|SPOUSE|||b=1930|",
  "K|cct|-|ts",
  "K|ts|-|a,b",
  "K|a|va|d,e",
  "K|b|-|c",
  "B|I|Chi Một|ts||",
  "B|II|Chi Hai|b||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "import-browser-fake");
const snapshot = plan.docs.find((d) => d.path === "treeSnapshots/main").data;
const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: "demo-gia-pha" }));
await db.doc("treeSnapshots/main").set(snapshot);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("tab", { name: "Email" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("thanhvien@example.test");
  await page.getByLabel("Mật khẩu").fill("Demo-only-2026!");
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await page.getByRole("link", { name: "Cây gia phả", exact: true }).click();

  const tab = page.getByRole("link", { name: "Danh sách thành viên" });
  await tab.click();
  await expect(page).toHaveURL(/#\/tree\/danh-sach$/);
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Danh sách thành viên", level: 1 }),
  ).toBeVisible();
  expect(await page.title()).toContain("Danh sách thành viên");

  // Thứ tự: nhân vật lịch sử → tên (Ân, Đức, Hải...) → tên đệm → chi → đời.
  const names = await page.locator(".member-list li a").allTextContents();
  const clean = names.map((n) => n.trim());
  const groups = await page.locator(".member-group h2").allTextContents();
  console.log("Thứ tự:", clean.join(" | "), "| Nhóm:", groups.join(","));
  expect(clean[0]).toBe("Cụ cao tổ");
  expect(groups[0]).toBe("Nhân vật lịch sử");
  const pos = (n) => clean.indexOf(n);
  expect(pos("Giả Văn Ân")).toBeLessThan(pos("Giả Hải"));
  expect(pos("Giả Hải")).toBeLessThan(pos("Giả Minh Hải")); // đệm rỗng trước
  expect(pos("Giả Minh Hải")).toBeLessThan(pos("Giả Văn Hải")); // Minh < Văn
  expect(pos("Giả Văn Ân")).toBeLessThan(pos("Giả Văn Đức")); // Â < Đ
  expect(pos("Giả Văn Đức")).toBeLessThan(pos("Giả Hải")); // Đ < H
  expect(pos("Giả Hải")).toBeLessThan(pos("Vợ Giả Hải")); // đệm rỗng < Giả
  expect(pos("Vợ Giả Hải")).toBeLessThan(pos("Giả Minh Hải")); // Giả < Minh
  expect(clean.length).toBe(8);

  // Bộ lọc và tìm không dấu.
  await page.getByLabel("Tìm theo tên").fill("duc");
  await expect(page.locator(".member-list li")).toHaveCount(1);
  await page.getByLabel("Tìm theo tên").fill("");
  await page.getByLabel("Nhóm").selectOption("SPOUSE");
  await expect(page.locator(".member-list li")).toHaveCount(1);
  await page.getByLabel("Nhóm").selectOption("");
  await page.getByLabel("Xem theo chi").selectOption("II");
  await expect(page.locator(".member-list li")).toHaveCount(2);
  await page.getByLabel("Xem theo chi").selectOption("");

  // Về tab cây bằng nút Quay lại; đường dẫn lạ chuyển về /tree.
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Cây gia phả", level: 1 }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:5173/#/tree/khong-co");
  await expect(page).toHaveURL(/#\/tree$/);

  // Responsive: không tràn ngang ở 360/768/1280.
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("http://127.0.0.1:5173/#/tree/danh-sach");
    await expect(page.locator(".member-list li").first()).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `tràn ngang ở ${width}px`).toBeLessThanOrEqual(0);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/member-list-${width}.png`,
        fullPage: false,
      });
  }
  expect(errors).toEqual([]);
  console.log(
    "Browser: member list tab passed (order, filters, routes, 360/768/1280 no overflow).",
  );
} finally {
  await browser.close();
}
