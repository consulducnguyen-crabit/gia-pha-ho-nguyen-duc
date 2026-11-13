// Kiểm tra trình duyệt cho lời mời thành viên + đăng nhập bằng liên kết email, chỉ DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/invites-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true). Đặt SHOT_DIR=<thư mục> để lưu ảnh 360/768/1280 của khu mời.
// Luồng: quản trị viên A tạo lời mời (UI), người được mời đăng nhập bằng liên kết email lấy từ Auth emulator
// (/emulator/v1/projects/demo-gia-pha/oobCodes), nhận lời mời và vào hệ thống với quyền Chỉ xem;
// lời mời bị thu hồi, hết hạn hoặc email lạ bị chặn.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
const PORT = 5197;
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
const ADMIN = {
  uid: "ib-a",
  email: "quantri.moi@example.test",
  name: "Quản Trị Mời",
};
const EMAILS = {
  accept: "khach.mot@example.test", // quản trị gửi liên kết, mở trên thiết bị khác
  sameDevice: "khach.hai@example.test", // tự gửi liên kết, mở trên cùng thiết bị
  revoked: "khach.thuhoi@example.test",
  expired: "khach.hethan@example.test",
  stranger: "nguoi.la@example.test",
  hijack: "khach.chiem@example.test", // kẻ khác đã đăng ký trước bằng mật khẩu (pre-hijacking)
  resend: "khach.guilai@example.test", // lời mời có sẵn, chỉ gửi lại thư từ bảng
  wrong: "khach.saiurl@example.test", // mở liên kết với ?invitee= sai
  conflict: "khach.xungdot@example.test", // mở liên kết khi đang đăng nhập tài khoản khác
};
const sha = (k) => createHash("sha256").update(k).digest("hex");
async function purge() {
  await db.doc(`users/${ADMIN.uid}`).delete();
  await auth.deleteUser(ADMIN.uid).catch(() => {});
  await db.doc("accessControl/admins").delete();
  for (const email of Object.values(EMAILS)) {
    const u = await auth.getUserByEmail(email).catch(() => null);
    if (u) {
      await db.doc(`users/${u.uid}`).delete();
      await db.doc(`auditLogs/account-${u.uid}-1`).delete();
      await auth.deleteUser(u.uid).catch(() => {});
    }
    const inv = await db.doc(`accountInvites/${email}`).get();
    if (inv.exists) {
      const n = inv.data().nonce;
      await db.doc(`auditLogs/invite-${n}`).delete();
      for (const id of [ADMIN.uid])
        await db.doc(`auditLogs/invite-${n}-revoked-${id}`).delete();
      await inv.ref.delete();
    }
  }
}
await purge();
await auth.createUser({
  uid: ADMIN.uid,
  email: ADMIN.email,
  password: PASSWORD,
  emailVerified: true,
});
await db
  .doc(`users/${ADMIN.uid}`)
  .set(
    buildGrant(
      undefined,
      { email: ADMIN.email, name: ADMIN.name, admin: true },
      Timestamp.now(),
    ),
  );
