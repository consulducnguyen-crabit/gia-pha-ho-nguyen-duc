// Chụp ảnh các màn hình sửa trong app ở 360/768/1280 px để xem bằng mắt (DỮ LIỆU GIẢ, emulator cục bộ).
// Chạy: SHOT_DIR=<thư mục> CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha \
//         --only auth,firestore "node scripts/responsive-shots.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong. Chỉ chụp, không kiểm nghiệp vụ
// (nghiệp vụ đã có edit-browser-check.mjs); lỗi thao tác sẽ làm script thất bại để không chụp nhầm màn hình.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { parseDsl } from "./gia-pha/dsl.ts";
import { buildImportPlan } from "./gia-pha/import-plan.ts";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");
const SHOT_DIR = process.env.SHOT_DIR;
if (!SHOT_DIR) throw Error("Đặt SHOT_DIR là thư mục lưu ảnh.");
mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
const PORT = 5197;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
// m có hai vợ/chồng: m1 (có con chung mc) và m2 (không còn nối với ai nếu gỡ liên kết).
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927;d=1973|ghi chú giả",
  "P|b|Giả Thị Bình|F|CLAN|II|I|b=1930|",
  "P|m|Giả Văn Mạnh Cường Thịnh Vượng|M|CLAN|II|I|b=1935|",
  "P|m1|Nguyễn Thị Hoa Mai Giả|F|SPOUSE|||b=1938|",
  "P|m2|Trần Thị Lan Anh Giả|F|SPOUSE|||b=1940|",
  "P|mc|Giả Văn Con Chung|M|CLAN|III|I|b=1960|",
  "P|z|Giả Văn Lạc|M|CLAN|IV|I|b=1950/1951|CẦN XÁC MINH (giả)",
  "U|m|m2|2||",
  "K|ts|-|a,b,m",
  "K|m|m1|mc",
  "B|I|Chi Một|ts||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "shots-fake");

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const { getAuth } = requireAdmin("firebase-admin/auth");
const app = initializeApp({ projectId: "demo-gia-pha" });
const db = getFirestore(app);
const auth = getAuth(app);

