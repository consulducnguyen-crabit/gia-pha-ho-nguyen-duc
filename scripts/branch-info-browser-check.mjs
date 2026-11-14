// Kiểm tra trình duyệt cho thông tin chi (mergedFrom, ghi chú quản trị), chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/branch-info-browser-check.mjs"
// Đặt SHOT_DIR để chụp ảnh 360/768/1280. Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { parseDsl } from "./gia-pha/dsl.ts";
import { buildImportPlan } from "./gia-pha/import-plan.ts";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");

const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
const PORT = 5197;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const XSS = "<script>window.__pwned=1</script>";
const LONG = "Nguồn rất dài ".repeat(60).trim(); // > 500 ký tự
const NOTE = `Ghi chú quản trị giả ${XSS}`;
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927|",
  "P|b|Giả Thị Bình|F|CLAN|II|II|b=1930|",
  "K|ts|-|a,b",
  `B|I|Chi Một|ts|Dòng giả X ${XSS}|${NOTE}`,
  `B|II|Chi Hai (tên chi khá dài để thử xuống dòng trên màn hình hẹp)||${LONG}|`,
].join("\n");
const plan = buildImportPlan(parseDsl(source), "branch-info-fake");

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const { getAuth } = requireAdmin("firebase-admin/auth");
const app = initializeApp({ projectId: "demo-gia-pha" });
const db = getFirestore(app);
const auth = getAuth(app);

async function account(email, extra) {
  const u = await auth.createUser({ email, password: PASSWORD });
  await db.doc(`users/${u.uid}`).set({
    enabled: true,
    roleIds: ["member"],
    accessVersion: 1,
    schemaVersion: 1,
    ...extra,
  });
}
await account("quantri@example.test", { canManageMembership: true });
await account("thanhvien@example.test", {});
for (const d of plan.docs) await db.doc(d.path).set(d.data);

const vite = spawn(`npx vite --host 127.0.0.1 --port ${PORT} --strictPort`, {
  shell: true,
  env: { ...process.env, VITE_USE_EMULATORS: "true" },
  stdio: "ignore",
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {
    /* chưa sẵn sàng */
  }
  await sleep(500);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
let failed = false;
let stage = "start";
async function login(page, email) {
  await page.goto(URL);
  await page.getByRole("tab", { name: "Email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();
}
async function noOverflow(page, label) {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    if (over > 0) throw Error(`${label}: tràn ngang ${over}px ở ${width}px`);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/${label}-${width}.png`,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function checkRole(email, isAdmin) {
  const label = isAdmin ? "admin" : "member";
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, email);

  stage = `${label}: profile shows merged-from line`;
  await page.goto(`${URL}/#/person/a`);
  await expect(
    page.getByText(/Chi này có nguồn gốc hợp nhất từ: Dòng giả X/),
  ).toBeVisible();
  // Chuỗi chứa thẻ script chỉ là text.
  await expect(page.getByText(XSS, { exact: false }).first()).toBeVisible();
  await noOverflow(page, `${label}-profile`);
  await page.goto(`${URL}/#/person/b`);
  await expect(
    page.getByText(/Chi này có nguồn gốc hợp nhất từ:/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem đầy đủ" })).toBeVisible();

  stage = `${label}: branch filter box`;
  await page.goto(`${URL}/#/tree`);
  await page.getByLabel("Xem theo chi").selectOption("I");
  const box = page.getByRole("region", { name: "Chi Một" });
  await expect(box).toBeVisible();
  await expect(
    box.getByRole("link", { name: "Cụ Giả Thủy Tổ" }),
  ).toHaveAttribute("href", "#/person/ts");
  await expect(box.getByText(/Dòng giả X/)).toBeVisible();
  if (isAdmin) {
    await expect(box.getByText("Ghi chú quản trị (chi)")).toBeVisible();
    await expect(box.getByText(/Ghi chú quản trị giả/)).toBeVisible();
  } else {
    await expect(box.getByText("Ghi chú quản trị (chi)")).toHaveCount(0);
    await expect(page.getByText(/Ghi chú quản trị giả/)).toHaveCount(0);
  }
  await noOverflow(page, `${label}-branch-I`);

  stage = `${label}: long text is clipped with expand button; unknown founder has no link`;
  await page.getByLabel("Xem theo chi").selectOption("II");
  const box2 = page.getByRole("region", { name: /^Chi Hai/ });
  await expect(box2.getByText("Chưa ghi nhận")).toBeVisible();
  await expect(box2.getByRole("link")).toHaveCount(0);
  const text = () => box2.locator(".branch-text").first().innerText();
  const clipped = await text();
  if (!clipped.endsWith("…") || clipped.length > 502)
    throw Error("Chuỗi dài phải được cắt ở 500 ký tự kèm …");
  await box2.getByRole("button", { name: "Xem đầy đủ" }).click();
  if ((await text()).length <= 502)
    throw Error("Xem đầy đủ phải hiện toàn văn");
  await box2.getByRole("button", { name: "Thu gọn" }).click();
  await noOverflow(page, `${label}-branch-II`);

  if (await page.evaluate(() => globalThis.__pwned))
    throw Error("Script trong dữ liệu đã bị thực thi");
  if (errors.length) throw Error("Lỗi trang: " + errors.join("; "));
  await ctx.close();
}
try {
  await checkRole("thanhvien@example.test", false);
  await checkRole("quantri@example.test", true);
  console.log("Kiểm tra trình duyệt thông tin chi: ĐẠT");
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
