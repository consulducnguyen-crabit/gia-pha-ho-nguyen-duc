// Kiểm tra trình duyệt cho menu và quyền xem "Cần kiểm tra": chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/nav-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong.
// Quy tắc: không còn tab Tra cứu thành viên và Tiến độ triển khai (và trang của chúng); Cần kiểm tra (tab, trang, nhãn
// trong cây/danh sách, khối ở hồ sơ) chỉ hiện với quản trị viên. Ô tìm theo tên vẫn có ở Cây gia phả và Danh sách thành viên.
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
const PORT = 5194;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I||b=1900;d=1960|",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1930|",
  "P|z|Giả Văn Lạc|M|CLAN|III|I|b=1955;fl=BIRTH_CONFLICT|",
  "K|ts|-|a",
  "K|a|-|z",
  "B|I|Chi Một|a||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "nav-fake");

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const { getAuth } = requireAdmin("firebase-admin/auth");
const app = initializeApp({ projectId: "demo-gia-pha" });
const db = getFirestore(app);
const auth = getAuth(app);

const adminUser = await auth.createUser({
  email: "quantri-nav@example.test",
  password: PASSWORD,
});
await db.doc(`users/${adminUser.uid}`).set({
  enabled: true,
  roleIds: ["member"],
  canManageMembership: true,
  accessVersion: 1,
  schemaVersion: 1,
});
await db.doc("accessControl/admins").set({
  adminUids: [adminUser.uid],
  version: 1,
  lastTargetUid: "",
  schemaVersion: 1,
});
const memberUser = await auth.createUser({
  email: "thanhvien-nav@example.test",
  password: PASSWORD,
});
await db.doc(`users/${memberUser.uid}`).set({
  enabled: true,
  roleIds: ["member"],
  accessVersion: 1,
  schemaVersion: 1,
});
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
async function login(width, email) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.getByLabel("Số điện thoại", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(
    page.getByRole("heading", { name: "Từng hồ sơ, một câu chuyện" }),
  ).toBeVisible({ timeout: 20000 });
  return { ctx, page };
}
const nav = (page) => page.getByRole("navigation");
const link = (page, name) => nav(page).getByRole("link", { name, exact: true });
const flagLink = (page) =>
  page.getByRole("link", { name: "Cần kiểm tra", exact: true });

try {
  stage = "thành viên thường: menu chỉ còn Tổng quan, Cây gia phả";
  {
    const { ctx, page } = await login(1280, "thanhvien-nav@example.test");
    await expect(link(page, "Tổng quan")).toBeVisible();
    await expect(link(page, "Cây gia phả")).toBeVisible();
    for (const gone of [
      "Cần kiểm tra",
      "Tra cứu thành viên",
      "Tiến độ triển khai",
      "Quản lý tài khoản",
    ])
      await expect(link(page, gone)).toHaveCount(0);

    stage = "thành viên: nút ở Tổng quan dẫn tới Danh sách thành viên";
    await expect(
      page.getByRole("link", { name: /Tra cứu thành viên/ }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: "Xem danh sách thành viên →" })
      .click();
    await expect(page).toHaveURL(/#\/tree\/danh-sach/);
    await expect(page.getByLabel("Tìm theo tên")).toBeVisible();

    stage = "thành viên: ô tìm theo tên vẫn có ở Cây gia phả";
    await page.goto(`${URL}/#/tree`);
    await expect(page.getByLabel("Tìm theo tên")).toBeVisible();

    stage = "thành viên: không thấy nhãn/khối Cần kiểm tra ở cây và hồ sơ";
    await page.getByLabel("Tìm theo tên").fill("giả văn lạc");
    await expect(
      page.getByRole("link", { name: /Giả Văn Lạc/ }).first(),
    ).toBeVisible();
    await expect(flagLink(page)).toHaveCount(0);
    await page
      .getByRole("link", { name: /Giả Văn Lạc/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Giả Văn Lạc", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Cần kiểm tra" }),
    ).toHaveCount(0);

    stage = "thành viên: mở thẳng #/review-queue thì về Tổng quan";
    await page.goto(`${URL}/#/review-queue`);
    await expect(
      page.getByRole("heading", { name: "Từng hồ sơ, một câu chuyện" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Cần kiểm tra" }),
    ).toHaveCount(0);

    stage = "trang đã bỏ: #/persons và #/roadmap báo không tìm thấy";
    for (const gone of ["persons", "roadmap"]) {
      await page.goto(`${URL}/#/${gone}`);
      await expect(
        page.getByRole("heading", { name: "Không tìm thấy trang" }),
      ).toBeVisible();
    }
    await ctx.close();
  }

  stage = "quản trị viên: có Cần kiểm tra, nhãn và khối ở hồ sơ";
  {
    const { ctx, page } = await login(1280, "quantri-nav@example.test");
    await expect(link(page, "Cần kiểm tra")).toBeVisible();
    for (const gone of ["Tra cứu thành viên", "Tiến độ triển khai"])
      await expect(link(page, gone)).toHaveCount(0);
    await link(page, "Cần kiểm tra").click();
    await expect(
      page.getByRole("heading", { name: "Cần kiểm tra", level: 1 }),
    ).toBeVisible();
    await page.goto(`${URL}/#/tree`);
    await page.getByLabel("Tìm theo tên").fill("giả văn lạc");
    await expect(flagLink(page).first()).toBeVisible();
    await page
      .getByRole("link", { name: /Giả Văn Lạc/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Cần kiểm tra", level: 2 }),
    ).toBeVisible();
    await ctx.close();
  }

  stage = "màn hẹp 360px: không tràn ngang, menu gọn";
  {
    const { ctx, page } = await login(360, "thanhvien-nav@example.test");
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    if (over > 0) throw Error(`Tràn ngang ${over}px ở 360px`);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(link(page, "Cây gia phả")).toBeVisible();
    await expect(link(page, "Tra cứu thành viên")).toHaveCount(0);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/nav-member-360.png`,
        fullPage: true,
      });
    await ctx.close();
  }
  console.log("Kiểm tra trình duyệt menu và quyền Cần kiểm tra: ĐẠT");
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
