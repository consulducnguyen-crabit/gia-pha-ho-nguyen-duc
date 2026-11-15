// Kiểm tra trình duyệt: quản trị viên tạo tài khoản (điện thoại/email) trong #/users, thành viên đăng nhập bằng mật khẩu tạm,
// buộc đổi mật khẩu lần đầu. Chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/create-account-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong. Đặt SHOT_DIR=<thư mục> để chụp ảnh.
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
const PORT = 5195;
const URL = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "Demo-only-2026!";
const NEW_PASSWORD = "mat-khau-rieng-2026";
const PHONE = "0900000002";
const PHONE_EMAIL = `${PHONE}@gp.nguyenduc`;
const SQUATTED = "0900000003";

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const { getAuth } = requireAdmin("firebase-admin/auth");
const app = initializeApp({ projectId: "demo-gia-pha" });
const db = getFirestore(app);
const auth = getAuth(app);

const admin = await auth.createUser({
  email: "quantri-tao@example.test",
  password: ADMIN_PASSWORD,
});
await db.doc(`users/${admin.uid}`).set({
  enabled: true,
  roleIds: ["member"],
  canManageMembership: true,
  accessVersion: 1,
  schemaVersion: 1,
});
await db.doc("accessControl/admins").set({
  adminUids: [admin.uid],
  version: 1,
  lastTargetUid: "",
  schemaVersion: 1,
});
// Số đã bị người lạ đăng ký trước (Auth có, users không có).
await auth.createUser({
  email: `${SQUATTED}@gp.nguyenduc`,
  password: "nguoi-la-chiem-truoc",
});

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
async function newPage(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL);
  return { ctx, page };
}
async function login(page, label, id, password) {
  await page.getByLabel(label, { exact: true }).fill(id);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
}
async function createAccount(page, kind, value, name = "") {
  const section = page.getByRole("region", { name: "Tạo tài khoản" });
  const label = kind === "phone" ? "Số điện thoại" : "Email";
  await section.getByRole("textbox", { name: label, exact: true }).fill(value);
  if (name) await section.getByLabel(/Họ và tên thành viên/).fill(name);
  await section.getByRole("button", { name: /Tạo tài khoản|Thử lại/ }).click();
  return section;
}
let tempPassword = "";
try {
  const { ctx: adminCtx, page: ap } = await newPage();
  await login(ap, "Số điện thoại", "quantri-tao@example.test", ADMIN_PASSWORD);
  await ap.goto(`${URL}/#/users`);

  stage = "quản trị viên tạo tài khoản theo số điện thoại";
  let section = await createAccount(ap, "phone", "0900 000 002", "Giả Văn Mới");
  const status = section.getByRole("status");
  await expect(status).toContainText("Đã tạo tài khoản");
  await expect(status).toContainText(PHONE);
  tempPassword = (await status.locator("code").innerText()).trim();
  if (!/^[A-HJ-NP-Za-km-np-z2-9]{10}$/.test(tempPassword))
    throw Error("Mật khẩu tạm sai định dạng: " + tempPassword.length);
  // Quản trị viên vẫn đăng nhập (app phụ không đăng xuất họ) và danh sách hiện số điện thoại, không hiện email ngầm.
  await expect(
    ap.getByRole("link", { name: "Quản lý tài khoản" }),
  ).toBeVisible();
  await expect(
    ap.getByRole("cell", { name: PHONE, exact: true }),
  ).toBeVisible();
  // Bảng tài khoản và thanh đầu trang không được lộ email ngầm (đoạn hướng dẫn script có ví dụ chủ ý nên không tính).
  const visible = (await ap.locator("table, header").allInnerTexts()).join(" ");
  if (visible.includes("@gp.nguyenduc"))
    throw Error("Giao diện lộ email ngầm @gp.nguyenduc");
  if (process.env.SHOT_DIR)
    await ap.screenshot({
      path: `${process.env.SHOT_DIR}/create-account-1280.png`,
      fullPage: true,
    });

  stage = "hồ sơ và nhật ký đúng, không lưu mật khẩu";
  const created = await auth.getUserByEmail(PHONE_EMAIL);
  const u = (await db.doc(`users/${created.uid}`).get()).data();
  if (
    !u ||
    u.enabled !== true ||
    u.canManageMembership === true ||
    u.mustChangePassword !== true ||
    u.createdVia !== "phone" ||
    u.displayName !== "Giả Văn Mới"
  )
    throw Error("users sai: " + JSON.stringify(u));
  if (JSON.stringify(u).includes(tempPassword))
    throw Error("Mật khẩu bị lưu trong users");
  const audit = (
    await db.doc(`auditLogs/account-${created.uid}-1`).get()
  ).data();
  if (audit?.event !== "ACCOUNT_CREATED" || audit.actorUid !== admin.uid)
    throw Error("Nhật ký sai: " + JSON.stringify(audit));
  if (JSON.stringify(audit).includes(PHONE))
    throw Error("Nhật ký chứa số điện thoại");

  stage = "tạo trùng số bị chặn ngay ở giao diện";
  section = await createAccount(ap, "phone", PHONE);
  await expect(section.getByRole("alert")).toContainText("Đã có tài khoản");

  stage = "số đã bị đăng ký trước: báo rõ, không tạo hồ sơ";
  section = await createAccount(ap, "phone", SQUATTED);
  await expect(section.getByRole("alert")).toContainText(
    "đã có tài khoản đăng nhập không do lần tạo này sinh ra",
  );
  const squat = await auth.getUserByEmail(`${SQUATTED}@gp.nguyenduc`);
  if ((await db.doc(`users/${squat.uid}`).get()).exists)
    throw Error("Đã tạo hồ sơ cho tài khoản bị chiếm trước");

  stage = "số sai định dạng: báo lỗi, không gọi Auth";
  section = await createAccount(ap, "phone", "12345");
  await expect(section.getByRole("alert")).toContainText(
    "Số điện thoại không hợp lệ",
  );

  stage = "số 12 chữ số vẫn báo lỗi (chỉ nhận 10 hoặc 11 chữ số)";
  section = await createAccount(ap, "phone", "090000000123");
  await expect(section.getByRole("alert")).toContainText("10 hoặc 11 chữ số");

  stage = "số 11 chữ số hợp lệ: tạo được và đăng nhập được (buộc đổi mật khẩu)";
  const PHONE11 = "01691234567";
  section = await createAccount(
    ap,
    "phone",
    "0169 123 4567",
    "Giả Văn Mười Một",
  );
  const status11 = section.getByRole("status");
  await expect(status11).toContainText("Đã tạo tài khoản");
  await expect(status11).toContainText(PHONE11);
  const temp11 = (await status11.locator("code").innerText()).trim();
  const user11 = await auth.getUserByEmail(`${PHONE11}@gp.nguyenduc`);
  const doc11 = (await db.doc(`users/${user11.uid}`).get()).data();
  if (!doc11 || doc11.createdVia !== "phone" || doc11.enabled !== true)
    throw Error("Hồ sơ tài khoản 11 chữ số sai");
  await expect(
    ap.getByRole("cell", { name: PHONE11, exact: true }),
  ).toBeVisible();
  const { ctx: c11, page: p11 } = await newPage(360);
  await login(p11, "Số điện thoại", PHONE11, temp11);
  await expect(
    p11.getByRole("heading", { name: "Đổi mật khẩu" }),
  ).toBeVisible();
  await c11.close();

  stage = "tạo tài khoản bằng email thật";
  await ap.getByRole("radio", { name: "Email" }).check();
  section = await createAccount(ap, "email", "Co.Email@Example.test");
  await expect(section.getByRole("status")).toContainText(
    "co.email@example.test",
  );
  await expect(
    ap
      .getByRole("cell", { name: "co.email@example.test", exact: true })
      .first(),
  ).toBeVisible();
  const emailPassword = (
    await section.getByRole("status").locator("code").innerText()
  ).trim();

  stage =
    "Chỉ Gmail: ghi sẵn quyền (không mật khẩu), sai định dạng và trùng bị chặn";
  const GM = "thanh.vien@gmail.com";
  await ap.getByRole("radio", { name: "Chỉ Gmail (không mật khẩu)" }).check();
  section = ap.getByRole("region", { name: "Tạo tài khoản" });
  await section
    .getByRole("textbox", { name: "Gmail", exact: true })
    .fill("a@example.com");
  await section
    .getByRole("button", { name: "Ghi sẵn quyền cho Gmail" })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "Chỉ nhận địa chỉ Gmail",
  );
  await section
    .getByRole("textbox", { name: "Gmail", exact: true })
    .fill("Thanh.Vien@Gmail.com");
  await section.getByLabel(/Họ và tên thành viên/).fill("Giả Gmail");
  await section
    .getByRole("button", { name: "Ghi sẵn quyền cho Gmail" })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "Đã ghi sẵn quyền Chỉ xem cho " + GM,
  );
  await expect(section.getByRole("status").locator("code")).toHaveCount(0);
  await expect(
    ap.getByRole("heading", { name: /Gmail đã ghi sẵn quyền/ }),
  ).toBeVisible();
  await section.getByRole("textbox", { name: "Gmail", exact: true }).fill(GM);
  await section
    .getByRole("button", { name: "Ghi sẵn quyền cho Gmail" })
    .click();
  await expect(section.getByRole("alert")).toContainText("Đã có tài khoản");
  {
    const g = (await db.doc(`emailGrants/${GM}`).get()).data();
    if (!g || g.createdBy !== admin.uid || g.displayName !== "Giả Gmail")
      throw Error("Grant sai: " + JSON.stringify(g));
    if ((await auth.listUsers()).users.some((u) => u.email === GM))
      throw Error("Không được tạo người dùng Auth cho Gmail-only");
  }

  stage = "Thu hồi grant có bước xác nhận";
  await section
    .getByRole("textbox", { name: "Gmail", exact: true })
    .fill("nham@gmail.com");
  await section
    .getByRole("button", { name: "Ghi sẵn quyền cho Gmail" })
    .click();
  await expect(section.getByRole("status")).toContainText("nham@gmail.com");
  await ap
    .getByRole("button", { name: "Thu hồi quyền ghi sẵn cho nham@gmail.com" })
    .click();
  await ap.getByRole("button", { name: "Không thu hồi" }).click();
  if (!(await db.doc("emailGrants/nham@gmail.com").get()).exists)
    throw Error("Grant bị xóa dù chưa xác nhận");
  await ap
    .getByRole("button", { name: "Thu hồi quyền ghi sẵn cho nham@gmail.com" })
    .click();
  await ap.getByRole("button", { name: "Xác nhận thu hồi" }).click();
  await expect(
    ap.getByText("Đã thu hồi quyền ghi sẵn cho nham@gmail.com"),
  ).toBeVisible();
  if ((await db.doc("emailGrants/nham@gmail.com").get()).exists)
    throw Error("Grant chưa bị thu hồi");

  stage =
    "Gmail lạ (chưa được ghi sẵn) đăng nhập Google: chờ cấp quyền, không có hồ sơ";
  const googlePopup = async (page, email) => {
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page
        .getByRole("button", { name: "Đăng nhập bằng Gmail đã đăng ký" })
        .click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    await popup.getByText("Add new account", { exact: false }).click();
    await popup.locator("#email-input").fill(email);
    await popup
      .locator("#autogen-button")
      .click()
      .catch(() => undefined);
    await popup.locator("#email-input").fill(email);
    await popup.locator("#sign-in").click();
  };
  {
    const { ctx, page } = await newPage(360);
    await googlePopup(page, "la.mat@gmail.com");
    await expect(
      page.getByRole("heading", { name: "Chờ cấp quyền" }),
    ).toBeVisible({
      timeout: 20000,
    });
    const strange = await auth.getUserByEmail("la.mat@gmail.com");
    if ((await db.doc(`users/${strange.uid}`).get()).exists)
      throw Error("Gmail lạ không được tự có hồ sơ");
    if (!(await db.doc(`emailGrants/${GM}`).get()).exists)
      throw Error("Grant của người khác bị mất");
    await ctx.close();
  }

  stage =
    "Gmail đã ghi sẵn đăng nhập Google lần đầu: vào thẳng, không đổi mật khẩu; grant dùng một lần";
  {
    const { ctx, page } = await newPage(360);
    await googlePopup(page, GM);
    await expect(
      page.getByRole("heading", { name: "Từng hồ sơ, một câu chuyện" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole("heading", { name: "Đổi mật khẩu" }),
    ).toHaveCount(0);
    const gu = await auth.getUserByEmail(GM);
    // Giao diện hiện ngay theo ghi cục bộ; chờ máy chủ xác nhận rồi mới đọc.
    let gd;
    for (let i = 0; i < 40 && !gd; i++) {
      gd = (await db.doc(`users/${gu.uid}`).get()).data();
      if (!gd) await sleep(250);
    }
    if (
      !gd ||
      gd.enabled !== true ||
      gd.canManageMembership === true ||
      gd.createdVia !== "google" ||
      gd.approvedBy !== admin.uid ||
      gd.displayName !== "Giả Gmail" ||
      "mustChangePassword" in gd
    )
      throw Error("users của Gmail sai: " + JSON.stringify(gd));
    if ((await db.doc(`emailGrants/${GM}`).get()).exists)
      throw Error("Grant chưa bị xóa sau khi nhận");
    const ga = (await db.doc(`auditLogs/account-${gu.uid}-1`).get()).data();
    if (ga?.event !== "ACCOUNT_CLAIMED" || ga.actorUid !== gu.uid)
      throw Error("Nhật ký nhận quyền sai: " + JSON.stringify(ga));
    if (JSON.stringify(ga).includes("gmail")) throw Error("Nhật ký chứa email");
    await ctx.close();
  }

  stage =
    "đăng xuất khỏi #/users rồi thành viên mới đăng nhập trên cùng trình duyệt: về Tổng quan, không bị 404";
  await expect(ap).toHaveURL(/#\/users/);
  await ap.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(
    ap.getByRole("heading", { name: "Chào mừng trở về" }),
  ).toBeVisible();
  await login(ap, "Số điện thoại", "co.email@example.test", emailPassword);
  await expect(ap.getByRole("heading", { name: "Đổi mật khẩu" })).toBeVisible();
  await ap.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await ap.getByLabel("Nhập lại mật khẩu mới").fill(NEW_PASSWORD);
  await ap.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
  await expect(
    ap.getByRole("heading", { name: "Từng hồ sơ, một câu chuyện" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    ap.getByRole("heading", { name: "Không tìm thấy trang" }),
  ).toHaveCount(0);
  await adminCtx.close();

  stage = "thành viên đăng nhập bằng số + mật khẩu tạm → buộc đổi mật khẩu";
  const { ctx: mCtx, page: mp } = await newPage(360);
  await login(mp, "Số điện thoại", "0900000002", tempPassword);
  await expect(mp.getByRole("heading", { name: "Đổi mật khẩu" })).toBeVisible();
  // Chưa đổi thì không vào được ứng dụng.
  await expect(mp.getByRole("link", { name: "Cây gia phả" })).toHaveCount(0);
  if (process.env.SHOT_DIR)
    await mp.screenshot({
      path: `${process.env.SHOT_DIR}/change-password-360.png`,
      fullPage: true,
    });

  stage = "đổi mật khẩu: kiểm tra đầu vào";
  await mp.getByLabel("Mật khẩu mới", { exact: true }).fill("ngan");
  await mp.getByLabel("Nhập lại mật khẩu mới").fill("ngan");
  await mp.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
  await expect(mp.getByRole("alert")).toContainText("ít nhất 8 ký tự");
  await mp.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await mp.getByLabel("Nhập lại mật khẩu mới").fill(NEW_PASSWORD + "x");
  await mp.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
  await expect(mp.getByRole("alert")).toContainText("chưa khớp");
  await mp.getByLabel("Mật khẩu mới", { exact: true }).fill(PHONE);
  await mp.getByLabel("Nhập lại mật khẩu mới").fill(PHONE);
  await mp.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
  await expect(mp.getByRole("alert")).toContainText("Không dùng số điện thoại");

  stage = "đổi mật khẩu thành công → vào ứng dụng, cờ được hạ";
  await mp.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await mp.getByLabel("Nhập lại mật khẩu mới").fill(NEW_PASSWORD);
  await mp.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
  await expect(
    mp.getByRole("heading", { name: "Từng hồ sơ, một câu chuyện" }),
  ).toBeVisible({ timeout: 20000 });
  await mp.getByRole("button", { name: "Menu" }).click(); // 360px: menu thu gọn
  await expect(mp.getByRole("link", { name: "Cây gia phả" })).toBeVisible({
    timeout: 20000,
  });
  await expect(mp.getByText(PHONE, { exact: false }).first()).toBeVisible();
  if ((await mp.content()).includes("@gp.nguyenduc"))
    throw Error("Giao diện lộ email ngầm sau đăng nhập");
  let after;
  for (let i = 0; i < 40; i++) {
    after = (await db.doc(`users/${created.uid}`).get()).data();
    if (after?.mustChangePassword === false) break;
    await sleep(250);
  }
  if (after?.mustChangePassword !== false || !after.passwordChangedAt)
    throw Error("Cờ mustChangePassword chưa hạ: " + JSON.stringify(after));
  // Sau khi máy chủ xác nhận, tải lại trang vẫn không bị buộc đổi mật khẩu nữa.
  await mp.reload();
  await expect(mp.getByRole("heading", { name: "Đổi mật khẩu" })).toHaveCount(
    0,
  );
  await mCtx.close();

  stage = "mật khẩu mới dùng được, mật khẩu tạm hết hiệu lực";
  {
    const { ctx, page } = await newPage();
    await login(page, "Số điện thoại", PHONE, tempPassword);
    await expect(page.getByRole("alert")).toContainText(
      "Vui lòng kiểm tra thông tin vừa nhập.",
    );
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage();
    await login(page, "Số điện thoại", PHONE, NEW_PASSWORD);
    await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByRole("heading", { name: "Đổi mật khẩu" }),
    ).toHaveCount(0);
    await ctx.close();
  }
  console.log(
    "Kiểm tra trình duyệt tạo tài khoản và đổi mật khẩu lần đầu: ĐẠT",
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