await db.doc("accessControl/admins").set({
  adminUids: [ADMIN.uid],
  version: 1,
  lastTargetUid: "",
  schemaVersion: 1,
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
const invite = async (email) =>
  (await db.doc(`accountInvites/${email}`).get()).data();
const userByEmail = async (email) => {
  const u = await auth.getUserByEmail(email).catch(() => null);
  return u ? (await db.doc(`users/${u.uid}`).get()).data() : undefined;
};
async function latestLink(email) {
  const res = await fetch(
    "http://127.0.0.1:9099/emulator/v1/projects/demo-gia-pha/oobCodes",
  );
  const list = (await res.json()).oobCodes.filter(
    (c) => c.email === email && c.requestType === "EMAIL_SIGNIN",
  );
  if (!list.length) throw Error(`Chưa có liên kết đăng nhập cho ${email}`);
  const p = new globalThis.URL(list.at(-1).oobLink).searchParams;
  const link = new globalThis.URL(p.get("continueUrl"));
  link.searchParams.set("apiKey", p.get("apiKey"));
  link.searchParams.set("oobCode", p.get("oobCode"));
  link.searchParams.set("mode", "signIn");
  link.searchParams.set("lang", "vi");
  return link.toString();
}
// Thay tham số ?invitee= của liên kết (kiểm tra email URL sai).
const withInvitee = (link, email) => {
  const u = new globalThis.URL(link);
  u.searchParams.set("invitee", email);
  return u.toString();
};
const ODD_NAME = 'Khách <b>Mời</b> & "Một"';
const rest2 = (path, body) =>
  fetch(
    `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${path}?key=demo-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
// Không tràn ngang và các nút đủ vùng bấm (>= 44px) ở chiều rộng hiện tại.
async function expectFits(page, label, buttons) {
  if (
    !(await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ))
  )
    throw Error(`Tràn ngang: ${label}`);
  for (const b of buttons) {
    const box = await b.boundingBox();
    if (!box || box.height < 43.5)
      throw Error(`Nút cao ${box?.height}px (<44): ${label}`);
  }
}
const shot = async (page, name) => {
  if (SHOT_DIR)
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
};
// Người được mời tự gửi liên kết trên màn đăng nhập rồi mở liên kết trên cùng thiết bị.
async function sameDeviceLogin(context, email) {
  const page = await context.newPage();
  await page.goto(`${URL}/#/`);
  await page.getByLabel("Email nhận liên kết").fill(email);
  await page.getByRole("button", { name: "Gửi liên kết", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã gửi liên kết tới" }),
  ).toBeVisible();
  const selfLink = await latestLink(email);
  // Liên kết tự gửi từ form đăng nhập công khai KHÔNG mang ?invitee= (dùng email tạm cùng thiết bị).
  if (new globalThis.URL(selfLink).searchParams.get("invitee") !== null)
    throw Error("Liên kết tự gửi không được mang invitee");
  await page.goto(selfLink);
  return page;
}
try {
  stage = "admin sends invitation mails in ONE step from the UI";
  const adminCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const admin = await adminCtx.newPage();
  const errors = [];
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto(`${URL}/#/`);
  await admin.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await admin.getByLabel("Mật khẩu").fill(PASSWORD);
  await admin.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(
    admin.getByRole("link", { name: "Quản lý tài khoản", exact: true }),
  ).toBeVisible();
  await expect(
    admin.getByRole("link", { name: "Tài khoản và lời mời" }),
  ).toHaveCount(0);
  await admin.goto(`${URL}/#/accounts`);
  await expect(admin.getByText("Không tìm thấy trang")).toBeVisible();
  await admin
    .getByRole("link", { name: "Quản lý tài khoản", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Mời thành viên", level: 2 }),
  ).toBeVisible();
  await expect(admin.getByText("Chưa có lời mời nào.")).toBeVisible();
  const sendOne = async (email, name) => {
    await admin.getByLabel("Email người được mời").fill(email);
    if (name)
      await admin
        .getByLabel("Họ tên người được mời (không bắt buộc)")
        .fill(name);
    await admin
      .getByRole("button", { name: "Gửi thư mời", exact: true })
      .click();
    await expect(
      admin
        .getByRole("status")
        .filter({ hasText: `Đã gửi thư mời tới ${email}` }),
    ).toBeVisible();
  };
  await sendOne(EMAILS.accept, ODD_NAME);
  await expect(
    admin
      .getByRole("status")
      .filter({ hasText: "hạn mức ngày chưa kiểm chứng" }),
  ).toBeVisible();
  await sendOne(EMAILS.sameDevice);
  await sendOne(EMAILS.revoked);
  await sendOne(EMAILS.expired);
  await sendOne(EMAILS.hijack);
  await sendOne(EMAILS.wrong);
  const row = (email) =>
    admin
      .locator(".users-table-invites")
      .getByRole("row")
      .filter({ hasText: email });
  await expect(row(EMAILS.accept)).toContainText("Đang chờ");
  const inv = await invite(EMAILS.accept);
  if (
    inv.role !== "VIEWER" ||
    inv.status !== "PENDING" ||
    inv.createdBy !== ADMIN.uid ||
    inv.displayName !== ODD_NAME
  )
    throw Error("Lời mời lưu sai");
  const ttl = inv.expiresAt.toMillis() - Date.now();
  if (ttl <= 6 * 86400000 || ttl > 7 * 86400000)
    throw Error(`Hạn lời mời lệch: ${ttl}`);
  const a1 = (await db.doc(`auditLogs/invite-${inv.nonce}`).get()).data();
  if (
    a1.event !== "INVITE_CREATED" ||
    a1.inviteKey !== sha(EMAILS.accept) ||
    JSON.stringify(a1).includes("@")
  )
    throw Error("Nhật ký tạo lời mời sai/chứa email");
  await latestLink(EMAILS.accept); // thư đã được gửi (Auth emulator có mã đăng nhập)
  // Liên kết do ứng dụng gửi mang ?invitee=<email mã hóa> trong continue URL.
  const sent = await latestLink(EMAILS.accept);
  if (new globalThis.URL(sent).searchParams.get("invitee") !== EMAILS.accept)
    throw Error("Liên kết thiếu tham số invitee đúng");

  stage = "button label follows the invitation state; cooldown; resend";
  // Lời mời PENDING còn hạn: nút đổi thành "Gửi lại thư mời" (chỉ gửi lại, không tạo mới) và bị chặn bởi thời gian chờ.
  await admin.getByLabel("Email người được mời").fill(EMAILS.accept);
  await expect(
    admin.getByRole("button", { name: "Gửi lại thư mời", exact: true }),
  ).toBeVisible();
  await admin
    .getByRole("button", { name: "Gửi lại thư mời", exact: true })
    .click();
  await expect(
    admin.getByRole("alert").filter({ hasText: "Vui lòng đợi" }),
  ).toBeVisible();
  if ((await invite(EMAILS.accept)).nonce !== inv.nonce)
    throw Error("Gửi lại không được tạo lời mời mới");
  // Gửi lại: ô họ tên bị khóa kèm ghi chú (tên không đổi khi gửi lại).
  await expect(
    admin.getByLabel("Họ tên người được mời (không bắt buộc)"),
  ).toBeDisabled();
  await expect(
    admin.getByText("Tên không đổi khi gửi lại thư mời."),
  ).toBeVisible();
  await admin.getByLabel("Email người được mời").fill("");
  stage = "revoke, then re-invite: invitation kept even when the mail fails";
  await admin
    .getByRole("button", { name: `Thu hồi lời mời ${EMAILS.revoked}` })
    .click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Đã thu hồi lời mời" }),
  ).toBeVisible();
  await expect(row(EMAILS.revoked)).toContainText("Đã thu hồi");
  const rv = await invite(EMAILS.revoked);
  if (rv.status !== "REVOKED" || rv.revokedBy !== ADMIN.uid)
    throw Error("Thu hồi sai");
  const a2 = (
    await db.doc(`auditLogs/invite-${rv.nonce}-revoked-${ADMIN.uid}`).get()
  ).data();
  if (a2?.event !== "INVITE_REVOKED" || a2.inviteKey !== sha(EMAILS.revoked))
    throw Error("Nhật ký thu hồi sai");
  await admin.getByLabel("Email người được mời").fill(EMAILS.revoked);
  await expect(
    admin.getByRole("button", { name: "Mời lại và gửi thư", exact: true }),
  ).toBeVisible();
  await admin
    .getByRole("button", { name: "Mời lại và gửi thư", exact: true })
    .click();
  await expect(
    admin.getByRole("alert").filter({
      hasText: "Đã tạo lời mời nhưng chưa gửi được thư",
    }),
  ).toBeVisible();
  await expect(
    admin
      .getByRole("alert")
      .filter({ hasText: 'Bấm "Gửi lại thư" trong bảng' }),
  ).toBeVisible();
  if ((await invite(EMAILS.revoked)).status !== "PENDING")
    throw Error("Lời mời bị mất khi gửi thư lỗi");
  await expect(row(EMAILS.revoked)).toContainText("Đang chờ");
  // Thu hồi lại để kiểm "lời mời đã thu hồi không kích hoạt".
  await admin
    .getByRole("button", { name: `Thu hồi lời mời ${EMAILS.revoked}` })
    .click();
  await expect(row(EMAILS.revoked)).toContainText("Đã thu hồi");
  await db
    .doc(`accountInvites/${EMAILS.expired}`)
    .update({ expiresAt: Timestamp.fromMillis(Date.now() - 60000) });
  await admin.reload();
  await expect(row(EMAILS.expired)).toContainText("Hết hạn");
  await expect(
    row(EMAILS.expired).getByRole("button", { name: /^Mời lại và gửi thư/ }),
  ).toBeVisible();

  // Gửi lại từ bảng cho lời mời chưa từng gửi thư (tạo bằng Admin SDK): thành công.
  await db.doc(`accountInvites/${EMAILS.resend}`).set({
    email: EMAILS.resend,
    role: "VIEWER",
    status: "PENDING",
    nonce: "33333333-3333-4333-8333-333333333333",
    createdBy: ADMIN.uid,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    schemaVersion: 1,
  });
  await admin.reload();
  await admin
    .getByRole("button", { name: `Gửi lại thư tới ${EMAILS.resend}` })
    .click();
  await expect(
    admin
      .getByRole("status")
      .filter({ hasText: `Đã gửi thư mời tới ${EMAILS.resend}` }),
  ).toBeVisible();
  await latestLink(EMAILS.resend);

  stage = "invites section layout at 360/768/1280";
  for (const width of [360, 768, 1280]) {
    await admin.setViewportSize({ width, height: 900 });
    await expectFits(admin, `khu mời ở ${width}px`, [
      admin.getByRole("button", { name: "Gửi thư mời", exact: true }),
      admin.getByRole("button", {
        name: `Gửi lại thư tới ${EMAILS.accept}`,
      }),
      admin.getByRole("button", { name: `Thu hồi lời mời ${EMAILS.accept}` }),
    ]);
    await shot(admin, `invites-${width}`);
  }
  await admin.setViewportSize({ width: 1280, height: 900 });

  stage =
    "invitee opens the mail link on a CLEAN device: auto sign-in, auto activation, welcome";
  const guestCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const guest = await guestCtx.newPage();
  guest.on("pageerror", (e) => errors.push(e.message));
  await guest.goto(await latestLink(EMAILS.accept));
  // KHÔNG được hỏi email: đăng nhập, kích hoạt lời mời và vào hệ thống hoàn toàn tự động.
  await expect(
    guest.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  if (await guest.getByText("Nhập lại đúng email đã nhận thư").count())
    throw Error("Liên kết có invitee mà vẫn hỏi lại email");
  if (/oobCode|apiKey|invitee|mode=/.test(guest.url()))
    throw Error("URL chưa được làm sạch: " + guest.url());
  const welcome = guest.getByRole("status").filter({ hasText: "Chào mừng" });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText(
    `Chào mừng ${ODD_NAME}! Bạn đang đăng nhập bằng ${EMAILS.accept}; bạn được mời xem gia phả dòng họ với quyền Chỉ xem.`,
  );
  if ((await guest.locator(".welcome-banner b").count()) !== 0)
    throw Error("Tên chứa HTML bị biên dịch thành thẻ");
  await guest.setViewportSize({ width: 360, height: 800 });
  await expect(
    guest.getByText(`Đang đăng nhập: ${EMAILS.accept}`),
  ).toBeVisible();
  await expectFits(guest, "lời chào và header ở 360px", [
    guest.getByRole("button", { name: "Đã hiểu" }),
    guest.getByRole("button", { name: "Không phải bạn? Đăng xuất" }),
    guest.getByRole("button", { name: "Đăng xuất", exact: true }),
  ]);
  await shot(guest, "welcome-360");
  await guest.setViewportSize({ width: 1280, height: 900 });
  await guest.getByRole("button", { name: "Đã hiểu" }).click();
  await expect(guest.getByText("Chào mừng")).toHaveCount(0);
  await guest.reload();
  await expect(
    guest.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible();
  await expect(guest.getByText("Chào mừng")).toHaveCount(0); // chỉ hiện một lần
  await expect(
    guest.getByRole("link", { name: "Quản lý tài khoản", exact: true }),
  ).toHaveCount(0);
  await guest.goto(`${URL}/#/users`);
  await expect(guest.getByText("Không tìm thấy trang")).toBeVisible();
  await expect
    .poll(() => userByEmail(EMAILS.accept), { timeout: 10000 })
    .toBeTruthy();
  const u = await userByEmail(EMAILS.accept);
  if (
    !u ||
    u.enabled !== true ||
    u.canManageMembership !== false ||
    u.approvedBy !== ADMIN.uid ||
    u.displayName !== ODD_NAME ||
    u.roleIds.join() !== "member"
  )
    throw Error("users sau khi kích hoạt sai: " + JSON.stringify(u));
  if ((await invite(EMAILS.accept)).status !== "ACCEPTED")
    throw Error("Lời mời chưa chuyển ACCEPTED");
  const accUid = (await auth.getUserByEmail(EMAILS.accept)).uid;
  if (
    (await db.doc(`auditLogs/account-${accUid}-1`).get()).data()?.event !==
    "INVITATION_ACCEPTED"
  )
    throw Error("Thiếu nhật ký nhận lời mời");
  await admin.reload();
  await expect(row(EMAILS.accept)).toContainText("Đã nhận");
  // Email đã có tài khoản: chặn tạo lời mời mới, hướng dẫn dùng Sửa → Bật lại.
  await admin.getByLabel("Email người được mời").fill(EMAILS.accept);
  await expect(
    admin.getByText("Email này đã có tài khoản; dùng Sửa → Bật lại"),
  ).toBeVisible();
  await expect(
    admin.getByRole("button", { name: "Mời lại và gửi thư", exact: true }),
  ).toBeDisabled();
  await admin.getByLabel("Email người được mời").fill("");

  stage =
    "wrong ?invitee= is rejected by Firebase; correct email then completes";
  const wrongCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const gw = await wrongCtx.newPage();
  await gw.goto(withInvitee(await latestLink(EMAILS.wrong), EMAILS.stranger));
  await expect(
    gw.getByRole("alert").filter({ hasText: "Email không khớp với liên kết" }),
  ).toBeVisible();
  await expect(gw.getByRole("button", { name: "Đăng nhập →" })).toBeVisible();
  if (await userByEmail(EMAILS.wrong))
    throw Error("users được tạo dù email khớp sai");
  if (
    await auth.getUserByEmail(EMAILS.stranger).then(
      () => true,
      () => false,
    )
  )
    throw Error("Tài khoản của email URL sai bị tạo");
  await gw.getByLabel("Email nhận liên kết").fill(EMAILS.wrong);
  await gw.getByRole("button", { name: "Hoàn tất đăng nhập" }).click();
  await expect(
    gw.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await wrongCtx.close();

  stage = "same-device self-sent link auto-completes and activates";
  const ctx2 = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const g2 = await sameDeviceLogin(ctx2, EMAILS.sameDevice);
  await expect(
    g2.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  if (/oobCode|apiKey|invitee/.test(g2.url()))
    throw Error("URL chưa sạch (cùng thiết bị)");
  if (
    await g2.evaluate(() =>
      globalThis.localStorage.getItem("gia-pha:email-link-pending"),
    )
  )
    throw Error("Email tạm chưa được xóa");
  // Cờ chào mừng không sang tài khoản khác: đăng xuất rồi quản trị viên đăng nhập trên cùng trình duyệt không thấy lời chào.
  await expect(g2.getByText("Chào mừng")).toBeVisible();
  await g2.getByRole("button", { name: "Không phải bạn? Đăng xuất" }).click();
  await g2.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await g2.getByLabel("Mật khẩu").fill(PASSWORD);
  await g2.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(
    g2.getByRole("link", { name: "Quản lý tài khoản", exact: true }),
  ).toBeVisible();
  await expect(g2.getByText("Chào mừng")).toHaveCount(0);
  await ctx2.close();

  stage = "pre-registered password account is neutralised by link sign-in";
  const P = "Chiem-truoc-2026!";
  const rest = (path, body) =>
    fetch(
      `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${path}?key=demo-key`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  if (!(await rest("signUp", { email: EMAILS.hijack, password: P })).ok)
    throw Error("Không đăng ký trước được tài khoản mật khẩu (emulator)");
  if (
    !(
      await rest("signInWithPassword", {
        email: EMAILS.hijack,
        password: P,
        returnSecureToken: true,
      })
    ).ok
  )
    throw Error(
      "Đối chứng: mật khẩu đăng ký trước phải đăng nhập được trước khi dùng liên kết",
    );
  const ctxH = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const gh = await ctxH.newPage();
  await gh.goto(await latestLink(EMAILS.hijack));
  await expect(
    gh.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const after = await rest("signInWithPassword", {
    email: EMAILS.hijack,
    password: P,
    returnSecureToken: true,
  });
  if (after.ok)
    throw Error(
      "Mật khẩu đăng ký trước VẪN đăng nhập được sau khi dùng liên kết email",
    );
  await ctxH.close();

  stage = "send-link cooldown and gate layout at 360px";
  const ctxC = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  const gc = await ctxC.newPage();
  await gc.goto(`${URL}/#/`);
  await gc.getByLabel("Email nhận liên kết").fill("khach.cho@example.test");
  await gc.getByRole("button", { name: "Gửi liên kết", exact: true }).click();
  await expect(
    gc.getByRole("status").filter({ hasText: "Đã gửi liên kết tới" }),
  ).toBeVisible();
  await expectFits(gc, "màn đăng nhập ở 360px", [
    gc.getByRole("button", { name: "Gửi liên kết", exact: true }),
    gc.getByRole("button", { name: "Đăng nhập bằng Google" }),
  ]);
  await shot(gc, "gate-login-360");
  await gc.getByRole("button", { name: "Gửi liên kết", exact: true }).click();
  await expect(
    gc.getByRole("alert").filter({ hasText: "Vui lòng đợi" }),
  ).toBeVisible();
  await ctxC.close();

  stage = "link opened while signed in as someone else";
  const ctxX = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const ax = await ctxX.newPage();
  await ax.goto(`${URL}/#/`);
  await ax.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await ax.getByLabel("Mật khẩu").fill(PASSWORD);
  await ax.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(
    ax.getByRole("link", { name: "Quản lý tài khoản", exact: true }),
  ).toBeVisible();
  await rest2("sendOobCode", {
    requestType: "EMAIL_SIGNIN",
    email: EMAILS.conflict,
    continueUrl: `${URL}/`,
  });
  await ax.goto(await latestLink(EMAILS.conflict));
  await expect(
    ax
      .getByRole("alert")
      .filter({ hasText: `Bạn đang đăng nhập bằng ${ADMIN.email}` }),
  ).toBeVisible();
  if (/oobCode|apiKey/.test(ax.url()))
    throw Error("oobCode chưa được làm sạch khi đang đăng nhập tài khoản khác");
  await ax.getByRole("button", { name: "Đăng xuất" }).click();
  // Liên kết gửi trực tiếp (không có ?invitee= và không có email tạm): chỉ khi đó mới hỏi email.
  await expect(ax.getByText("Nhập lại đúng email đã nhận thư")).toBeVisible();
  await ax.getByLabel("Email nhận liên kết").fill(EMAILS.conflict);
  await ax.getByRole("button", { name: "Hoàn tất đăng nhập" }).click();
  await expect(
    ax.getByText(`Bạn đang đăng nhập bằng ${EMAILS.conflict}`),
  ).toBeVisible();
  await expect(
    ax.getByText("không có lời mời còn hiệu lực cho email này"),
  ).toBeVisible();
  await ctxX.close();

  stage = "revoked, expired and uninvited emails are NOT activated";
  for (const email of [EMAILS.revoked, EMAILS.expired, EMAILS.stranger]) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await sameDeviceLogin(ctx, email);
    await expect(
      page.getByRole("heading", { name: "Chờ cấp quyền" }),
    ).toBeVisible();
    await expect(
      page.getByText(`Bạn đang đăng nhập bằng ${email}`),
    ).toBeVisible();
    await expect(page.getByText("Đang kích hoạt lời mời")).toHaveCount(0);
    if (await userByEmail(email)) throw Error(`users được tạo cho ${email}`);
    await ctx.close();
  }
  stage = "accepted account signs in again by link and goes straight in";
  const ctx3 = await browser.newContext();
  const page3 = await sameDeviceLogin(ctx3, EMAILS.accept);
  await expect(
    page3.getByRole("link", { name: "Cây gia phả", exact: true }),
  ).toBeVisible();
  await expect(page3.getByText("Chào mừng")).toHaveCount(0);

  if (errors.length) throw Error("Lỗi trang: " + errors.join("; "));
  console.log(
    "Kiểm tra trình duyệt lời mời và đăng nhập bằng liên kết email: ĐẠT",
  );
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await purge().catch(() => {});
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
