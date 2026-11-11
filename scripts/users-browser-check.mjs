// Kiểm tra trình duyệt cho trang quản lý tài khoản và nút đăng nhập Google, chỉ dùng DỮ LIỆU GIẢ trên emulator.
// Cần: emulator (auth+firestore) và Vite với VITE_USE_EMULATORS=true đang chạy.
// Chạy: CHROMIUM_PATH=... node scripts/users-browser-check.mjs
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { buildGrant } from "./gia-pha/accounts-core.ts";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getAuth } = requireAdmin("firebase-admin/auth");
const { getFirestore, Timestamp } = requireAdmin("firebase-admin/firestore");
const app = initializeApp({ projectId: "demo-gia-pha" });
const auth = getAuth(app);
const db = getFirestore(app);
const PASSWORD = "Demo-only-2026!";
const accounts = [
  {
    uid: "check-admin",
    email: "quantri.kiemtra@example.test",
    name: "Quản Trị Kiểm Tra",
    admin: true,
  },
  {
    uid: "check-member",
    email: "thanhvien.kiemtra@example.test",
    name: "Thành Viên Kiểm Tra",
  },
  {
    uid: "check-revoked",
    email: "thuhoi.kiemtra@example.test",
    name: "Đã Thu Hồi Kiểm Tra",
    revoked: true,
  },
];
async function seed() {
  for (const a of accounts) {
    try {
      await auth.createUser({
        uid: a.uid,
        email: a.email,
        password: PASSWORD,
        emailVerified: true,
      });
    } catch (error) {
      if (error.code !== "auth/uid-already-exists") throw error;
    }
    const doc = buildGrant(
      undefined,
      { email: a.email, name: a.name, admin: a.admin },
      Timestamp.now(),
    );
    await db
      .doc(`users/${a.uid}`)
      .set(a.revoked ? { ...doc, enabled: false } : doc);
  }
}
async function cleanup() {
  for (const a of accounts) {
    await db.doc(`users/${a.uid}`).delete();
    await auth.deleteUser(a.uid).catch(() => {});
  }
}
await seed();

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
let failed = false;
let stage = "start";
async function login(page, email) {
  await page.goto("http://127.0.0.1:5173/#/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
}
try {
  stage = "login page offers Google sign-in";
  const anon = await browser.newPage();
  await anon.goto("http://127.0.0.1:5173/#/");
  await expect(
    anon.getByRole("button", { name: "Đăng nhập bằng Google" }),
  ).toBeVisible();
  await expect(
    anon.getByText("hoặc dùng tài khoản Gmail đã được cấp quyền"),
  ).toBeVisible();
  await anon.close();

  stage = "manager sees accounts page";
  const admin = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  admin.on("pageerror", (e) => errors.push(e.message));
  await login(admin, accounts[0].email);
  await admin
    .getByRole("link", { name: "Quản lý tài khoản", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Quản lý tài khoản", level: 1 }),
  ).toBeVisible();
  await expect(
    admin.getByRole("cell", { name: "Quản Trị Kiểm Tra" }),
  ).toBeVisible();
  await expect(
    admin.getByRole("cell", { name: "Thành Viên Kiểm Tra" }),
  ).toBeVisible();
  await expect(
    admin.getByRole("cell", { name: "Đã thu hồi", exact: true }),
  ).toBeVisible();
  await expect(
    admin.getByRole("cell", { name: "Quản trị", exact: true }),
  ).toBeVisible();
  await expect(
    admin
      .getByText("npm run gia-pha:accounts -- grant", { exact: false })
      .first(),
  ).toBeVisible();

  stage = "accounts page layout on small screens";
  for (const width of [360, 768]) {
    await admin.setViewportSize({ width, height: 800 });
    await expect(
      admin.getByRole("heading", { name: "Quản lý tài khoản", level: 1 }),
    ).toBeVisible();
    if (
      await admin.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Tràn ngang");
  }

  stage = "ordinary member cannot see or open the page";
  const member = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await login(member, accounts[1].email);
  await expect(
    member.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible();
  await expect(
    member.getByRole("link", { name: "Quản lý tài khoản", exact: true }),
  ).toHaveCount(0);
  await member.goto("http://127.0.0.1:5173/#/users");
  await expect(member.getByText("Không tìm thấy trang")).toBeVisible();

  stage = "revoked account is blocked";
  const revoked = await browser.newPage();
  await login(revoked, accounts[2].email);
  await expect(
    revoked.getByRole("heading", { name: "Chờ cấp quyền" }),
  ).toBeVisible();
  if (errors.length) throw Error("Có lỗi trang");
} catch {
  failed = true;
} finally {
  await cleanup();
  await browser.close();
}
if (failed) throw Error(`Kiểm tra tài khoản thất bại ở bước: ${stage}`);
console.log(
  "Browser: Google button, accounts page for manager only, 360/768 layout, member and revoked account blocked passed.",
);
process.exit(0);
