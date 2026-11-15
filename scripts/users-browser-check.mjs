// Kiểm tra trình duyệt cho trang quản lý tài khoản (#/users), chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/users-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong. Đặt SHOT_DIR=<thư mục> để lưu ảnh 360/768/1280.
// Luồng: quản trị viên A đổi tên, nâng/hạ quyền, vô hiệu hóa/bật lại thành viên M qua giao diện (firestore.rules thật);
// xác minh users, sổ accessControl/admins và nhật ký bằng Admin SDK; kịch bản sổ thiếu: cảnh báo và nút sửa bị khóa.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { buildGrant } from "./gia-pha/accounts-core.ts";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");

const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
const PORT = 5198;
const URL = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = process.env.SHOT_DIR;
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
    uid: "ub-a",
    email: "quantri.a@example.test",
    name: "Quản Trị A",
    admin: true,
  },
  {
    uid: "ub-b",
    email: "quantri.b@example.test",
    name: "Quản Trị B",
    admin: true,
  },
  { uid: "ub-m", email: "thanhvien.m@example.test", name: "Thành Viên M" },
  {
    uid: "ub-r",
    email: "dahuy.r@example.test",
    name: "Đã Hủy R",
    revoked: true,
  },
];
async function seed() {
  for (const a of accounts) {
    await auth.deleteUser(a.uid).catch(() => {});
    await auth.createUser({
      uid: a.uid,
      email: a.email,
      password: PASSWORD,
      emailVerified: true,
    });
    const doc = buildGrant(
      undefined,
      { email: a.email, name: a.name, admin: a.admin },
      Timestamp.now(),
    );
    await db
      .doc(`users/${a.uid}`)
      .set(a.revoked ? { ...doc, enabled: false } : doc);
  }
  await db.doc("accessControl/admins").set({
    adminUids: ["ub-a", "ub-b"],
    version: 1,
    lastTargetUid: "",
    schemaVersion: 1,
  });
}
// Nhật ký tài khoản chỉ tạo mới (rules không cho ghi đè): xóa nhật ký của các tài khoản giả trước và sau khi chạy.
async function purgeAudits() {
  for (const a of accounts)
    for (const d of (
      await db.collection("auditLogs").where("targetUid", "==", a.uid).get()
    ).docs)
      await d.ref.delete();
}
async function cleanup() {
  for (const a of accounts) {
    await db.doc(`users/${a.uid}`).delete();
    await auth.deleteUser(a.uid).catch(() => {});
  }
  await db.doc("accessControl/admins").delete();
  await purgeAudits();
}
await purgeAudits();
await seed();

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
  await page.goto(`${URL}/#/`);
  await page.getByLabel("Số điện thoại", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
}
const CD = "cd 'C:\\server\\gia-pha-ho-nguyen-duc'; ";
const userDoc = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const ledger = async () => (await db.doc("accessControl/admins").get()).data();
async function audit(uid, version) {
  const id = `account-${uid}-${version}`;
  return (await db.doc(`auditLogs/${id}`).get()).data();
}
const row = (page, name) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });
async function openEdit(page, name) {
  await page
    .getByRole("button", { name: `Sửa tài khoản ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `Sửa tài khoản: ${name}`, level: 2 }),
  ).toBeVisible();
}
async function shot(page, name) {
  if (!SHOT_DIR) return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
}
const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
try {
  stage = "login page offers Google sign-in";
  const anon = await browser.newPage();
  await anon.goto(`${URL}/#/`);
  await expect(
    anon.getByRole("button", { name: "Đăng nhập bằng Gmail đã đăng ký" }),
  ).toBeVisible();
  await anon.close();

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const admin = await ctx.newPage();
  const errors = [];
  admin.on("pageerror", (e) => errors.push(e.message));
  await login(admin, accounts[0].email);
  await admin
    .getByRole("link", { name: "Quản lý tài khoản", exact: true })
    .click();

  stage = "list shows roles, statuses, self row locked";
  await expect(
    admin.getByRole("heading", { name: "Quản lý tài khoản", level: 1 }),
  ).toBeVisible();
  await expect(
    admin.getByRole("cell", { name: "Thành Viên M", exact: true }),
  ).toBeVisible();
  await expect(row(admin, "Thành Viên M")).toContainText("Chỉ xem");
  await expect(row(admin, "Thành Viên M")).toContainText("Đang cấp quyền");
  await expect(row(admin, "Quản Trị B")).toContainText("Quản trị");
  await expect(row(admin, "Đã Hủy R")).toContainText("Đã vô hiệu hóa");
  await expect(
    row(admin, "Quản Trị A").getByRole("button", { name: /^Sửa tài khoản/ }),
  ).toBeDisabled();
  await expect(row(admin, "Quản Trị A")).toContainText(
    "Không tự đổi quyền của chính mình",
  );
  await expect(admin.getByText("registry --rebuild --apply")).toBeVisible();
  await expect(admin.getByText("Sổ quản trị chưa được khởi tạo")).toHaveCount(
    0,
  );
  await shot(admin, "users-1280-list");

  stage = "tài khoản vô hiệu hóa xếp cuối và có màu khác";
  {
    const statuses = await admin
      .locator("table.users-table-accounts tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.children[3].textContent));
    const firstOff = statuses.findIndex((t) => t === "Đã vô hiệu hóa");
    if (
      firstOff < 0 ||
      statuses.slice(firstOff).some((t) => t !== "Đã vô hiệu hóa")
    )
      throw Error("Tài khoản vô hiệu hóa chưa dồn cuối: " + statuses.join("|"));
    const bg = (name) =>
      row(admin, name)
        .locator("td")
        .nth(1)
        .evaluate((td) => globalThis.getComputedStyle(td).backgroundColor);
    if ((await bg("Đã Hủy R")) === (await bg("Thành Viên M")))
      throw Error("Hàng vô hiệu hóa chưa có màu khác");
  }

  stage = "tick tài khoản và lệnh tự điền theo tài khoản đã tick";
  {
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const tools = admin.getByRole("region", {
      name: "Công cụ trên máy quản trị",
    });
    const revoke = admin.getByRole("region", { name: "Thu hồi quyền" });
    await expect(tools.getByText("Chưa tick tài khoản nào")).toBeVisible();
    await expect(revoke.locator("code")).toHaveText([
      `${CD}npm run gia-pha:accounts -- revoke --email ten@gmail.com --apply`,
    ]);
    await admin
      .getByRole("checkbox", { name: "Chọn tài khoản Thành Viên M" })
      .check();
    await expect(tools.getByText("cho 1 tài khoản đã tick")).toBeVisible();
    await expect(revoke.locator("code")).toHaveText([
      `${CD}npm run gia-pha:accounts -- revoke --email thanhvien.m@example.test --apply`,
    ]);
    const all = admin.getByRole("checkbox", {
      name: "Chọn hoặc bỏ chọn tất cả tài khoản",
    });
    if (!(await all.evaluate((el) => el.indeterminate)))
      throw Error("Ô chọn tất cả phải ở trạng thái lưng chừng");
    await all.check();
    await expect(revoke.locator("code")).toHaveCount(4);
    await expect(
      admin.getByRole("region", { name: "Đặt lại mật khẩu" }).locator("code"),
    ).toHaveCount(4);
    // Nhóm không theo từng tài khoản (create/list/registry) giữ nguyên.
    await expect(
      admin
        .getByRole("region", { name: "Xem danh sách đầy đủ" })
        .locator("code"),
    ).toHaveCount(1);
    await expect(
      admin
        .getByRole("checkbox", { name: /^Chọn tài khoản/ })
        .and(admin.locator(":checked")),
    ).toHaveCount(4);
    await all.uncheck();
    await expect(tools.getByText("Chưa tick tài khoản nào")).toBeVisible();

    stage = "cờ production thêm đúng project/confirm/ack";
    await admin
      .getByRole("checkbox", { name: "Chọn tài khoản Đã Hủy R" })
      .check();
    await admin.getByRole("checkbox", { name: /Thêm cờ dữ liệu thật/ }).check();
    const del = admin.getByRole("region", {
      name: "Xóa hẳn: thực hiện (KHÔNG hoàn tác)",
    });
    await expect(del.locator("code")).toHaveText([
      CD +
        'npm run gia-pha:accounts -- delete --email dahuy.r@example.test --apply --confirm-delete dahuy.r@example.test --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod --ack "XOA TAI KHOAN gia-pha-nguyen-duc-prod"',
    ]);
    await expect(revoke.locator("code")).toHaveText([
      CD +
        'npm run gia-pha:accounts -- revoke --email dahuy.r@example.test --apply --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod --ack "QUAN LY TAI KHOAN gia-pha-nguyen-duc-prod"',
    ]);

    stage = "thư mục dự án: dòng chuẩn bị có biến khóa Admin; xóa ô thì bỏ cd";
    const setup = admin.getByRole("region", {
      name: "Chuẩn bị (mỗi cửa sổ PowerShell mới)",
    });
    await expect(setup.locator("code")).toContainText(
      "$env:GOOGLE_APPLICATION_CREDENTIALS",
    );
    const dirBox = admin.getByLabel(/Thư mục dự án trên máy quản trị/);
    await dirBox.fill("");
    if ((await revoke.locator("code").innerText()).startsWith("cd "))
      throw Error("Xóa ô thư mục mà lệnh vẫn có cd");
    await dirBox.fill("D:\\Dự án 'x'");
    await expect(revoke.locator("code")).toContainText(
      "cd 'D:\\Dự án ''x'''; npm run gia-pha:accounts -- revoke",
    );
    await dirBox.fill("C:\\server\\gia-pha-ho-nguyen-duc");

    stage =
      "ô File khóa Admin: mỗi lệnh tự đặt biến khóa, nhóm chuẩn bị biến mất";
    const keyBox = admin.getByLabel(/File khóa Admin/);
    await keyBox.fill("K:\\khoa\\prod.json");
    await expect(revoke.locator("code")).toHaveText(
      CD +
        "$env:GOOGLE_APPLICATION_CREDENTIALS = 'K:\\khoa\\prod.json'; " +
        'npm run gia-pha:accounts -- revoke --email dahuy.r@example.test --apply --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod --ack "QUAN LY TAI KHOAN gia-pha-nguyen-duc-prod"',
    );
    await expect(
      admin.getByRole("region", {
        name: "Chuẩn bị (mỗi cửa sổ PowerShell mới)",
      }),
    ).toHaveCount(0);
    await keyBox.fill("");

    stage = "nút sao chép chép đúng dòng lệnh vào clipboard";
    await revoke.getByRole("button", { name: /^Sao chép lệnh/ }).click();
    await expect(revoke.getByText("Đã sao chép")).toBeVisible();
    const clip = await admin.evaluate(() =>
      globalThis.navigator.clipboard.readText(),
    );
    if (clip !== (await revoke.locator("code").innerText()))
      throw Error("Clipboard khác dòng lệnh: " + clip);
    await admin
      .getByRole("checkbox", { name: /Thêm cờ dữ liệu thật/ })
      .uncheck();
    await admin
      .getByRole("checkbox", { name: "Chọn tài khoản Đã Hủy R" })
      .uncheck();
    await shot(admin, "users-1280-tools");
  }

  stage = "rename member";
  await openEdit(admin, "Thành Viên M");
  await admin.getByLabel("Tên hiển thị").fill("Thành Viên M Đã Sửa");
  await admin.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Đã lưu thay đổi" }),
  ).toBeVisible();
  await expect(
    admin.getByRole("cell", { name: "Thành Viên M Đã Sửa", exact: true }),
  ).toBeVisible();
  let m = await userDoc("ub-m");
  if (
    m.displayName !== "Thành Viên M Đã Sửa" ||
    m.accessVersion !== 2 ||
    m.updatedBy !== "ub-a"
  )
    throw Error("users sau đổi tên sai");
  let a = await audit("ub-m", 2);
  if (a.event !== "ACCOUNT_UPDATED" || a.fields.join() !== "displayName")
    throw Error("Nhật ký đổi tên sai");
  if (JSON.stringify(a).includes("Đã Sửa") || JSON.stringify(a).includes("@"))
    throw Error("Nhật ký không được chứa tên/email");

  stage = "HTML-like name is shown literally, then restored";
  const HTML_NAME = '<b>x</b> & "q"';
  await openEdit(admin, "Thành Viên M Đã Sửa");
  await admin.getByLabel("Tên hiển thị").fill(HTML_NAME);
  await admin.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    admin.getByRole("cell", { name: HTML_NAME, exact: true }),
  ).toBeVisible();
  if ((await admin.locator(".users-table b").count()) !== 0)
    throw Error("Tên chứa HTML bị biên dịch thành thẻ");
  if ((await userDoc("ub-m")).displayName !== HTML_NAME)
    throw Error("Tên chứa HTML không được lưu nguyên văn");
  await openEdit(admin, HTML_NAME);
  await admin.getByLabel("Tên hiển thị").fill("Thành Viên M Đã Sửa");
  await admin.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    admin.getByRole("cell", { name: "Thành Viên M Đã Sửa", exact: true }),
  ).toBeVisible();

  stage = "invalid name shows an error near the field and writes nothing";
  await openEdit(admin, "Thành Viên M Đã Sửa");
  await admin.getByLabel("Tên hiển thị").fill("   ");
  await admin.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    admin.getByRole("alert").filter({ hasText: "Tên hiển thị phải dài 1–120" }),
  ).toBeVisible();
  if ((await userDoc("ub-m")).displayName !== "Thành Viên M Đã Sửa")
    throw Error("Tên sai không được ghi");
  await admin.getByRole("button", { name: "Hủy", exact: true }).click();

  stage = "promote then demote";
  await openEdit(admin, "Thành Viên M Đã Sửa");
  await admin.getByLabel("Quản trị", { exact: true }).check();
  await shot(admin, "users-1280-panel");
  await admin.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Đã lưu thay đổi" }),
  ).toBeVisible();
  await expect(row(admin, "Thành Viên M Đã Sửa")).toContainText("Quản trị");
  if (
    !(await ledger()).adminUids.includes("ub-m") ||
    (await ledger()).version !== 2
  )
    throw Error("Sổ chưa có M sau khi nâng");
  if ((await userDoc("ub-m")).canManageMembership !== true)
    throw Error("M chưa là quản trị");
  await openEdit(admin, "Thành Viên M Đã Sửa");
  await admin.getByLabel("Chỉ xem", { exact: true }).check();
  await admin.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(row(admin, "Thành Viên M Đã Sửa")).toContainText("Chỉ xem");
  if (
    (await ledger()).adminUids.includes("ub-m") ||
    (await ledger()).version !== 3
  )
    throw Error("Sổ chưa bỏ M sau khi hạ");
  a = await audit("ub-m", 6);
  if (
    a.fields.join() !== "admin" ||
    a.before.admin !== true ||
    a.after.admin !== false
  )
    throw Error("Nhật ký hạ quyền sai");

  stage = "disable asks for confirmation, then re-enable";
  await openEdit(admin, "Thành Viên M Đã Sửa");
  await admin.getByRole("button", { name: "Vô hiệu hóa", exact: true }).click();
  await expect(admin.getByText("mất quyền truy cập ngay")).toBeVisible();
  await expect(
    admin.getByText("gia-pha:accounts", { exact: false }).first(),
  ).toBeVisible();
  if ((await userDoc("ub-m")).enabled !== true)
    throw Error("Chưa xác nhận mà đã vô hiệu hóa");
  await admin.getByRole("button", { name: "Không vô hiệu hóa" }).click();
  await admin.getByRole("button", { name: "Vô hiệu hóa", exact: true }).click();
  await admin.getByRole("button", { name: "Xác nhận vô hiệu hóa" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Đã vô hiệu hóa" }),
  ).toBeVisible();
  await expect(row(admin, "Thành Viên M Đã Sửa")).toContainText(
    "Đã vô hiệu hóa",
  );
  m = await userDoc("ub-m");
  if (m.enabled !== false || m.disabledBy !== "ub-a")
    throw Error("users sau vô hiệu hóa sai");
  await openEdit(admin, "Thành Viên M Đã Sửa");
  await admin.getByRole("button", { name: "Bật lại", exact: true }).click();
  await expect(row(admin, "Thành Viên M Đã Sửa")).toContainText(
    "Đang cấp quyền",
  );
  m = await userDoc("ub-m");
  if (
    m.enabled !== true ||
    m.approvedBy !== "ub-a" ||
    m.canManageMembership !== false
  )
    throw Error("users sau bật lại sai");

  stage = "layout and touch targets at 360/768/1280 with panel open";
  await openEdit(admin, "Thành Viên M Đã Sửa");
  for (const width of [360, 768, 1280]) {
    await admin.setViewportSize({ width, height: 900 });
    if (!(await noOverflow(admin))) throw Error(`Tràn ngang ở ${width}px`);
    for (const name of ["Lưu thay đổi", "Hủy", "Vô hiệu hóa"]) {
      const box = await admin
        .getByRole("button", { name, exact: true })
        .boundingBox();
      if (!box || box.height < 44 - 0.5)
        throw Error(`Nút "${name}" cao ${box?.height}px (<44) ở ${width}px`);
    }
    await shot(admin, `users-${width}-panel`);
  }
  await admin.setViewportSize({ width: 1280, height: 900 });
  await admin.getByRole("button", { name: "Hủy", exact: true }).click();
  stage = "cancel returns focus to the row's edit button";
  await expect(
    admin.getByRole("button", {
      name: "Sửa tài khoản Thành Viên M Đã Sửa",
      exact: true,
    }),
  ).toBeFocused();

  stage = "ordinary member cannot see or open the page";
  const memberCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const member = await memberCtx.newPage();
  await login(member, accounts[2].email);
  await expect(
    member.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible();
  await expect(
    member.getByRole("link", { name: "Quản lý tài khoản", exact: true }),
  ).toHaveCount(0);
  await member.goto(`${URL}/#/users`);
  await expect(member.getByText("Không tìm thấy trang")).toBeVisible();

  stage = "disabled account is blocked";
  const revokedCtx = await browser.newContext();
  const revoked = await revokedCtx.newPage();
  await login(revoked, accounts[3].email);
  await expect(
    revoked.getByRole("heading", { name: "Chờ cấp quyền" }),
  ).toBeVisible();

  stage = "missing ledger: warning shown and edit buttons locked";
  await db.doc("accessControl/admins").delete();
  await admin.reload();
  await expect(
    admin.getByRole("heading", { name: "Quản lý tài khoản", level: 1 }),
  ).toBeVisible();
  await expect(
    admin.getByRole("alert").filter({
      hasText:
        "Sổ quản trị chưa được khởi tạo hoặc đang lệch; chạy gia-pha:accounts registry --rebuild",
    }),
  ).toBeVisible();
  for (const b of await admin
    .getByRole("button", { name: /^Sửa tài khoản/ })
    .all())
    await expect(b).toBeDisabled();
  await shot(admin, "users-1280-no-ledger");
  await admin.setViewportSize({ width: 360, height: 800 });
  if (!(await noOverflow(admin)))
    throw Error("Tràn ngang ở 360px khi thiếu sổ");
  await shot(admin, "users-360-no-ledger");

  if (errors.length) throw Error("Lỗi trang: " + errors.join("; "));
  console.log("Kiểm tra trình duyệt trang quản lý tài khoản: ĐẠT");
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
