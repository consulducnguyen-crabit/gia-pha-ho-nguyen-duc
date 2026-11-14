/* global getComputedStyle, NodeFilter, window, scrollY -- chỉ dùng trong các hàm chạy trong trang (page.evaluate) */
// Audit giao diện theo HTML Standard + WCAG 2.2 AA (kiểm tự động một phần; KHÔNG thay thế trình đọc màn hình
// thật hay đánh giá thủ công). DỮ LIỆU GIẢ, emulator cục bộ, Chrome qua CHROMIUM_PATH.
// Chạy: [SHOT_DIR=<thư mục>] [AUDIT_LABEL=truoc|sau] CHROMIUM_PATH=... npx firebase emulators:exec \
//   --project demo-gia-pha --only auth,firestore "node scripts/ui-standards-audit.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true). Thoát mã 1 nếu còn lỗi mức "lỗi" (không tính cảnh báo).
// axe-core: không có trong node_modules nên không dùng; không thêm dependency mới.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { parseDsl } from "./gia-pha/dsl.ts";
import { buildImportPlan } from "./gia-pha/import-plan.ts";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Đặt đúng hai biến emulator cục bộ; không dùng hệ thống thật.");
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const LABEL = process.env.AUDIT_LABEL || "audit";

const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
const PORT = 5198;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927;d=1973|ghi chú giả",
  "P|b|Giả Thị Bình|F|CLAN|II|I|b=1930|",
  "P|m|Giả Văn Mạnh Cường Thịnh Vượng|M|CLAN|II|I|b=1935|",
  "P|m1|Nguyễn Thị Hoa Mai Giả|F|SPOUSE|||b=1938|",
  "P|z|Giả Văn Lạc|M|CLAN|IV|I|b=1950/1951|CẦN XÁC MINH (giả)",
  "U|m|m1|1||",
  "K|ts|-|a,b,m",
  "B|I|Chi Một|ts||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "audit-fake");

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const { getAuth } = requireAdmin("firebase-admin/auth");
const app = initializeApp({ projectId: "demo-gia-pha" });
const db = getFirestore(app);
const auth = getAuth(app);
async function makeUser(email, data) {
  const u = await auth.createUser({ email, password: PASSWORD });
  await db.doc(`users/${u.uid}`).set({
    roleIds: ["member"],
    accessVersion: 1,
    schemaVersion: 1,
    ...data,
  });
}
await makeUser("quantri@example.test", {
  enabled: true,
  canManageMembership: true,
  canReviewChanges: true,
});
await makeUser("thanhvien@example.test", { enabled: true });
await makeUser("choduyet@example.test", { enabled: false });
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

