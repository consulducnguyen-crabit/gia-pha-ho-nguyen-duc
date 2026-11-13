// Kiểm tra trình duyệt cho thống kê trang Tổng quan, chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/overview-browser-check.mjs"
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
// Năm tương đối theo năm hiện tại để các con số tuổi không lệch theo thời gian.
const Y = Number(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).format(new Date()),
);
const EXTRA = 60; // đủ để vượt 50 người đầu và thử nút "Xem thêm"
const extra = Array.from(
  { length: EXTRA },
  (_, i) =>
    `P|k${i}|Giả Văn Con ${String(i).padStart(2, "0")}|?|CLAN|IV|I|b=${Y - 30}|`,
);
const source = [
  `P|ts|Cụ Giả Thủy Tổ|M|CLAN|I||b=${Y - 130};d=${Y - 50}|`,
  `P|a|Giả Văn An|M|CLAN|II|I|b=${Y - 95};d=${Y - 10}|`,
  `P|c|Giả Thị Ân|F|CLAN|II|I|b=${Y - 95};d=${Y - 10}|`,
  `P|d|Giả Văn Dũng|M|CLAN|III|I|b=${Y - 70}|`,
  `P|e|Giả Thị Em|F|CLAN|III|I|b=${Y - 70}|`,
  `P|f|Giả Văn Út|M|CLAN|III|I|b=${Y - 3}|`,
  `P|g|Giả Thị Bé|F|CLAN|III|I|b=${Y - 3}|`,
  "P|h|Giả Văn Thiếu|?|CLAN|III||b=|",
  `P|v|Nguyễn Thị Vợ Giả|F|SPOUSE|||b=${Y - 68}|`,
  "P|x|Lê Văn Ngoại Giả|M|EXTERNAL|||b=|",
  `P|z|Giả Văn Lạc|M|CLAN|IV|I|b=${Y - 40};fl=BIRTH_CONFLICT|`,
  ...extra,
  "K|ts|-|a,c",
  `K|a|v|d,e,f,g,h,z,${extra.map((_, i) => `k${i}`).join(",")}`,
  "B|I|Chi Một|a||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "overview-fake");
const TOTAL = 11 + EXTRA;

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const { getAuth } = requireAdmin("firebase-admin/auth");
const app = initializeApp({ projectId: "demo-gia-pha" });
const db = getFirestore(app);
const auth = getAuth(app);

async function account(email, extraFields) {
  const u = await auth.createUser({ email, password: PASSWORD });
  await db.doc(`users/${u.uid}`).set({
    enabled: true,
    roleIds: ["member"],
    accessVersion: 1,
    schemaVersion: 1,
    ...extraFields,
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
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();
}
async function noOverflow(page, label) {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(100);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    if (over > 0) {
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter(
            (e) => e.getBoundingClientRect().right > globalThis.innerWidth,
          )
          .slice(0, 6)
          .map((e) => `${e.tagName.toLowerCase()}.${e.className}`),
      );
      throw Error(
        `${label}: tràn ngang ${over}px ở ${width}px (${wide.join(", ")})`,
      );
    }
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
  // /favicon.ico không có (cả app chưa khai báo biểu tượng) nên bỏ qua; các 404 khác vẫn là lỗi.
  page.on(
    "response",
    (r) =>
      r.status() === 404 &&
      !r.url().endsWith("/favicon.ico") &&
      errors.push(`404 ${r.url()}`),
  );
  page.on(
    "console",
    (m) =>
      m.type() === "error" &&
      !m.text().startsWith("Failed to load resource") &&
      errors.push(m.text()),
  );
  await login(page, email);

  stage = `${label}: số liệu và hiện/ẩn nút Thêm thành viên`;
  await expect(
    page.getByRole("heading", { name: "Số liệu gia phả" }),
  ).toBeVisible();
  await expect(page.getByText(`${TOTAL} người trong cây`)).toBeVisible();
  await expect(page.getByText("Theo dữ liệu lúc tải")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "+ Thêm thành viên" }),
  ).toHaveCount(isAdmin ? 1 : 0);

  stage = `${label}: người cao tuổi nhất bằng nhau đều có liên kết hồ sơ`;
  const oldest = page
    .locator(".stats-fact")
    .filter({ hasText: "Tuổi thọ cao nhất" });
  await expect(oldest.getByText("85 tuổi")).toBeVisible();
  await expect(
    oldest.getByRole("link", { name: "Giả Văn An" }),
  ).toHaveAttribute("href", "#/person/a");
  await expect(oldest.getByRole("link", { name: "Giả Thị Ân" })).toBeVisible();
  const youngest = page
    .locator(".stats-fact")
    .filter({ hasText: "Ít tuổi nhất" });
  await expect(youngest.getByRole("link")).toHaveCount(2);

  stage = `${label}: bảng thay thế cho biểu đồ`;
  await expect(
    page.getByRole("table", { name: "Giới tính", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Số người theo chi" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Số người thuộc dòng họ theo đời" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Người đang sống theo nhóm 10 tuổi/ }),
  ).toHaveCount(1);
  if ((await page.locator("svg[aria-hidden='true']").count()) < 2)
    throw Error("Hình SVG phải aria-hidden");
  const branchTable = page.getByRole("table", { name: "Số người theo chi" });
  await expect(
    branchTable.getByRole("row", { name: /Chưa xếp chi/ }),
  ).toBeVisible();
  await expect(
    branchTable.getByRole("row", { name: /Vợ\/chồng và họ ngoại/ }),
  ).toContainText("2");

  stage = `${label}: thiếu thông tin, thu gọn, 50 người đầu và Xem thêm bằng bàn phím`;
  await expect(
    page.getByRole("heading", { name: "Hồ sơ còn thiếu thông tin" }),
  ).toBeVisible();
  const sexGroup = page.locator("details", { hasText: "Thiếu giới tính" });
  await expect(sexGroup).not.toHaveAttribute("open", "");
  await sexGroup.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(sexGroup.locator("li")).toHaveCount(50);
  await sexGroup.getByRole("button", { name: /Xem thêm/ }).click();
  // Focus chuyển tới người đầu tiên vừa hiện (thứ 51), không rơi về <body>.
  await expect(sexGroup.locator("li").nth(50).getByRole("link")).toBeFocused();
  await expect(sexGroup.locator("li")).toHaveCount(EXTRA + 1); // thêm người "h"
  await expect(sexGroup.getByRole("button", { name: /Xem thêm/ })).toHaveCount(
    0,
  );
  // Sắp theo đời rồi tên (đời do cây suy ra nên cùng đời 3): "Con 00" đầu, "Thiếu" cuối.
  await expect(sexGroup.locator("li").first()).toContainText("Giả Văn Con 00");
  await expect(sexGroup.locator("li").last()).toContainText("Giả Văn Thiếu");
  // Thủy tổ (đời 1, trên người khai chi) không bị báo thiếu chi.
  const branchGroup = page.locator("details", { hasText: "Thiếu chi" });
  await branchGroup.locator("summary").click();
  await expect(
    branchGroup.getByRole("link", { name: "Giả Văn Thiếu" }),
  ).toBeVisible();
  await expect(
    branchGroup.getByRole("link", { name: "Cụ Giả Thủy Tổ" }),
  ).toHaveCount(0);
  // Năm sinh mâu thuẫn tách khỏi "thiếu".
  const conflict = page.locator("details", { hasText: "Năm sinh mâu thuẫn" });
  await conflict.locator("summary").click();
  await expect(
    conflict.getByRole("link", { name: "Giả Văn Lạc" }),
  ).toBeVisible();
  await expect(
    page
      .locator("details", { hasText: "Thiếu năm sinh" })
      .getByRole("link", { name: "Giả Văn Lạc" }),
  ).toHaveCount(0);
  await noOverflow(page, `${label}-overview`);

  stage = `${label}: Tải lại dữ liệu giữ focus trong khối thống kê`;
  await page.getByRole("button", { name: "Tải lại dữ liệu" }).click();
  await expect(
    page.getByRole("heading", { name: "Số liệu gia phả" }),
  ).toBeFocused();
  await expect(page.getByText(`${TOTAL} người trong cây`)).toBeVisible();

  stage = `${label}: liên kết hồ sơ dẫn đúng trang`;
  await oldest.getByRole("link", { name: "Giả Văn An" }).click();
  await expect(page).toHaveURL(/#\/person\/a$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Giả Văn An",
  );
  if (errors.length) throw Error("Lỗi trang: " + errors.join("; "));
  await ctx.close();
}
async function checkUnsynced() {
  stage = "ảnh chụp chưa đồng bộ giới tính (bộ 6/7 phần tử) + Tải lại dữ liệu";
  const ref = db.doc("treeSnapshots/main");
  const doc = (await ref.get()).data();
  const data = JSON.parse(doc.data);
  for (const t of Object.values(data.persons)) t.length = Math.min(t.length, 7);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "thanhvien@example.test");
  await expect(page.getByText(`${TOTAL} người trong cây`)).toBeVisible();
  await ref.set({ ...doc, data: JSON.stringify(data) });
  await page.getByRole("button", { name: "Tải lại dữ liệu" }).click();
  await expect(
    page.getByText("Chưa đồng bộ giới tính", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Giới tính", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("details", { hasText: "Thiếu giới tính" }),
  ).toHaveCount(0);
  await noOverflow(page, "member-unsynced");
  if (errors.length) throw Error("Lỗi trang: " + errors.join("; "));
  await ctx.close();
}
try {
  await checkRole("thanhvien@example.test", false);
  await checkRole("quantri@example.test", true);
  await checkUnsynced();
  console.log("Kiểm tra trình duyệt thống kê Tổng quan: ĐẠT");
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
