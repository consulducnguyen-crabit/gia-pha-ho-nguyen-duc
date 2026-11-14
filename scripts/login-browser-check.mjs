// Kiểm tra trình duyệt cho trang đăng nhập (ô Số điện thoại + nút Gmail), chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/login-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");

const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
const PORT = 5196;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const PHONE = "0900000001"; // số giả
const PHONE_EMAIL = `${PHONE}@gp.nguyenduc`;
const FAIL_1 = "Vui lòng kiểm tra thông tin vừa nhập.";

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const { getAuth } = requireAdmin("firebase-admin/auth");
const app = initializeApp({ projectId: "demo-gia-pha" });
const db = getFirestore(app);
const auth = getAuth(app);

async function account(email) {
  const u = await auth.createUser({ email, password: PASSWORD });
  await db.doc(`users/${u.uid}`).set({
    enabled: true,
    roleIds: ["member"],
    accessVersion: 1,
    schemaVersion: 1,
  });
}
await account(PHONE_EMAIL);
await account("thanhvien@example.test");

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
async function fresh(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL);
  return { ctx, page };
}
async function signIn(page, label, value, password = PASSWORD) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
}
async function expectFailureNotice(page) {
  const alert = page.getByRole("alert").filter({ hasText: FAIL_1 });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Nếu chưa có tài khoản, xin liên hệ zalo:");
  await expect(alert).toContainText("0914325968");
  await expect(alert).toContainText("(cháu/em Chi II - Đời 7) để đăng ký.");
  await expect(alert.getByRole("link", { name: "0914325968" })).toHaveAttribute(
    "href",
    "https://zalo.me/0914325968",
  );
}
async function noOverflow(page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - globalThis.innerWidth,
  );
  if (over > 0) throw Error(`Tràn ngang ${over}px`);
}
try {
  stage = "một ô Số điện thoại, không còn tab; nút Gmail có biểu tượng";
  {
    const { ctx, page } = await fresh();
    await expect(page.getByRole("tab")).toHaveCount(0);
    const phone = page.getByLabel("Số điện thoại", { exact: true });
    await expect(phone).toBeVisible();
    await expect(phone).toHaveAttribute("placeholder", "Ví dụ: 0912345678");
    const gmail = page.getByRole("button", {
      name: "Đăng nhập bằng Gmail đã đăng ký",
    });
    await expect(gmail).toBeVisible();
    await expect(gmail.locator("svg.gmail-icon")).toBeVisible();
    await expect(page.getByText("Đăng nhập bằng Google")).toHaveCount(0);
    await ctx.close();
  }

  stage = "đăng nhập bằng số điện thoại (dạng viết có khoảng trắng)";
  {
    const { ctx, page } = await fresh();
    await signIn(page, "Số điện thoại", "0900 000 001");
    await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();
    await ctx.close();
  }

  stage = "đăng nhập bằng số điện thoại dạng +84";
  {
    const { ctx, page } = await fresh();
    await signIn(page, "Số điện thoại", "+84 900 000 001");
    await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();
    await ctx.close();
  }

  stage = "tài khoản email sẵn có vẫn vào được bằng cách gõ email vào ô nhập";
  {
    const { ctx, page } = await fresh();
    await signIn(page, "Số điện thoại", "ThanhVien@Example.test");
    await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();
    await ctx.close();
  }

  stage = "sai mật khẩu: cùng một thông báo, có liên kết Zalo";
  {
    const { ctx, page } = await fresh();
    await signIn(page, "Số điện thoại", PHONE, "sai-mat-khau-1");
    await expectFailureNotice(page);
    await ctx.close();
  }

  stage = "số chưa có tài khoản: cùng thông báo (không lộ tồn tại)";
  {
    const { ctx, page } = await fresh();
    await signIn(page, "Số điện thoại", "0900000999");
    await expectFailureNotice(page);
    await ctx.close();
  }

  stage = "số sai định dạng: cùng thông báo, không gọi lên máy chủ";
  {
    const { ctx, page } = await fresh();
    await signIn(page, "Số điện thoại", "12345");
    await expectFailureNotice(page);
    await ctx.close();
  }

  stage = "email sai: cùng thông báo";
  {
    const { ctx, page } = await fresh();
    await signIn(page, "Số điện thoại", "khong-co@example.test");
    await expectFailureNotice(page);
    await ctx.close();
  }

  stage = "không tràn ngang ở 360/768/1280, kể cả khi hiện thông báo lỗi";
  for (const width of [360, 768, 1280]) {
    const { ctx, page } = await fresh(width);
    await noOverflow(page);
    await signIn(page, "Số điện thoại", "0900000999");
    await expectFailureNotice(page);
    await noOverflow(page);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/login-${width}.png`,
        fullPage: true,
      });
    await ctx.close();
  }
  console.log(
    "Kiểm tra trình duyệt đăng nhập (điện thoại, email sẵn có, Gmail): ĐẠT",
  );
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