// Chạy trong trang: trả về các vi phạm cấu trúc/ngữ nghĩa (không phụ thuộc chiều rộng).
function structureCheck() {
  const out = [];
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
  };
  if (document.documentElement.lang !== "vi") out.push("html thiếu lang=vi");
  if (!document.title.trim()) out.push("title rỗng");
  const h = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis);
  const h1 = h.filter((e) => e.tagName === "H1").length;
  if (h1 !== 1) out.push(`số h1 = ${h1}`);
  let prev = 0;
  for (const e of h) {
    const lv = Number(e.tagName[1]);
    if (prev && lv > prev + 1)
      out.push(
        `heading nhảy cấp h${prev}→h${lv}: ${e.textContent.trim().slice(0, 30)}`,
      );
    prev = lv;
  }
  if (document.querySelectorAll("main").length !== 1)
    out.push("không có đúng một <main>");
  if (!document.querySelector("nav") && !document.querySelector("form"))
    out.push("không có <nav>");
  for (const img of document.querySelectorAll("img"))
    if (!img.hasAttribute("alt"))
      out.push("img thiếu alt: " + img.src.slice(-30));
  const name = (e) => {
    const by = e.getAttribute("aria-labelledby");
    if (by)
      return by
        .split(/\s+/)
        .map((i) => document.getElementById(i)?.textContent ?? "")
        .join(" ")
        .trim();
    return (
      e.getAttribute("aria-label") ||
      (e.labels && [...e.labels].map((l) => l.textContent).join(" ")) ||
      e.textContent ||
      e.getAttribute("title") ||
      ""
    ).trim();
  };
  for (const e of document.querySelectorAll("input,select,textarea")) {
    if (e.type === "hidden" || !vis(e)) continue;
    if (!name(e))
      out.push(
        `điều khiển không có nhãn: ${e.tagName.toLowerCase()}[${e.type}] name=${e.name || e.id}`,
      );
  }
  for (const e of document.querySelectorAll(
    "button,a[href],summary,[role=button]",
  )) {
    if (!vis(e)) continue;
    if (!name(e)) out.push(`${e.tagName.toLowerCase()} không có tên truy cập`);
    // Nhãn trong tên (2.5.3): aria-label phải chứa chữ hiển thị.
    const al = e.getAttribute("aria-label");
    const clone = e.cloneNode(true);
    clone.querySelectorAll("[aria-hidden=true]").forEach((n) => n.remove());
    const text = (clone.textContent || "").trim().toLowerCase();
    if (
      al &&
      text &&
      !al.toLowerCase().includes(text.replace(/\s+/g, " ").slice(0, 20))
    )
      out.push(
        `tên truy cập không chứa nhãn hiển thị: "${text.slice(0, 30)}" vs "${al.slice(0, 40)}"`,
      );
  }
  // id trùng
  const ids = new Map();
  for (const e of document.querySelectorAll("[id]"))
    ids.set(e.id, (ids.get(e.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) out.push(`id trùng: ${id}`);
  // bảng
  for (const t of document.querySelectorAll("table")) {
    if (
      !t.querySelector("caption") &&
      !t.getAttribute("aria-label") &&
      !t.getAttribute("aria-labelledby")
    )
      out.push("bảng không có caption/aria-label");
    if (
      ![...t.querySelectorAll("th")].every(
        (th) => th.getAttribute("scope") || th.closest("thead"),
      )
    )
      out.push("th thiếu scope");
  }
  // lỗi gắn với trường: input aria-invalid phải có describedby
  for (const e of document.querySelectorAll("[aria-invalid=true]"))
    if (
      !e.getAttribute("aria-describedby") &&
      !e.getAttribute("aria-errormessage")
    )
      out.push("trường lỗi thiếu aria-describedby");
  return out;
}

// Chạy trong trang: vùng bấm nhỏ. Link nằm giữa đoạn chữ (inline) được miễn theo 2.5.8.
function targetCheck() {
  const res = { lt24: [], lt44: [] };
  for (const e of document.querySelectorAll(
    "a[href],button,input,select,textarea,summary",
  )) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    if (r.width === 0 || r.height === 0 || s.visibility === "hidden") continue;
    if (e.type === "hidden") continue;
    // Checkbox/radio: vùng bấm gồm cả nhãn bọc quanh.
    let box = r;
    if ((e.type === "checkbox" || e.type === "radio") && e.labels?.[0]) {
      const lr = e.labels[0].getBoundingClientRect();
      box = lr.width * lr.height > r.width * r.height ? lr : r;
    }
    const para = e.closest("p");
    const inline =
      e.tagName === "A" &&
      s.display === "inline" &&
      !!para &&
      (para.textContent || "").trim().length >
        (e.textContent || "").trim().length + 3;
    const label = `${e.tagName.toLowerCase()}${e.type && e.tagName === "INPUT" ? "[" + e.type + "]" : ""}:${(e.getAttribute("aria-label") || e.textContent || e.name || "").trim().replace(/\s+/g, " ").slice(0, 32)} ${Math.round(box.width)}x${Math.round(box.height)}${inline ? " (inline)" : ""}`;
    if (inline) continue; // 2.5.8: liên kết giữa dòng chữ được miễn
    if (box.height < 24 || box.width < 24) res.lt24.push(label);
    else if ((box.height < 44 || box.width < 44) && !inline)
      res.lt44.push(label);
  }
  return res;
}

