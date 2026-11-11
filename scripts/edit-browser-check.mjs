// Kiểm tra trình duyệt cho biểu mẫu sửa hồ sơ, chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/edit-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong.
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
const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927;d=1973|ghi chú giả",
  "P|b|Giả Thị Bình|F|CLAN|II|I|b=1930|",
  "P|z|Giả Văn Lạc|M|CLAN|IV|I|b=1950/1951|CẦN XÁC MINH (giả)",
  "K|ts|-|a,b",
  "B|I|Chi Một|ts||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "edit-browser-fake");

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
  return u.uid;
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
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();
}
try {
  stage = "member sees no edit button";
  const memberCtx = await browser.newContext();
  const m = await memberCtx.newPage();
  await login(m, "thanhvien@example.test");
  await m.goto(`${URL}/#/person/a`);
  await expect(
    m.getByRole("heading", { name: "Giả Văn An", level: 1 }),
  ).toBeVisible();
  await expect(m.getByRole("button", { name: "Sửa hồ sơ" })).toHaveCount(0);
  await memberCtx.close();

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "quantri@example.test");
  await page.goto(`${URL}/#/person/a`);

  stage = "open form shows current values";
  await page.getByRole("button", { name: "Sửa hồ sơ" }).click();
  await expect(page.getByLabel("Họ tên (bắt buộc)")).toHaveValue("Giả Văn An");
  await expect(page.getByRole("textbox", { name: /^Năm sinh/ })).toHaveValue(
    "1927",
  );
  await expect(page.getByLabel(/Ghi chú riêng/)).toHaveValue("ghi chú giả");

  stage = "focus moves into the form on open and back on cancel";
  const activeText = () =>
    page.evaluate(() => globalThis.document.activeElement?.textContent ?? "");
  await expect.poll(activeText).toBe("Sửa hồ sơ");
  await page.getByRole("button", { name: "Hủy" }).click();
  await expect(page.getByRole("button", { name: "Sửa hồ sơ" })).toBeFocused();
  await page.getByRole("button", { name: "Sửa hồ sơ" }).click();

  stage = "validation errors stay near field and keep input";
  await page.getByRole("textbox", { name: /^Năm sinh/ }).fill("abc");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "nhập số năm" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Năm sinh/ })).toHaveValue(
    "abc",
  );
  await expect(
    page.getByRole("textbox", { name: /^Năm sinh/ }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("textbox", { name: /^Năm sinh/ })).toBeFocused();

  if (process.env.SHOT_DIR)
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 1400 });
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/edit-${width}.png`,
        fullPage: true,
      });
    }
  stage = "no horizontal overflow at 360/768/1280";
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    if (overflow > 0) throw Error(`Tràn ngang ${overflow}px ở ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  stage = "save a change";
  await page.getByRole("textbox", { name: /^Năm sinh/ }).fill("1928");
  await page.getByLabel("Họ tên (bắt buộc)").fill("Giả Văn Ân");
  await page.getByLabel(/Ghi chú riêng/).fill("ghi chú mới");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByText("Đã lưu thay đổi và ghi nhật ký.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Giả Văn Ân", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Đã lưu thay đổi và ghi nhật ký.")).toBeFocused();
  await page.getByRole("link", { name: "Giả Thị Bình" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Giả Thị Bình", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Đã lưu thay đổi và ghi nhật ký.")).toHaveCount(
    0,
  );
  await page.goBack();
  const person = (await db.doc("persons/a").get()).data();
  const profile = (await db.doc("memberProfiles/a").get()).data();
  const snap = (await db.doc("treeSnapshots/main").get()).data();
  const audit = (await db.doc("auditLogs/edit-1").get()).data();
  const priv = (await db.doc("personPrivate/a").get()).data();
  if (person.displayName !== "Giả Văn Ân" || person.birth.year !== 1928)
    throw Error("persons chưa cập nhật");
  if (profile.birthYear !== 1928 || profile.displayName !== "Giả Văn Ân")
    throw Error("memberProfiles chưa cập nhật");
  if (snap.editVersion !== 1 || !snap.data.includes("Giả Văn Ân"))
    throw Error("snapshot chưa cập nhật");
  if (audit.target !== "persons/a" || JSON.stringify(audit).includes("ghi chú"))
    throw Error("nhật ký sai hoặc lộ nguyên văn ghi chú");
  if (priv.note !== "ghi chú mới") throw Error("personPrivate chưa cập nhật");

  stage = "unknown raw date requires confirmation, flags can be verified";
  await page.goto(`${URL}/#/person/z`);
  await page.getByRole("button", { name: "Sửa hồ sơ" }).click();
  await page.getByRole("textbox", { name: /^Năm sinh/ }).fill("1950");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "tích xác nhận" }),
  ).toBeVisible();
  await page.getByLabel(/Tôi xác nhận thay văn bản ngày gốc/).check();
  await page.getByLabel(/Tài liệu gốc chưa rõ, cần xác minh/).uncheck();
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByText("Đã lưu thay đổi và ghi nhật ký.")).toBeVisible();
  await expect(
    page.getByText("Tài liệu gốc chưa rõ, cần xác minh"),
  ).toHaveCount(0);

  stage = "add spouse and child, with validation and navigation";
  await page.goto(`${URL}/#/person/a`);
  await page.getByRole("button", { name: "Thêm vợ/chồng" }).click();
  await page.getByLabel("Họ tên (bắt buộc)").fill("Vợ Giả Ân");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByText("Đã thêm quan hệ vợ/chồng và ghi nhật ký."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Vợ Giả Ân" })).toBeVisible();
  await page.getByRole("button", { name: "Thêm con" }).click();
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    if (overflow > 0)
      throw Error(`Form thêm con tràn ngang ${overflow}px ở ${width}px`);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/add-${width}.png`,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "cha hay mẹ" }),
  ).toBeVisible();
  await page.getByLabel("Cha của đứa trẻ").check();
  await page
    .getByLabel(/^Mẹ của đứa trẻ \(nếu có ghi\)/)
    .selectOption({ label: "Vợ Giả Ân" });
  await page.getByLabel("Họ tên (bắt buộc)").fill("Giả Văn Mới");
  await page.getByRole("textbox", { name: /^Năm sinh/ }).fill("1960");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Giả Văn Mới", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Đã thêm người con và ghi nhật ký."),
  ).toBeVisible();
  await expect(page.getByText("Đời 3").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Giả Văn Ân" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Vợ Giả Ân" }).first(),
  ).toBeVisible();
  const kidDocs = await db
    .collection("persons")
    .where("displayName", "==", "Giả Văn Mới")
    .get();
  if (kidDocs.size !== 1) throw Error("Không thấy người con mới");
  const kid = kidDocs.docs[0].id;
  const rel = (await db.doc(`relations/r-a-${kid}`).get()).data();
  if (!rel || rel.parentRole !== "FATHER" || rel.lineageTransmission !== true)
    throw Error("Quan hệ cha-con sai");
  const spouseDocs = await db
    .collection("persons")
    .where("displayName", "==", "Vợ Giả Ân")
    .get();
  const spouseId = spouseDocs.docs[0].id;
  const rel2 = (await db.doc(`relations/r-${spouseId}-${kid}`).get()).data();
  if (
    !rel2 ||
    rel2.parentRole !== "MOTHER" ||
    rel2.lineageTransmission !== false
  )
    throw Error("Quan hệ mẹ-con sai");
  const a3 = (await db.doc("auditLogs/edit-3").get()).data();
  const a4 = (await db.doc("auditLogs/edit-4").get()).data();
  if (a3.event !== "SPOUSE_ADDED" || a4.event !== "PERSON_ADDED")
    throw Error("Nhật ký thêm người sai");
  if ((await db.doc("treeSnapshots/main").get()).data().editVersion !== 4)
    throw Error("editVersion phải là 4");

  stage =
    "set parent for an unconnected person, replace it, then change child type";
  await page.goto(`${URL}/#/person/z`);
  await page.getByRole("button", { name: "Đặt hoặc đổi cha/mẹ" }).click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Chọn đặt cha hay mẹ" }),
  ).toBeVisible();
  await page.getByLabel("Cha", { exact: true }).check();
  await page.getByLabel("Tìm theo tên").fill("giả văn ân");
  await page.getByLabel("Chọn người").selectOption("a");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByText("Đã cập nhật quan hệ cha/mẹ và ghi nhật ký."),
  ).toBeVisible();
  const r1 = (await db.doc("relations/r-a-z").get()).data();
  if (!r1 || r1.lineageTransmission !== true) throw Error("r-a-z sai");
  await page.getByRole("button", { name: "Đặt hoặc đổi cha/mẹ" }).click();
  await page.getByLabel("Cha", { exact: true }).check();
  await page.getByLabel("Tìm theo tên").fill("giả văn mới");
  await page.getByLabel("Chọn người").selectOption(kid);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "tích xác nhận" }),
  ).toBeVisible();
  await expect(
    page.getByText("Đã cập nhật quan hệ cha/mẹ và ghi nhật ký."),
  ).toHaveCount(0);
  await page.getByLabel(/Tôi xác nhận thay Cha hiện có/).check();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByText("Đã cập nhật quan hệ cha/mẹ và ghi nhật ký."),
  ).toBeVisible();
  await expect
    .poll(async () => (await db.doc("relations/r-a-z").get()).data()?.deleted)
    .toBe(true);
  const old = (await db.doc("relations/r-a-z").get()).data();
  if (old.replacedBy !== `r-${kid}-z`) throw Error("Quan hệ cũ chưa được ẩn");
  if (!(await db.doc(`relations/r-${kid}-z`).get()).exists)
    throw Error("Chưa có quan hệ mới");
  const zSnap = JSON.parse(
    (await db.doc("treeSnapshots/main").get()).data().data,
  ).persons.z;
  if (zSnap[3] !== 4) throw Error(`Đời của z phải là 4, thực tế ${zSnap[3]}`);
  await page.getByRole("button", { name: "Đổi thành con nuôi" }).click();
  await page
    .getByRole("button", { name: "Xác nhận đổi thành con nuôi" })
    .click();
  await expect(page.getByText("Đã đổi loại con và ghi nhật ký.")).toBeVisible();
  if (
    (await db.doc(`relations/r-${kid}-z`).get()).data().relationType !==
    "ADOPTIVE"
  )
    throw Error("Loại con chưa đổi");
  const audit7 = (await db.doc("auditLogs/edit-7").get()).data();
  if (audit7.event !== "RELATION_TYPE_CHANGED") throw Error("Nhật ký 7 sai");

  stage = "hide a person (soft delete) then restore it";
  await page.goto(`${URL}/#/person/z`);
  await page.getByRole("button", { name: "Ẩn người này khỏi cây" }).click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "tích xác nhận" }),
  ).toBeVisible();
  await page.getByLabel(/Tôi xác nhận ẩn/).check();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Giả Văn Mới", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(/Đã ẩn Giả Văn Lạc khỏi cây/)).toBeVisible();
  if (!(await db.doc("persons/z").get()).data().deleted)
    throw Error("persons/z phải bị đánh dấu ẩn");
  if ((await db.doc("memberProfiles/z").get()).exists)
    throw Error("memberProfiles/z phải bị xóa");
  if (
    (await db.doc("auditLogs/edit-8").get()).data().event !== "PERSON_DELETED"
  )
    throw Error("Nhật ký 8 sai");
  await page.goto(`${URL}/#/person/z`);
  await expect(page.getByText("Không tìm thấy").first()).toBeVisible();
  await page.goto(`${URL}/#/person/${kid}`);
  await page.getByRole("button", { name: "Khôi phục người đã ẩn" }).click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "mã người hợp lệ" }),
  ).toBeVisible();
  await page.getByLabel("Mã người cần khôi phục").fill("z");
  await page.getByLabel("Số phiên bản nhật ký của lần ẩn").fill("8");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Giả Văn Lạc", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Đã khôi phục người đã ẩn")).toBeVisible();
  if ((await db.doc("persons/z").get()).data().deleted !== false)
    throw Error("persons/z phải được khôi phục");
  if (!(await db.doc("memberProfiles/z").get()).exists)
    throw Error("memberProfiles/z phải có lại");
  const zBack = JSON.parse(
    (await db.doc("treeSnapshots/main").get()).data().data,
  ).persons.z;
  if (!zBack || zBack[3] !== 4) throw Error("snapshot khôi phục sai");
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) throw Error(`Tràn ngang ở ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  stage = "version conflict is reported, nothing written";
  await page.goto(`${URL}/#/person/b`);
  await page.getByRole("button", { name: "Sửa hồ sơ" }).click();
  await db.doc("treeSnapshots/main").update({ editVersion: 19 });
  await page.getByLabel("Họ tên (bắt buộc)").fill("Giả Thị Bình Mới");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "lần sửa khác" }),
  ).toBeVisible();
  if ((await db.doc("persons/b").get()).data().displayName !== "Giả Thị Bình")
    throw Error("Không được ghi khi xung đột");
  await page.getByRole("button", { name: "Tải lại hồ sơ" }).click();
  await expect(page.getByRole("button", { name: "Sửa hồ sơ" })).toBeVisible();

  if (errors.length) throw Error("Lỗi trang: " + errors.join("; "));
  console.log("Kiểm tra trình duyệt biểu mẫu sửa: ĐẠT");
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
