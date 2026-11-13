// Kiểm tra trình duyệt cho trang "Nhật ký chỉnh sửa" (#/audit), chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/audit-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong. Nhật ký giả được ghi bằng Admin SDK
// (bỏ qua rules) nên không cần khớp mọi ràng buộc của auditCreateOk; việc rules cho đọc đã có test riêng.
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
const PORT = 5198;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const LATEST = 45;
const GAP = 30;
const SECRET = "BÍ-MẬT-GHI-CHÚ-GIẢ";
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927;d=1973|",
  "P|b|Giả Thị Bình|F|CLAN|II|I|b=1930|",
  "K|ts|-|a,b",
  "B|I|Chi Một|ts||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "audit-browser-fake");

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore, Timestamp } = requireAdmin("firebase-admin/firestore");
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
const adminUid = await account("quantri@example.test", {
  canManageMembership: true,
  displayName: "Quản Trị Giả",
});
await account("thanhvien@example.test", {});
const oldUid = await account("cu@example.test", {
  enabled: false,
  displayName: "Người Cũ Giả",
});
const GHOST = "ghostuid1234567890";
for (const d of plan.docs) await db.doc(d.path).set(d.data);
await db.doc("treeSnapshots/main").update({ editVersion: LATEST });

// 45 bản ghi: #45 chứa dữ liệu "độc" và ghi chú; #44 ẩn người không còn trong cây; #30 bị thiếu (gap giả).
const at = (v) => Timestamp.fromDate(new Date(Date.UTC(2026, 10, 10, 7, v)));
function audit(v) {
  const common = {
    actorUid: v <= 10 ? oldUid : v === 20 ? GHOST : adminUid,
    editVersion: v,
    timestamp: at(v),
    schemaVersion: 1,
    fields: [],
    before: {},
    after: {},
  };
  if (v === 45)
    return {
      ...common,
      event: "PERSON_EDITED",
      personId: "a",
      target: "persons/a",
      fields: ["name", "note", "birthYear"],
      before: {
        name: "Giả Văn An",
        note: SECRET,
        birthYear: 1927,
        birth: {
          calendar: "SOLAR",
          year: 1927,
          month: 3,
          day: 15,
          precision: "DAY",
        },
      },
      after: {
        name: "<script>window.__xss=1</script>" + "Â".repeat(300),
        note: SECRET + "2",
        birthYear: 1928,
        birth: {
          calendar: "SOLAR",
          year: 1928,
          month: 3,
          day: 15,
          precision: "DAY",
        },
      },
    };
  if (v === 44)
    return {
      ...common,
      event: "PERSON_DELETED",
      personId: "gone",
      target: "persons/gone",
      before: {
        rows: JSON.stringify({
          person: ["Người Đã Ẩn Giả", 1950, null, 3, "C", null, []],
          relations: [["a", "gone", "F", "B", 1]],
          union: null,
          moreUnions: [],
        }),
      },
      after: { deleted: true },
    };
  if (v === 43)
    return {
      ...common,
      event: "SPOUSE_ADDED",
      personId: "a",
      target: "persons/a",
      createdPersonIds: [],
      unionId: "u-a-b",
      after: { spouseId: "b", newPerson: false, order: "1" },
    };
  if (v === 42)
    return {
      ...common,
      event: "PERSON_EDITED",
      personId: "bad/id",
      target: "persons/bad",
    };
  return {
    ...common,
    event: "PERSON_EDITED",
    personId: v % 2 ? "a" : "b",
    target: `persons/${v % 2 ? "a" : "b"}`,
    fields: ["name"],
    before: { name: "Tên cũ " + v },
    after: { name: "Tên mới " + v },
  };
}
for (let v = 1; v <= LATEST; v++)
  if (v !== GAP) await db.doc(`auditLogs/edit-${v}`).set(audit(v));

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
const noOverflow = async (page, label) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    if (over > 0) throw Error(`${label}: tràn ngang ${over}px ở ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
};
try {
  stage = "thành viên thường không thấy menu, #/audit ra Không tìm thấy trang";
  const memberCtx = await browser.newContext();
  const m = await memberCtx.newPage();
  await login(m, "thanhvien@example.test");
  await expect(m.getByRole("link", { name: "Nhật ký chỉnh sửa" })).toHaveCount(
    0,
  );
  await m.goto(`${URL}/#/audit`);
  await expect(
    m.getByRole("heading", { name: "Không tìm thấy trang" }),
  ).toBeVisible();
  await expect(
    m.getByRole("heading", { name: "Nhật ký chỉnh sửa" }),
  ).toHaveCount(0);
  await memberCtx.close();

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push("console: " + msg.text());
  });
  await login(page, "quantri@example.test");

  stage = "admin thấy menu và mở được trang";
  await page.getByRole("link", { name: "Nhật ký chỉnh sửa" }).click();
  await expect(
    page.getByRole("heading", { name: "Nhật ký chỉnh sửa", level: 1 }),
  ).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(20);
  await expect(rows.first().getByRole("rowheader")).toHaveText(`#${LATEST}`);
  await expect(
    page.locator(".audit-status").filter({ hasText: /^Đã tải 20\/45/ }),
  ).toBeVisible();

  stage =
    "dữ liệu độc chỉ là text, ghi chú không lộ, ngày đầy đủ chỉ ở Chi tiết";
  await expect(
    page.getByText("<script>window.__xss=1</script>").first(),
  ).toBeVisible();
  if ((await page.evaluate(() => globalThis.__xss)) !== undefined)
    throw Error("Đã chạy mã từ dữ liệu nhật ký");
  const body = await page.locator("body").innerText();
  if (body.includes(SECRET)) throw Error("Lộ nguyên văn ghi chú riêng");
  if (!body.includes("Ghi chú: đã thay đổi"))
    throw Error("Thiếu dòng ghi chú đã thay đổi");
  if (body.includes("Â".repeat(250))) throw Error("Chuỗi dài chưa bị cắt");
  await expect(page.getByText("Năm sinh: 1927 → 1928")).toBeVisible();
  await expect(page.getByText("15/3/1928")).toBeHidden();
  await rows.first().getByText("Chi tiết").click();
  await expect(page.getByText(/Ngày sinh đầy đủ: .*15\/3\/1928/)).toBeVisible();
  await expect(page.getByText("Mã bản ghi: auditLogs/edit-45")).toBeVisible();

  stage = "người thực hiện, người ẩn, mã người lạ";
  await expect(page.getByText("Quản Trị Giả").first()).toBeVisible();
  await expect(page.getByText("ghos…7890")).toHaveCount(0); // bản #20 chưa tải
  await expect(page.getByText("mã người không hợp lệ").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Người Đã Ẩn Giả" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Người Đã Ẩn Giả").first()).toBeVisible();
  await expect(page.getByText("(đã ẩn)").first()).toBeVisible();
  await expect(
    rows.first().getByRole("link", { name: "Giả Văn An" }),
  ).toHaveAttribute("href", "#/person/a");

  stage = "lọc theo sự kiện và theo mã/tên trong các bản đã tải";
  await page.getByLabel("Sự kiện").selectOption("PERSON_DELETED");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("rowheader")).toHaveText("#44");
  await expect(
    page.locator(".audit-status").filter({
      hasText: /Bộ lọc chỉ áp dụng trong 20 bản đã tải; hiện 1 bản/,
    }),
  ).toBeVisible();
  await page.getByLabel("Sự kiện").selectOption("");
  await page.getByLabel("Mã hoặc tên người").fill("nguoi da an");
  await expect(rows).toHaveCount(1);
  await page.getByLabel("Mã hoặc tên người").fill("gone");
  await expect(rows).toHaveCount(1);
  await page.getByLabel("Mã hoặc tên người").fill("zzzz-khong-co");
  await expect(
    page.getByText("Không có bản ghi nào khớp bộ lọc trong các bản đã tải."),
  ).toBeVisible();
  await page.getByLabel("Mã hoặc tên người").fill("");
  await expect(rows).toHaveCount(20);

  stage = "bố cục không tràn ngang ở 360/768/1280";
  await noOverflow(page, "bảng nhật ký");
  if (process.env.SHOT_DIR)
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 1400 });
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/audit-${width}.png`,
        fullPage: true,
      });
    }
  await page.setViewportSize({ width: 360, height: 900 });
  const scrolls = await page
    .locator(".users-table-wrap")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  if (!scrolls) throw Error("Bảng phải cuộn ngang trong vùng riêng ở 360px");
  await page.setViewportSize({ width: 1280, height: 900 });

  stage = "Xem thêm, bản thiếu hiện dòng báo, người thu hồi và uid lạ";
  await page.getByRole("button", { name: "Xem thêm 20 bản cũ hơn" }).click();
  await expect(rows).toHaveCount(40);
  await expect(
    page.getByText(
      `Không đọc được bản ghi #${GAP} (thiếu hoặc ngoài phạm vi).`,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xem thêm 5 bản cũ hơn" }).click();
  await expect(rows).toHaveCount(45);
  await expect(page.getByText("Đã tải tới bản cũ nhất (#1).")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Xem thêm/ })).toHaveCount(0);
  await expect(page.getByText("ghos…7890")).toBeVisible();
  await expect(page.getByText("Người Cũ Giả").first()).toBeVisible();
  await expect(page.getByText("(đã thu hồi)").first()).toBeVisible();
  // Có bản thiếu thì không báo mất quyền.
  await expect(
    page.getByText("Không đọc được nhật ký: tài khoản đã mất quyền"),
  ).toHaveCount(0);
  await noOverflow(page, "bảng đủ 45 dòng");

  stage = "Tải toàn bộ có ghi rõ số lượt đọc";
  await page.getByRole("button", { name: "Tải lại nhật ký" }).click();
  await expect(rows).toHaveCount(20);
  const all = page.getByRole("button", { name: /^Tải toàn bộ/ });
  await expect(page.getByText(/Mỗi bản là một lượt đọc/)).toBeVisible();
  await all.click();
  await expect(rows).toHaveCount(45);

  stage = "chưa có chỉnh sửa nào (editVersion = 0)";
  await db.doc("treeSnapshots/main").update({ editVersion: 0 });
  await page.reload();
  await expect(
    page.getByText("Chưa có lần chỉnh sửa nào trong ứng dụng."),
  ).toBeVisible();

  stage = "cả loạt bị từ chối thì báo mất quyền và dừng";
  await db.doc("treeSnapshots/main").update({ editVersion: 80 });
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Không đọc được nhật ký: tài khoản đã mất quyền" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Xem thêm/ })).toHaveCount(0);

  const real = problems.filter(
    (p) => !/permission|PERMISSION_DENIED|Missing or insufficient/i.test(p),
  );
  if (real.length) throw Error("Lỗi trang/console: " + real.join(" | "));
  console.log(
    "Kiểm tra trình duyệt trang nhật ký: ĐẠT",
    problems.length
      ? `(bỏ qua ${problems.length} dòng console do từ chối quyền có chủ ý)`
      : "",
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
