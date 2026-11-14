// Kiểm tra trình duyệt cho khối chi trên cây gia phả (màu nền, đường kẻ, "Đời N", chữ chìm dính khi cuộn), chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Cần: emulator (auth+firestore) và Vite với VITE_USE_EMULATORS=true đang chạy, đã `npm run seed`.
// Chạy: CHROMIUM_PATH=... node scripts/tree-browser-check.mjs
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { parseDsl } from "./gia-pha/dsl.ts";
import { buildImportPlan } from "./gia-pha/import-plan.ts";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");

// Dữ liệu hoàn toàn giả.
// Dữ liệu hoàn toàn giả: thủy tổ + đời 2 chưa thuộc chi, rồi ba chi (I, Thôn Thượng, Hợp nhất) mỗi chi nhiều người để cuộn.
const lines = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|||",
  "P|a|Giả Văn An|M|CLAN|II|||",
  "K|ts|-|a",
];
const founders = [
  ["b1", "I", "Giả Văn Một"],
  ["b2", "II", "Giả Văn Hai"],
  ["b3", "III", "Giả Văn Ba"],
];
const kids = [];
for (const [id, chi, name] of founders) {
  lines.push(`P|${id}|${name}|M|CLAN|III|${chi}|b=1900|`);
  kids.push(id);
  const sub = [];
  for (let i = 1; i <= 14; i++) {
    lines.push(
      `P|${id}c${i}|Giả Văn ${id.toUpperCase()}${i}|M|CLAN|IV|${chi}|b=19${30 + i}|`,
    );
    sub.push(`${id}c${i}`);
  }
  lines.push(`K|${id}|-|${sub.join(",")}`);
}
lines.push(`K|a|-|${kids.join(",")}`);
lines.push(
  "B|I|Chi I|b1||",
  "B|II|Thôn Thượng|b2||",
  "B|III|Hợp nhất|b3|nguồn giả|",
);
const source = lines.join("\n");
const plan = buildImportPlan(parseDsl(source), "import-browser-fake");
const snapshot = plan.docs.find((d) => d.path === "treeSnapshots/main").data;
const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: "demo-gia-pha" }));
await db.doc("treeSnapshots/main").set(snapshot);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
let stage = "start";
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  stage = "login";
  await page
    .getByLabel("Email", { exact: true })
    .fill("thanhvien@example.test");
  await page.getByLabel("Mật khẩu").fill("Demo-only-2026!");
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  await page.goto("http://127.0.0.1:5173/#/tree");
  await page.getByRole("button", { name: "Mở rộng tất cả" }).click();

  stage = "khối chi: tên, màu nền khác nhau, đường kẻ liền";
  const blocks = page.locator(".chi-block");
  await expect(blocks).toHaveCount(3);
  await expect(page.locator(".chi-head strong")).toHaveText([
    "Chi I",
    "Thôn Thượng",
    "Hợp nhất",
  ]);
  const styles = await blocks.evaluateAll((els) =>
    els.map((el) => {
      const s = globalThis.getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        bw: s.borderLeftWidth,
        bs: s.borderLeftStyle,
        bc: s.borderLeftColor,
      };
    }),
  );
  expect(new Set(styles.map((s) => s.bg)).size).toBe(3);
  for (const s of styles) {
    expect(s.bs).toBe("solid");
    expect(s.bw).toBe("4px");
    expect(s.bc).not.toBe(s.bg);
  }

  stage = "Đời ghi đầy đủ, không còn nhãn Đ8 hay nhãn chi lặp";
  const treeText = await page.locator(".tree-root").innerText();
  expect(treeText).toMatch(/Đời 4/);
  expect(treeText).not.toMatch(/\bĐ\d/);
  await expect(
    page.locator(".tree-root .tree-badge", {
      hasText: /^(Chi I|Thôn Thượng|Hợp nhất)$/,
    }),
  ).toHaveCount(0);

  stage = "chữ chìm dính khi cuộn, đổi theo chi đang xem";
  const visibleMark = async () =>
    page.evaluate(() => {
      const bar = document
        .querySelector(".topbar")
        .getBoundingClientRect().bottom;
      return [...document.querySelectorAll(".chi-watermark span")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.height > 0 &&
            r.top >= bar - 1 &&
            r.bottom <= globalThis.innerHeight
          );
        })
        .map((el) => el.textContent);
    });
  const heads = page.locator(".chi-block");
  for (const [i, name] of ["Chi I", "Thôn Thượng", "Hợp nhất"].entries()) {
    await heads.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect();
      globalThis.scrollBy(0, r.top + r.height / 2 - globalThis.innerHeight / 2);
    });
    await page.waitForTimeout(150);
    expect(await visibleMark()).toEqual([name]);
  }

  stage = "không tràn ngang, ảnh chụp 360/768/1280";
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await heads.nth(1).evaluate((el) => {
      const r = el.getBoundingClientRect();
      globalThis.scrollBy(0, r.top + 60 - 140);
    });
    await page.waitForTimeout(150);
    const over = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(over, `tràn ngang ở ${width}px`).toBeLessThanOrEqual(0);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/chi-blocks-${width}.png`,
      });
  }
  expect(errors).toEqual([]);
  console.log(
    "Browser: chi blocks (3 khối, màu nền riêng, đường kẻ liền, Đời N, chữ chìm dính khi cuộn, 360/768/1280) passed.",
  );
} catch (e) {
  console.error("Thất bại ở bước:", stage);
  throw e;
} finally {
  await browser.close();
}