const u = await auth.createUser({
  email: "quantri@example.test",
  password: PASSWORD,
});
await db.doc(`users/${u.uid}`).set({
  enabled: true,
  roleIds: ["member"],
  accessVersion: 1,
  schemaVersion: 1,
  canManageMembership: true,
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
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL);
  await page
    .getByLabel("Số điện thoại", { exact: true })
    .fill("quantri@example.test");
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();

  // Chụp toàn trang ở từng chiều rộng, rồi trả về 1280; ghi lại tràn ngang và vùng bấm nhỏ ở 360.
  const issues = [];
  async function shot(name, widths) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await sleep(150);
      const m = await page.evaluate(() => {
        const over = document.documentElement.scrollWidth - innerWidth;
        const small = [...document.querySelectorAll("button, a, input, select")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            const hidden = r.width === 0 || r.height === 0;
            return (
              !hidden &&
              (r.height < 44 || (e.tagName === "BUTTON" && r.width < 44))
            );
          })
          .map(
            (e) =>
              `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") || e.textContent || e.getAttribute("type") || "").trim().slice(0, 30)}@${Math.round(e.getBoundingClientRect().height)}`,
          );
        return { over, small };
      });
      if (m.over > 0) issues.push(`${name}-${width}: tràn ngang ${m.over}px`);
      if (width === 360 && m.small.length)
        issues.push(
          `${name}-360: vùng bấm <44px: ${[...new Set(m.small)].join(" | ")}`,
        );
      await page.screenshot({
        path: `${SHOT_DIR}/${name}-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  const save = () => page.getByRole("button", { name: "Lưu", exact: true });
  const saved = (t) => expect(page.getByText(t)).toBeVisible();
  const go = (id) => page.goto(`${URL}/#/person/${id}`);
  const pick = async (query, id) => {
    await page.getByLabel("Tìm theo tên").fill(query);
    await page.getByLabel("Chọn người").selectOption(id);
  };

  stage = "profile";
  await go("m");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot("01-profile", [360, 768, 1280]);

  stage = "edit form with DUP_NAME + validation";
  await go("b");
  await page.getByRole("button", { name: "Sửa hồ sơ" }).click();
  await page.getByLabel("Họ tên (bắt buộc)").fill("giả  văn ân");
  await page.getByLabel("Họ tên (bắt buộc)").fill("giả  văn an");
  await expect(
    page.getByRole("status").filter({ hasText: "trùng họ tên và cùng đời" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: /^Năm sinh/ }).fill("abc");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "nhập số năm" }),
  ).toBeVisible();
  await shot("02-edit-dup", [360, 768, 1280]);
  await page.getByRole("button", { name: "Hủy" }).click();

  stage = "add child";
  await go("ts");
  await page.getByRole("button", { name: "Thêm con" }).click();
  await save().click();
  await expect(
    page.getByRole("alert").filter({ hasText: "cha hay mẹ" }),
  ).toBeVisible();
  await page.getByLabel("Cha của đứa trẻ").check();
  await page.getByLabel("Họ tên (bắt buộc)").fill("Giả Văn An");
  await shot("03-add-child", [360, 768, 1280]);
  await page.getByRole("button", { name: "Hủy" }).click();

  stage = "union removal dialogs (con chung, mồ côi)";
  await go("m");
  await page
    .getByRole("button", {
      name: "Gỡ liên kết vợ/chồng với Nguyễn Thị Hoa Mai Giả",
    })
    .click();
  await shot("04-union-remove-common", [360, 768, 1280]);
  await page.getByRole("button", { name: "Hủy" }).click();
  await page
    .getByRole("button", {
      name: "Gỡ liên kết vợ/chồng với Trần Thị Lan Anh Giả",
    })
    .click();
  await page.getByRole("button", { name: "Xác nhận gỡ liên kết" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "tích xác nhận" }),
  ).toBeVisible();
  await shot("05-union-remove-orphan", [360, 768, 1280]);
  await page.getByLabel("Tôi xác nhận gỡ liên kết vợ/chồng này.").check();
  await page.getByRole("button", { name: "Xác nhận gỡ liên kết" }).click();
  await saved(/Đã gỡ liên kết vợ\/chồng giữa/);
  await shot("06-union-removed-notice", [360]);

  stage = "add spouse: new + restore mode";
  await page.getByRole("button", { name: "Thêm vợ/chồng" }).click();
  await shot("07-add-spouse", [360, 768, 1280]);
  await page.getByLabel("Người đã có trong cây").check();
  await pick("trần thị lan", "m2");
  await expect(
    page.getByText(/từng có liên kết vợ\/chồng đã bị gỡ/),
  ).toBeVisible();
  await shot("08-add-spouse-restore", [360, 768, 1280]);
  await page.getByRole("button", { name: "Khôi phục liên kết đã gỡ" }).click();
  await saved("Đã khôi phục liên kết vợ/chồng đã gỡ và ghi nhật ký.");

  stage = "set/replace parent with confirmation";
  await go("b");
  await page.getByRole("button", { name: "Đặt hoặc đổi cha/mẹ" }).click();
  await page.getByLabel("Cha", { exact: true }).check();
  await pick("giả văn an", "a");
  await save().click();
  await expect(
    page.getByRole("alert").filter({ hasText: "tích xác nhận" }),
  ).toBeVisible();
  await shot("09-parent-replace", [360, 768, 1280]);
  await page.getByLabel(/Tôi xác nhận thay Cha hiện có/).check();
  await save().click();
  await saved("Đã cập nhật quan hệ cha/mẹ và ghi nhật ký.");
  await expect
    .poll(async () => (await db.doc("relations/r-ts-b").get()).data()?.deleted)
    .toBe(true);

  stage = "revert replacement";
  await page.getByRole("button", { name: "Hoàn tác lần thay cha" }).click();
  await expect(
    page.getByText(/trở lại làm cha, thay Giả Văn An/),
  ).toBeVisible();
  await shot("10-parent-revert", [360, 768, 1280]);
  await page.getByRole("button", { name: "Xác nhận hoàn tác" }).click();
  await saved("Đã hoàn tác lần thay cha/mẹ và ghi nhật ký.");

  stage = "remove wrong mother + restore";
  await go("a");
  await page.getByRole("button", { name: "Đặt hoặc đổi cha/mẹ" }).click();
  await page.getByLabel("Mẹ", { exact: true }).check();
  await pick("giả thị bình", "b");
  await save().click();
  await saved("Đã cập nhật quan hệ cha/mẹ và ghi nhật ký.");
  await shot("11-parent-section", [360, 768, 1280]);
  await page.getByRole("button", { name: "Gỡ quan hệ" }).click();
  await expect(
    page.getByText(/quan hệ được ẩn, ghi vào nhật ký/),
  ).toBeVisible();
  await shot("12-parent-remove-confirm", [360, 768]);
  await page.getByRole("button", { name: "Xác nhận gỡ quan hệ" }).click();
  await saved(/Đã gỡ mẹ Giả Thị Bình/);
  await page.getByRole("button", { name: "Đặt hoặc đổi cha/mẹ" }).click();
  await pick("giả thị bình", "b");
  await expect(
    page.getByRole("button", { name: "Khôi phục quan hệ đã gỡ" }),
  ).toBeVisible();
  await shot("13-parent-restore", [360, 768, 1280]);
  await page.getByRole("button", { name: "Khôi phục quan hệ đã gỡ" }).click();
  await saved("Đã khôi phục quan hệ cha/mẹ đã gỡ và ghi nhật ký.");

  stage = "hide + restore person list";
  await go("z");
  await page.getByRole("button", { name: "Ẩn người này khỏi cây" }).click();
  await save().click();
  await expect(
    page.getByRole("alert").filter({ hasText: "tích xác nhận" }),
  ).toBeVisible();
  await shot("14-hide-confirm", [360, 768, 1280]);
  await page.getByLabel(/Tôi xác nhận ẩn/).check();
  await save().click();
  await saved(/Đã ẩn Giả Văn Lạc khỏi cây/);
  await shot("15-hide-notice", [360]);
  await page.getByRole("button", { name: "Khôi phục người đã ẩn" }).click();
  await save().click();
  await expect(
    page.getByRole("alert").filter({ hasText: "mã người hợp lệ" }),
  ).toBeVisible();
  await shot("16-restore-list", [360, 768, 1280]);
  await page
    .getByRole("button", { name: /Giả Văn Lạc \(ẩn ở phiên bản/ })
    .click();
  await save().click();
  await saved("Đã khôi phục người đã ẩn");

  stage = "review queue";
  await page.goto(`${URL}/#/review-queue`);
  await expect(
    page.getByRole("heading", { name: "Cần kiểm tra", level: 1 }),
  ).toBeVisible();
  await shot("17-review-queue", [360, 768, 1280]);

  stage = "version conflict";
  await go("b");
  await page.getByRole("button", { name: "Sửa hồ sơ" }).click();
  await db.doc("treeSnapshots/main").update({ editVersion: 99 });
  await page.getByLabel("Họ tên (bắt buộc)").fill("Giả Thị Bình Mới");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "lần sửa khác" }),
  ).toBeVisible();
  await shot("18-conflict", [360, 768, 1280]);

  if (errors.length) throw Error("Lỗi trang: " + errors.join("; "));
  console.log("Phát hiện tự động (tràn ngang / vùng bấm <44px ở 360):");
  for (const i of issues) console.log(" - " + i);
  console.log("Chụp ảnh xong:", SHOT_DIR);
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
