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

  stage = "tiêu đề tên gia phả lớn, nổi bật; đã bỏ khẩu hiệu cũ";
  for (const width of [360, 768, 1280]) {
    const { ctx, page } = await fresh(width);
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveCount(1);
    await expect(title).toHaveText("Gia phả Dòng họ Nguyễn Đức Phùng Xá");
    // Đúng ba dòng: Gia phả / Dòng họ Nguyễn Đức / Phùng Xá (không bị tràn xuống dòng thứ tư).
    const lines = await title.evaluate((e) => {
      const r = globalThis.document.createRange();
      r.selectNodeContents(e);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top)))
        .size;
    });
    if (lines !== 3) throw Error(`Tiêu đề có ${lines} dòng ở ${width}px`);
    const size = await title.evaluate((e) =>
      Number.parseFloat(globalThis.getComputedStyle(e).fontSize),
    );
    if (size < 26) throw Error(`Tiêu đề quá nhỏ: ${size}px ở ${width}px`);
    const weight = await title.evaluate((e) =>
      Number.parseInt(globalThis.getComputedStyle(e).fontWeight, 10),
    );
    if (weight < 600) throw Error(`Tiêu đề chưa đậm: ${weight}`);
    // Nội dung sát mép trên: không còn khoảng trống lớn phía trên (tiêu đề, và cột đăng nhập khi hai cột).
    const titleTop = await title.evaluate((e) => e.getBoundingClientRect().top);
    if (titleTop > 40)
      throw Error(`Tiêu đề cách mép trên ${titleTop}px ở ${width}px`);
    if (width > 800) {
      const formTop = await page
        .getByText("Gìn giữ cội nguồn", { exact: true })
        .evaluate((e) => e.getBoundingClientRect().top);
      if (formTop > 40)
        throw Error(`Khối đăng nhập cách mép trên ${formTop}px ở ${width}px`);
    }
    // Câu đối thư pháp: chỉ trang trí (aria-hidden), LUÔN hiện (dọc: dưới tiêu đề; ngang: cuối panel trái),
    // cách dòng chữ nhỏ phía trên, không đè và không vượt khung nhìn.
    const art = page.locator(".gate-art");
    await expect(art).toHaveCount(1);
    await expect(page.locator(".gate-art-slot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(art).toBeVisible();
    const slot = page.locator(".gate-art-slot");
    await expect(slot).toContainText("Cây có gốc, nước có nguồn");
    await expect(slot).toContainText("MỘC HỮU BẢN · THỦY HỮU NGUYÊN");
    // Hai dòng chú thích là chữ thường, cỡ đủ đọc (không bị co theo hình): >= 18px và >= 11px, căn giữa.
    const capPx = await page
      .locator(".gate-art-caption")
      .evaluate((e) =>
        Number.parseFloat(globalThis.getComputedStyle(e).fontSize),
      );
    const readPx = await page
      .locator(".gate-art-reading")
      .evaluate((e) =>
        Number.parseFloat(globalThis.getComputedStyle(e).fontSize),
      );
    if (capPx < 18 || readPx < 11)
      throw Error(
        `${width}: chú thích câu đối quá nhỏ (${capPx}px, ${readPx}px)`,
      );
    const capBox = await page.locator(".gate-art-caption").boundingBox();
    if (!capBox || capBox.x < 0 || capBox.x + capBox.width > width + 1)
      throw Error(`${width}: chú thích câu đối tràn ngang`);
    const box = await art.boundingBox();
    const tag = await page.locator(".story .tree-mark").boundingBox();
    if (!box || !tag) throw Error("Không đo được hình");
    const gap = box.y - (tag.y + tag.height);
    if (gap < (width > 800 ? 24 : 12))
      throw Error(`Hình cách chữ phía trên chỉ ${gap}px ở ${width}px`);
    if (box.height < 120) throw Error(`Hình quá nhỏ ở ${width}px`);
    if (width > 800 && box.y + box.height > 900 + 1)
      throw Error(`Hình vượt khung nhìn ở ${width}px`);
    for (const gone of [
      "RIÊNG TƯ",
      "Đăng nhập bằng tài khoản đã được cấp quyền",
      "Dữ liệu gia phả chỉ mở sau khi kiểm tra quyền truy cập",
      "Từ cội nguồn",
      "nối những thế hệ",
      "Một nơi lưu giữ ký ức",
    ])
      await expect(page.getByText(gone)).toHaveCount(0);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/login-title-${width}.png`,
        fullPage: true,
      });
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

  stage =
    "bố cục theo hướng xoay: ngang như desktop (hai cột), dọc từ trên xuống; đủ nội dung ở mọi kích thước";
  for (const [width, height] of [
    [360, 640],
    [480, 800],
    [768, 1024],
    [820, 1180],
    [1000, 1200],
    [640, 360],
    [667, 375],
    [800, 600],
    [1024, 768],
    [1180, 820],
    [1280, 800],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(URL);
    const tag = `${width}x${height}`;
    await noOverflow(page);
    const m = await page.evaluate(() => {
      const r = (s) => {
        const b = globalThis.document.querySelector(s).getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      return {
        story: r(".story"),
        login: r(".login"),
        art: r(".gate-art"),
        mark: r(".story .tree-mark"),
        title: r(".gate-title"),
        h2: r(".login h2"),
      };
    });
    const landscape = width > height && width > 560;
    if (landscape) {
      // Như desktop: hai cột cạnh nhau; câu đối thấy ngay không cần cuộn.
      if (!(m.login.x >= m.story.x + m.story.w - 1))
        throw Error(`${tag}: ngang nhưng không phải hai cột`);
      if (m.art.y >= height)
        throw Error(`${tag}: câu đối nằm ngoài màn hình đầu tiên`);
    } else {
      // Dọc: một cột, tiêu đề + biểu trưng + câu đối ở trên, ô đăng nhập ở dưới.
      if (!(m.login.y >= m.story.y + m.story.h - 1))
        throw Error(`${tag}: dọc nhưng ô đăng nhập không nằm dưới`);
      if (!(m.title.y < m.mark.y && m.mark.y < m.art.y && m.art.y < m.login.y))
        throw Error(
          `${tag}: sai thứ tự tiêu đề, biểu trưng, câu đối, đăng nhập`,
        );
    }
    // Tiêu đề, logo Hán Nôm và câu đối căn giữa theo chiều ngang của panel trái (hoặc cả trang khi dọc).
    for (const name of ["title", "mark", "art"]) {
      const off = Math.abs(
        m[name].x + m[name].w / 2 - (m.story.x + m.story.w / 2),
      );
      if (off > 6) throw Error(`${tag}: ${name} lệch tâm ${Math.round(off)}px`);
    }
    // Đủ nội dung: mọi thành phần có kích thước thật, nằm gọn theo chiều ngang.
    for (const [name, b] of Object.entries(m))
      if (b.w < 40 || b.h < 20 || b.x < -1 || b.x + b.w > width + 1)
        throw Error(`${tag}: ${name} thiếu hoặc tràn: ${JSON.stringify(b)}`);
    await expect(page.getByLabel("Số điện thoại")).toBeVisible();
    await expect(page.getByLabel("Mật khẩu")).toBeVisible();
    await ctx.close();
  }

  stage =
    "đếm ngược giỗ Tổ (01/9 âm lịch) ở góc trên bên phải panel đăng nhập, có icon lịch";
  for (const [width, height] of [
    [360, 640],
    [768, 1024],
    [1024, 768],
    [1280, 800],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date("2026-10-09T05:00:00Z"));
    await page.goto(URL);
    const box = page.getByRole("group", { name: "Đếm ngược đến ngày giỗ Tổ" });
    await expect(box).toBeVisible();
    await expect(box).toContainText("Giỗ Tổ");
    await expect(box).toContainText("01/9 âm lịch");
    await expect(box.locator("svg.ancestor-icon")).toBeVisible();
    // Đồng hồ cố định: 09/10/2026 (giờ VN) -> giỗ Tổ 10/10/2026, còn 1 ngày.
    await expect(box.locator(".ancestor-date")).toContainText(
      "Thứ Bảy, 10/10/2026",
    );
    await expect(box.locator(".ancestor-left")).toHaveText("Còn 1 ngày");
    // Tờ lịch bloc: ô tháng/năm, thứ và số ngày lớn.
    await expect(box.locator(".ancestor-weekday")).toHaveText("Thứ Bảy");
    await expect(box.locator(".ancestor-day")).toHaveText("10");
    await expect(box.locator(".ancestor-mini")).toContainText("10");
    await expect(box.locator(".ancestor-mini")).toContainText("2026");
    const dayPx = await box
      .locator(".ancestor-day")
      .evaluate((e) =>
        Number.parseFloat(globalThis.getComputedStyle(e).fontSize),
      );
    if (dayPx < 40) throw Error(`${width}: số ngày quá nhỏ ${dayPx}px`);
    await expect(box.locator("time")).toHaveAttribute("datetime", "2026-10-10");
    // Vùng đăng nhập căn giữa, thứ tự từ trên xuống: "Gìn giữ cội nguồn", tờ lịch giỗ Tổ, "Chào mừng", ô nhập, nút.
    const mid = (r) => r.x + r.width / 2;
    // Nhãn thư pháp: phông Playball đã tải, cỡ lớn (>= 26px), màu son.
    const brand = await page
      .locator(".login-top .eyebrow")
      .evaluate(async (e) => {
        await globalThis.document.fonts.ready;
        const st = globalThis.getComputedStyle(e);
        return {
          family: st.fontFamily,
          size: Number.parseFloat(st.fontSize),
          loaded: globalThis.document.fonts.check(
            `${st.fontSize} Playball`,
            e.textContent ?? "",
          ),
        };
      });
    if (!/Playball/.test(brand.family) || !brand.loaded)
      throw Error(
        `${width}: nhãn chưa dùng phông thư pháp Playball (${brand.family})`,
      );
    if (brand.size < 26)
      throw Error(`${width}: nhãn chưa đủ lớn: ${brand.size}px`);
    // Chữ trong tờ lịch (Giỗ Tổ, 01/9 âm lịch, thứ + ngày, còn N ngày) căn giữa cột bên phải.
    const info = await box.locator(".ancestor-info").boundingBox();
    for (const sel of [
      ".ancestor-title",
      ".ancestor-sub",
      ".ancestor-date",
      ".ancestor-left",
    ]) {
      const lines = await box.locator(sel).evaluate((e) => {
        const r = globalThis.document.createRange();
        r.selectNodeContents(e);
        return [...r.getClientRects()].map((q) => q.x + q.width / 2);
      });
      const center = info.x + info.width / 2;
      const text = await box
        .locator(sel)
        .evaluate((e) => globalThis.getComputedStyle(e).textAlign);
      if (text !== "center" && sel !== ".ancestor-date")
        throw Error(`${width}: ${sel} chưa căn giữa (${text})`);
      // dòng đơn: tâm chữ lệch tâm cột không quá 12px (icon lịch nằm cùng dòng nên cho phép lệch nhẹ)
      if (
        lines.length &&
        Math.abs(lines.reduce((a, c) => a + c, 0) / lines.length - center) > 14
      )
        throw Error(`${width}: ${sel} lệch tâm cột bên phải`);
    }
    const b = await box.boundingBox();
    const input = await page.locator(".login form").boundingBox();
    const eyebrow = await page.locator(".login-top .eyebrow").boundingBox();
    const h2 = await page.locator(".login h2").boundingBox();
    // Nhãn và ô nhập cùng một hàng: nhãn bên trái, ô bên phải, hai cột thẳng hàng; ô nhập chưa bị co quá nhỏ.
    const rows = [];
    for (const name of ["Số điện thoại", "Mật khẩu"]) {
      const row = page.locator("label.login-row", { hasText: name });
      const field = await row.locator("input").boundingBox();
      const text = await row.evaluate((e) => {
        const r = globalThis.document.createRange();
        r.selectNodeContents(e.firstChild);
        const q = r.getBoundingClientRect();
        return { x: q.x, y: q.y, width: q.width, height: q.height };
      });
      if (!field) throw Error(`${width}: không đo được ô ${name}`);
      if (Math.abs(text.y + text.height / 2 - (field.y + field.height / 2)) > 4)
        throw Error(`${width}: nhãn "${name}" không cùng hàng với ô nhập`);
      if (!(text.x + text.width <= field.x))
        throw Error(`${width}: nhãn "${name}" không nằm bên trái ô nhập`);
      if (field.width < 150)
        throw Error(`${width}: ô "${name}" quá hẹp: ${field.width}px`);
      rows.push({ text, field });
    }
    if (
      Math.abs(rows[0].field.x - rows[1].field.x) > 1 ||
      Math.abs(rows[0].text.x - rows[1].text.x) > 1
    )
      throw Error(`${width}: hai hàng nhãn/ô nhập không thẳng cột`);
    // Hai hàng liền nhau, mỗi hàng chỉ cao bằng ô nhập (không còn dòng nhãn riêng).
    if (rows[1].field.y - rows[0].field.y > rows[0].field.height + 40)
      throw Error(`${width}: khoảng cách giữa hai ô nhập quá lớn`);
    const submit = await page.locator(".login .primary").boundingBox();
    const gmail = await page.locator(".gmail-button").boundingBox();
    if (!b || !input || !eyebrow || !h2 || !submit || !gmail)
      throw Error("Không đo được vùng đăng nhập");
    if (!(
      eyebrow.y < b.y &&
      b.y + b.height <= h2.y &&
      h2.y < input.y &&
      input.y < submit.y
    ))
      throw Error(`${width}: sai thứ tự nhãn, tờ lịch, tiêu đề, ô nhập, nút`);
    for (const [name, r] of [
      ["nhãn", eyebrow],
      ["tờ lịch", b],
      ["nút Gmail", gmail],
    ])
      if (Math.abs(mid(r) - mid(input)) > 2)
        throw Error(
          `${width}: ${name} lệch tâm ${Math.abs(mid(r) - mid(input))}px`,
        );
    const h2Text = await page.locator(".login h2").evaluate((e) => {
      const r = globalThis.document.createRange();
      r.selectNodeContents(e);
      const t = r.getBoundingClientRect();
      return { x: t.x, width: t.width };
    });
    if (Math.abs(mid(h2Text) - mid(input)) > 2)
      throw Error(`${width}: tiêu đề "Chào mừng" lệch tâm`);
    if (b.x < 0 || b.x + b.width > width) throw Error(`${width}: tràn ngang`);
    await noOverflow(page);
    await ctx.close();
  }

  stage =
    "đếm ngược giỗ Tổ theo các mốc ngày cố định (hôm nay, sau ngày giỗ, nửa đêm giờ Việt Nam)";
  for (const [now, dateText, leftText] of [
    ["2026-10-10T05:00:00Z", "Thứ Bảy, 10/10/2026", "Hôm nay"],
    ["2026-10-11T05:00:00Z", "Thứ Năm, 30/09/2027", "Còn 354 ngày"],
    ["2026-10-09T18:00:00Z", "10/10/2026", "Hôm nay"], // 01:00 ngày 10/10 giờ Việt Nam
    ["2026-10-09T16:59:00Z", "10/10/2026", "Còn 1 ngày"], // 23:59 ngày 09/10 giờ Việt Nam
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      timezoneId: "America/Los_Angeles", // múi giờ máy khác Việt Nam: vẫn phải tính theo giờ Việt Nam
    });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(URL);
    const box = page.getByRole("group", { name: "Đếm ngược đến ngày giỗ Tổ" });
    await expect(box.locator(".ancestor-date")).toContainText(dateText);
    await expect(box.locator(".ancestor-left")).toHaveText(leftText);
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