// Chạy trong trang: tương phản chữ thực tế (màu chữ so với nền gần nhất không trong suốt).
function contrastCheck() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) =>
      (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (e) => {
    let acc = { r: 255, g: 255, b: 255 };
    const layers = [];
    for (let n = e; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a === 1) break;
      }
    }
    for (const c of layers.reverse())
      acc = {
        r: c.r * c.a + acc.r * (1 - c.a),
        g: c.g * c.a + acc.g * (1 - c.a),
        b: c.b * c.a + acc.b * (1 - c.a),
      };
    return acc;
  };
  const bad = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const e = t.parentElement;
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    if (
      r.width === 0 ||
      s.visibility === "hidden" ||
      e.closest(":disabled,.sr-only,[aria-hidden=true]")
    )
      continue;
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = bgOf(e);
    const fgc = {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
    };
    const L1 = lum(fgc),
      L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      const key = `${e.tagName.toLowerCase()}.${e.className}: "${t.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}:1 (${s.fontSize})`;
      bad.set(key, 1);
    }
  }
  return [...bad.keys()];
}

// Tab qua trang: mọi phần tử focus phải có chỉ báo nhìn thấy và không bị cắt bởi vùng cuộn/ẩn của tổ tiên.
const tabStats = { pages: 0, stops: 0 };
async function tabCheck(page) {
  const out = [];
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  let last = null;
  let same = 0;
  const seen = new Set();
  let count = 0;
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const visibleOutline =
        s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
      const off = parseFloat(s.outlineOffset) || 0;
      const grow = (parseFloat(s.outlineWidth) || 0) + Math.max(off, 0);
      let clipped = false;
      for (
        let p = e.parentElement;
        p && p !== document.documentElement;
        p = p.parentElement
      ) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === "visible" && ps.overflowY === "visible") continue;
        const pr = p.getBoundingClientRect();
        if (r.left - grow < pr.left - 0.5 || r.right + grow > pr.right + 0.5)
          clipped = true;
      }
      return {
        key: `${e.tagName}|${e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 30) || e.name}|${Math.round(r.top + scrollY)}|${Math.round(r.left)}`,
        label: `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") || e.textContent || e.name || "").trim().slice(0, 30)}`,
        visibleOutline,
        clipped,
        offscreen: r.width === 0 || r.height === 0,
      };
    });
    if (!info) {
      if (count > 0 && seen.size > 0) break; // đã vòng ra chrome trình duyệt
      continue;
    }
    count++;
    if (info.key === last) {
      if (++same >= 3) {
        out.push("bẫy focus tại " + info.label);
        break;
      }
    } else same = 0;
    last = info.key;
    if (seen.has(info.key) && same === 0) break; // đã quay vòng
    seen.add(info.key);
    if (!info.visibleOutline) out.push("focus không thấy: " + info.label);
    if (info.clipped)
      out.push("focus có thể bị cắt bởi overflow: " + info.label);
    if (info.offscreen)
      out.push("focus vào phần tử không hiển thị: " + info.label);
  }
  return { out, count };
}

