// Kiểm tra trình duyệt cho màn hình cây và hồ sơ, chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
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
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927;d=1973|",
  "P|b|Giả Thị Bình|F|CLAN|II|I|b=1930|",
  "P|va|Vợ Giả An|F|SPOUSE|||b=1930|",
  "P|vb|Chồng Giả Bình|M|SPOUSE||||",
  "P|c|Giả Văn Cường|M|CLAN|III|I|b=1955|",
  "P|d|Giả Văn Nuôi|M|CLAN|III|I|b=1960|",
  "P|e|Con Của Bình|M|EXTERNAL||||",
  "P|z|Giả Văn Lạc|M|CLAN|IV|I|b=1950/1951|CẦN XÁC MINH (giả)",
  "K|ts|-|a,b",
  "K|a|va|c,d:A",
  "K|vb|b|e",
  "B|I|Chi Một|ts||",
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
let failed = false;
let stage = "start";
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  stage = "login";
  await page
    .getByLabel("Email", { exact: true })
    .fill("thanhvien@example.test");
  await page.getByLabel("Mật khẩu").fill("Demo-only-2026!");
  await page.getByRole("button", { name: "Đăng nhập →" }).click();

  stage = "open tree";
  await page.getByRole("link", { name: "Cây gia phả", exact: true }).click();
  await expect(
    page.getByText("6 thành viên thuộc dòng họ, 3 đời.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cụ Giả Thủy Tổ" }),
  ).toBeVisible();

  stage = "expand and collapse";
  await expect(page.getByRole("link", { name: "Giả Văn An" })).toBeVisible();
  const toggle = page.getByRole("button", { name: /con cháu của Giả Văn An/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "Giả Văn Nuôi" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mở rộng tất cả" }).click();
  await expect(page.getByRole("link", { name: "Giả Văn Nuôi" })).toBeVisible();

  stage = "adoptive badge is subtle and labelled, lineage stays";
  await expect(
    page.getByText("Con nuôi", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Đời 3").first()).toBeVisible();

  stage = "daughter's children only when requested";
  await expect(page.getByRole("link", { name: "Con Của Bình" })).toHaveCount(0);
  await page.getByLabel("Hiện con của con gái (họ ngoại)").check();
  await page.getByRole("button", { name: "Mở rộng tất cả" }).click();
  await expect(page.getByRole("link", { name: "Con Của Bình" })).toBeVisible();
  await expect(
    page.getByText("Họ ngoại", { exact: true }).first(),
  ).toBeVisible();

  stage = "search ignores diacritics";
  await page.getByLabel("Tìm theo tên").fill("gia van nuoi");
  await expect(page.getByRole("heading", { name: "1 kết quả" })).toBeVisible();

  stage = "review flags on tree, profile and queue page";
  await page.goto("http://127.0.0.1:5173/#/tree");
  await page.getByLabel("Tìm theo tên").fill("giả văn lạc");
  await expect(
    page.getByRole("link", { name: "Cần kiểm tra", exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel("Tìm theo tên").fill("");
  await page
    .getByRole("link", { name: "Cần kiểm tra", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Cần kiểm tra", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Chưa xác định vị trí trong cây/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Năm sinh\/mất trong tài liệu gốc mâu thuẫn/,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Giả Văn Lạc" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Giả Văn Lạc", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cần kiểm tra", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText("Tài liệu gốc chưa rõ, cần xác minh"),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:5173/#/tree");

  stage = "profile";
  await page.getByRole("link", { name: "Giả Văn Nuôi" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Giả Văn Nuôi", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dòng tổ tiên" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cha mẹ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Anh chị em" })).toBeVisible();
  await page.getByRole("link", { name: "← Cây gia phả" }).click();
  await expect(page.getByLabel("Tìm theo tên")).toBeVisible();

  stage = "profile of a missing person";
  await page.goto("http://127.0.0.1:5173/#/person/khong-co");
  await expect(page.getByText("Không tìm thấy thành viên này.")).toBeVisible();

  stage = "mobile has no horizontal overflow";
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("http://127.0.0.1:5173/#/tree");
    await expect(page.getByLabel("Tìm theo tên")).toBeVisible();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Tràn ngang");
  }
  if (errors.length) throw Error("Có lỗi trang");
} catch {
  failed = true;
} finally {
  await db.doc("treeSnapshots/main").delete();
  await browser.close();
}
if (failed) throw Error(`Kiểm tra cây thất bại ở bước: ${stage}`);
console.log(
  "Browser: tree open/expand/collapse, adoptive badge, daughter's children toggle, accent-free search, profile, missing person and 360/768 layout passed.",
);
process.exit(0);