const report = []; // {scope, level: "lỗi"|"cảnh báo", msg}
const add = (scope, level, msg) => report.push({ scope, level, msg });
// Tương phản các cặp token trong style.css (tính từ giá trị hex, không phụ thuộc trình duyệt).
// Ngưỡng: chữ thường 4.5, viền điều khiển/focus 3.
const css = readFileSync(
  resolve(import.meta.dirname, "..", "src", "style.css"),
  "utf8",
);
const tok = Object.fromEntries(
  [...css.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
    m[1],
    m[2],
  ]),
);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const relLum = (h) => {
  const [r, g, b] = rgb(h).map((v) =>
    (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const tokenPairs = [];
const T = (n) => tok[n] ?? n; // cho phép truyền hex trực tiếp
const text = [
  "text",
  "text-muted",
  "primary",
  "primary-hover",
  "danger",
  "warning",
  "success",
];
const bgs = [
  "bg",
  "surface",
  "soft",
  "sidebar",
  "active",
  "story",
  "hero",
  "#fbf3dc",
  "#fbf7ea",
];
for (const f of text) for (const b of bgs) tokenPairs.push([f, b, 4.5, "chữ"]);
tokenPairs.push(
  ["surface", "primary", 4.5, "chữ nút chính"],
  ["surface", "primary-hover", 4.5, "chữ nút chính hover"],
  ["surface", "danger", 4.5, "chữ nút danger hover"],
);
for (const b of ["bg", "surface", "soft", "sidebar", "hero", "story"]) {
  tokenPairs.push(
    ["control-border", b, 3, "viền điều khiển"],
    ["focus", b, 3, "viền focus"],
    ["danger", b, 3, "viền danger"],
  );
}
for (const [f, b, min, what] of tokenPairs) {
  const r = ratio(T(f), T(b));
  if (r < min)
    add(
      "token màu",
      "lỗi",
      `${what}: ${f} (${T(f)}) trên ${b} (${T(b)}) = ${r.toFixed(2)}:1 < ${min}`,
    );
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
let failed = false;
try {
  const routes = {
    admin: [
      ["tong-quan", "/"],
      ["cay", "/tree"],
      ["ho-so", "/person/m"],
      ["tra-cuu", "/persons"],
      ["can-kiem-tra", "/review-queue"],
      ["de-xuat", "/changes"],
      ["hop-duyet", "/review"],
      ["tai-khoan", "/users"],
      ["nhat-ky", "/audit"],
      ["tien-do", "/roadmap"],
      ["khong-co", "/khong-ton-tai"],
      ["khong-co-con", "/person/m/x"],
    ],
    "thanh-vien": [
      ["tong-quan", "/"],
      ["cay", "/tree"],
      ["ho-so", "/person/m"],
      ["tra-cuu", "/persons"],
      ["can-kiem-tra", "/review-queue"],
      ["de-xuat", "/changes"],
      ["nhat-ky-bi-chan", "/audit"],
    ],
  };
  const pageErrors = [];
  async function newPage(width = 1280) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      locale: "vi-VN",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    return page;
  }
  async function auditPage(page, scope, shotName) {
    // Cấu trúc + tương phản + tab ở 1280
    await page.setViewportSize({ width: 1280, height: 900 });
    await sleep(500);
    for (const m of await page.evaluate(structureCheck)) add(scope, "lỗi", m);
    for (const m of await page.evaluate(contrastCheck))
      add(scope, "lỗi", "tương phản chữ: " + m);
    const tab = await tabCheck(page);
    tabStats.pages++;
    tabStats.stops += tab.count;
    for (const m of tab.out) add(scope, "lỗi", m);
    // Reflow / tràn ngang ở 320/360/768/1280
    for (const width of [320, 360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await sleep(200);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      if (over > 0) add(scope, "lỗi", `tràn ngang ${over}px ở ${width}px`);
      if (width === 360) {
        const t = await page.evaluate(targetCheck);
        for (const l of [...new Set(t.lt24)])
          add(scope, "lỗi", `vùng bấm <24px ở 360: ${l}`);
        for (const l of [...new Set(t.lt44)])
          add(scope, "cảnh báo", `vùng bấm <44px ở 360: ${l}`);
      }
      if (
        SHOT_DIR &&
        (scope.startsWith("quản trị") || scope.startsWith("chưa đăng nhập")) &&
        [360, 768, 1280].includes(width)
      )
        await page.screenshot({
          path: `${SHOT_DIR}/${LABEL}-${shotName}-${width}.png`,
          fullPage: true,
        });
    }
    // 1.4.4: chữ phóng 200% (mô phỏng bằng viewport 640 CSS px) và 1.4.10 đã đo ở 320.
    // 1.4.12: ép khoảng cách chữ rồi kiểm tràn và nội dung bị cắt.
    await page.setViewportSize({ width: 640, height: 900 });
    const style = await page.addStyleTag({
      content:
        "*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}p{margin-bottom:2em !important}",
    });
    await sleep(200);
    const sp = await page.evaluate(() => {
      const res = [];
      const over = document.documentElement.scrollWidth - innerWidth;
      if (over > 0) res.push(`tràn ngang ${over}px khi ép khoảng cách chữ`);
      for (const e of document.querySelectorAll("body *")) {
        const s = getComputedStyle(e);
        if (s.overflow === "visible" && s.overflowX === "visible") continue;
        if (
          e.closest(".users-table-wrap,.sr-only") ||
          e.classList.contains("sr-only")
        )
          continue; // bảng cuộn riêng; sr-only chủ ý cắt
        if (
          (s.overflowY === "hidden" || s.overflowY === "clip") &&
          e.scrollHeight > e.clientHeight + 1
        )
          res.push(
            `nội dung bị cắt dọc: ${e.tagName.toLowerCase()}.${e.className}`,
          );
        if (
          (s.overflowX === "hidden" || s.overflowX === "clip") &&
          e.scrollWidth > e.clientWidth + 1
        )
          res.push(
            `nội dung bị cắt ngang: ${e.tagName.toLowerCase()}.${e.className}`,
          );
      }
      return res;
    });
    for (const m of sp) add(scope, "lỗi", "1.4.12: " + m);
    await style.evaluate((n) => n.remove());
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  async function login(page, email) {
    await page.goto(URL);
    await page.getByLabel("Số điện thoại", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu").fill(PASSWORD);
    await page.getByRole("button", { name: "Đăng nhập →" }).click();
  }

  // Chưa đăng nhập
  {
    const page = await newPage();
    await page.goto(URL);
    await page.getByLabel("Số điện thoại", { exact: true }).waitFor();
    await auditPage(page, "chưa đăng nhập: đăng nhập", "dang-nhap");
    // Đăng nhập sai: thông báo lỗi bằng chữ, giữ email đã nhập.
    await page
      .getByLabel("Số điện thoại", { exact: true })
      .fill("sai@example.test");
    await page.getByLabel("Mật khẩu").fill("sai-mat-khau");
    await page.getByRole("button", { name: "Đăng nhập →" }).click();
    await page.getByRole("alert").waitFor();
    for (const m of await page.evaluate(structureCheck))
      add("đăng nhập sai", "lỗi", m);
    const kept = await page
      .getByLabel("Số điện thoại", { exact: true })
      .inputValue();
    if (kept !== "sai@example.test")
      add("đăng nhập sai", "lỗi", "không giữ email đã nhập");
    const inv = await page.evaluate(() =>
      document.querySelector("[name=login]").getAttribute("aria-invalid"),
    );
    const desc = await page.evaluate(() =>
      document.querySelector("[name=login]").getAttribute("aria-describedby"),
    );
    if (!desc && inv !== "true")
      add(
        "đăng nhập sai",
        "cảnh báo",
        "lỗi đăng nhập không gắn aria-describedby/aria-invalid vào trường",
      );
    await page.context().close();
  }
  // Chờ cấp quyền
  {
    const page = await newPage();
    await login(page, "choduyet@example.test");
    await page.getByText("Chờ cấp quyền").first().waitFor();
    await auditPage(page, "chờ cấp quyền", "cho-cap-quyen");
    await page.context().close();
  }
  for (const [who, email, label] of [
    ["admin", "quantri@example.test", "quản trị"],
    ["thanh-vien", "thanhvien@example.test", "thành viên"],
  ]) {
    const page = await newPage();
    await login(page, email);
    await page.getByRole("link", { name: "Cây gia phả" }).waitFor();
    // Skip link + title theo route
    for (const [shot, path] of routes[who]) {
      const scope = `${label} ${path}`;
      await page.goto(`${URL}/#${path}`);
      await sleep(900);
      if (shot === "tra-cuu") {
        await page.getByRole("button", { name: "Tìm kiếm" }).click();
        await sleep(800);
      }
      // Title phải khớp trang thật: 404/route bị chặn -> "Không tìm thấy trang"; route chính -> title bắt đầu bằng h1.
      {
        const h1 = (await page.locator("h1").first().innerText()).trim();
        const title = await page.title();
        const t = title.replace(/ · Gia phả$/, "");
        if (h1 === "Không tìm thấy trang" && t !== h1)
          add(scope, "lỗi", `h1 là 404 nhưng title="${title}"`);
        else if (!["/", "/person/m"].includes(path) && h1 !== t)
          add(scope, "lỗi", `title "${title}" không khớp h1 "${h1}"`);
        else if (path === "/person/m" && t !== "Hồ sơ thành viên")
          add(scope, "lỗi", `title hồ sơ sai: "${title}"`);
        else if (path === "/" && t !== "Tổng quan")
          add(scope, "lỗi", `title tổng quan sai: "${title}"`);
      }
      await auditPage(page, scope, shot);
    }
    // Trạng thái có panel/hộp xác nhận mở (chỉ quản trị): mở từng panel, kiểm rồi đóng bằng Hủy.
    if (who === "admin") {
      const panels = [
        ["sua", /^Sửa hồ sơ$/],
        ["them-con", /^Thêm con$/],
        ["doi-cha-me", /^Đặt hoặc đổi cha\/mẹ$/],
        ["them-vo-chong", /^Thêm vợ\/chồng$/],
        ["go-lien-ket", /^Gỡ liên kết vợ\/chồng với/],
        ["an-nguoi", /^Ẩn người này khỏi cây$/],
      ];
      for (const [shot, rx] of panels) {
        await page.goto(`${URL}/#/person/m`);
        await sleep(900);
        const open = page.getByRole("button", { name: rx }).first();
        if (!(await open.count())) {
          add(
            `panel ${shot}`,
            "cảnh báo",
            "không tìm thấy nút mở panel (bỏ qua)",
          );
          continue;
        }
        await open.click();
        await sleep(400);
        // Nhấn Lưu/Xác nhận khi trống để bật thông báo lỗi và kiểm cả trạng thái lỗi.
        const submit = page
          .getByRole("button", {
            name: /^(Lưu thay đổi|Lưu|Xác nhận gỡ liên kết)$/,
          })
          .first();
        if (await submit.count()) await submit.click().catch(() => {});
        await sleep(300);
        await auditPage(page, `quản trị panel ${shot}`, `panel-${shot}`);
        // Trả focus: sau khi Hủy, focus nên về nút mở (hoặc vùng hợp lý trong trang), không rơi về body.
        const cancel = page.getByRole("button", { name: /^Hủy$/ }).first();
        if (await cancel.count()) {
          await cancel.click();
          await sleep(300);
          const fo = await page.evaluate(
            () => document.activeElement === document.body,
          );
          if (fo)
            add(
              `quản trị panel ${shot}`,
              "cảnh báo",
              "sau khi Hủy focus rơi về body (mất vị trí)",
            );
        }
      }
    }
    // title phải khác nhau giữa các route chính
    const titles = new Set();
    for (const [, path] of routes[who].slice(0, 5)) {
      await page.goto(`${URL}/#${path}`);
      await sleep(400);
      titles.add(await page.title());
    }
    if (titles.size < 3)
      add(
        `${label} title`,
        "lỗi",
        `title không đổi theo route (${[...titles].join(" | ")})`,
      );
    // Skip link: Tab đầu tiên phải là link đến nội dung chính
    await page.goto(`${URL}/#/`);
    await page.reload();
    await page.getByRole("link", { name: "Cây gia phả" }).waitFor();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => {
      const e = document.activeElement;
      return e
        ? `${e.tagName}|${(e.textContent || "").trim().slice(0, 40)}|${e.getAttribute("href")}`
        : "";
    });
    if (!/Bỏ qua/i.test(first))
      add(
        `${label} skip link`,
        "lỗi",
        "Tab đầu tiên không phải skip link: " + first,
      );
    await page.context().close();
  }
  if (pageErrors.length)
    add("toàn bộ", "lỗi", "pageerror: " + pageErrors.join("; "));
} catch (error) {
  failed = true;
  console.error("THẤT BẠI:", error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
// Gộp các dòng giống nhau giữa nhiều route để báo cáo gọn.
const grouped = new Map();
for (const r of report) {
  const k = `${r.level}|${r.msg}`;
  if (!grouped.has(k)) grouped.set(k, []);
  grouped.get(k).push(r.scope);
}
const errs = [...grouped].filter(([k]) => k.startsWith("lỗi"));
const warns = [...grouped].filter(([k]) => k.startsWith("cảnh báo"));
console.log(`\n=== ui-standards-audit (${LABEL}) ===`);
for (const [k, scopes] of [...errs, ...warns])
  console.log(
    `[${k.split("|")[0]}] ${k.split("|").slice(1).join("|")}\n    tại: ${scopes.length > 6 ? scopes.slice(0, 6).join("; ") + `; … (+${scopes.length - 6})` : scopes.join("; ")}`,
  );
console.log(
  `\nTổng: ${errs.length} nhóm lỗi, ${warns.length} nhóm cảnh báo (${report.length} dòng thô).`,
);
console.log(
  `Đã kiểm tra: ${tabStats.pages} trang/trạng thái, tổng ${tabStats.stops} điểm dừng Tab.`,
);
process.exit(failed || errs.length ? 1 : 0);
