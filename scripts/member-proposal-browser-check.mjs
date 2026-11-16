// Kiểm tra trình duyệt cho giao diện THÀNH VIÊN của "đề xuất thêm thành viên" (docs/MEMBER_PROPOSALS.md),
// chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... [SHOT_DIR=thư_mục] npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/member-proposal-browser-check.mjs"
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
const PORT = 5210;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927;d=1973|",
  "P|b|Giả Thị Bình|F|CLAN|II|I|b=1930|",
  "K|ts|-|a,b",
  "B|I|Chi Một|ts||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "member-proposal-fake");

const requireAdmin = createRequire(
  resolve(import.meta.dirname, "..", "functions", "package.json"),
);
const { initializeApp } = requireAdmin("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = requireAdmin(
  "firebase-admin/firestore",
);
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
const adminUid = await account("quantri-dx@example.test", {
  canManageMembership: true,
});
await db.doc("accessControl/admins").set({
  adminUids: [adminUid],
  version: 1,
  lastTargetUid: "",
  schemaVersion: 1,
});
const m1 = await account("thanhvien1-dx@example.test", {});
await account("thanhvien2-dx@example.test", {});
const m3 = await account("thanhvien3-dx@example.test", {});
const m4 = await account("thanhvien4-dx@example.test", {});
const m5 = await account("thanhvien5-dx@example.test", {});
const m6 = await account("thanhvien6-dx@example.test", {});
for (const d of plan.docs) await db.doc(d.path).set(d.data);

// Dựng đề xuất giả bằng Admin SDK (bỏ qua rules) để thử các trạng thái do quản trị viên đặt.
async function seedProposal(id, authorUid, status, extra = {}) {
  await db.doc(`memberProposals/${id}`).set({
    schemaVersion: 1,
    kind: "CHILD",
    anchorId: "a",
    newId: id,
    payload: {
      name: "Giả Con Cũ",
      sex: "M",
      birthYear: 1990,
      deathYear: null,
      deceased: false,
      note: "ghi chú cũ",
      role: "FATHER",
      otherParentId: null,
      adoptive: false,
      category: "CLAN",
      branch: "I",
    },
    source: "nguồn cũ",
    status,
    authorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  });
}
// Người thứ ba đã đủ 5 đề xuất chờ duyệt.
for (let i = 0; i < 5; i++)
  await seedProposal(`p-fullfull${String(i).padStart(4, "0")}`, m3, "PENDING");
await seedProposal("p-needinfo0001", m4, "NEEDS_INFO", {
  infoRequestedBy: adminUid,
  infoRequestReason: "Cần ghi rõ năm sinh theo sổ hộ khẩu.",
});
await seedProposal("p-rejected0001", m5, "REJECTED", {
  decidedBy: adminUid,
  decisionReason: "Trùng với người đã có trong cây.",
});

const snapshotVersion = (await db.doc("treeSnapshots/main").get()).data()
  .editVersion;
// Đề xuất chờ duyệt để thử rút khi quản trị viên vừa xử lý xong.
await seedProposal("p-stale0000001", m6, "PENDING");
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
const pageErrors = [];
async function login(page, email) {
  await page.goto(URL);
  await page.getByLabel("Số điện thoại", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
  await expect(page.getByRole("link", { name: "Cây gia phả" })).toBeVisible();
}
async function newPage(email) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page, email);
  return { ctx, page };
}
async function noOverflow(page, label) {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    if (overflow > 0)
      throw Error(`Tràn ngang ${overflow}px ở ${width}px (${label})`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function shots(page, name) {
  if (!process.env.SHOT_DIR) return;
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 1400 });
    await page.screenshot({
      path: `${process.env.SHOT_DIR}/${name}-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
const proposalsOf = async (uid) =>
  (await db.collection("memberProposals").where("authorUid", "==", uid).get())
    .docs;

try {
  stage = "admin does not see propose buttons or the menu entry";
  const admin = await newPage("quantri-dx@example.test");
  await admin.page.goto(`${URL}/#/person/a`);
  await expect(
    admin.page.getByRole("heading", { name: "Giả Văn An", level: 1 }),
  ).toBeVisible();
  await expect(
    admin.page.getByRole("button", { name: "Thêm con", exact: true }),
  ).toBeVisible();
  // Biểu mẫu quản trị viên (dùng chung phần nhập) vẫn đúng: chụp để đối chiếu bố cục, không đổi hành vi.
  await admin.page
    .getByRole("button", { name: "Thêm con", exact: true })
    .click();
  await expect(
    admin.page.getByRole("heading", { name: "Thêm con" }),
  ).toBeVisible();
  await expect(admin.page.getByLabel(/^Nguồn\/căn cứ/)).toHaveCount(0);
  await shots(admin.page, "admin-add-form");
  await noOverflow(admin.page, "biểu mẫu thêm con của quản trị viên");
  await admin.page.getByRole("button", { name: "Hủy" }).click();
  await expect(
    admin.page.getByRole("button", { name: /^Đề xuất/ }),
  ).toHaveCount(0);
  await expect(
    admin.page.getByRole("link", { name: "Đề xuất của tôi" }),
  ).toHaveCount(0);
  await admin.page.goto(`${URL}/#/my-proposals`);
  await expect(admin.page).toHaveURL(/#\/$/);
  await admin.ctx.close();

  stage = "member sees propose buttons, form shows note label and source field";
  const m = await newPage("thanhvien1-dx@example.test");
  const page = m.page;
  // Đếm yêu cầu tới emulator Firestore có nhắc memberProposals (xem hồ sơ không được tự tải danh sách đề xuất).
  let proposalReads = 0;
  page.on("request", (rq) => {
    if (
      rq.url().includes(":8080") &&
      (rq.postData() ?? "").includes("memberProposals")
    )
      proposalReads++;
  });
  await expect(
    page.getByRole("link", { name: "Đề xuất của tôi" }),
  ).toBeVisible();
  await page.goto(`${URL}/#/person/a`);
  await expect(
    page.getByRole("heading", { name: "Giả Văn An", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sửa hồ sơ" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Thêm con", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Đề xuất thêm vợ/chồng" }),
  ).toBeVisible();
  await sleep(1500);
  if (proposalReads !== 0)
    throw Error(
      `Xem hồ sơ không được truy vấn memberProposals (${proposalReads} yêu cầu)`,
    );
  await page.getByRole("button", { name: "Đề xuất thêm con" }).click();
  await expect(
    page.getByRole("heading", { name: "Đề xuất thêm con" }),
  ).toBeVisible();
  if (proposalReads === 0)
    throw Error(
      "Mở biểu mẫu phải tải danh sách đề xuất (đối chứng bộ đếm yêu cầu)",
    );
  await expect(
    page.getByRole("heading", { name: "Đề xuất thêm con" }),
  ).toBeVisible();
  await expect(page.getByLabel(/^Ghi chú \(mọi thành viên/)).toBeVisible();
  await expect(
    page.getByLabel(/^Nguồn\/căn cứ \(không bắt buộc\)/),
  ).toBeVisible();

  stage = "validation error keeps input";
  await page.getByLabel("Họ tên (bắt buộc)").fill("Giả Văn Mới");
  await page.getByRole("button", { name: "Gửi đề xuất" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "cha hay mẹ" }),
  ).toBeVisible();
  await expect(page.getByLabel("Họ tên (bắt buộc)")).toHaveValue("Giả Văn Mới");

  stage = "submit child proposal";
  await page.getByLabel("Cha của đứa trẻ").check();
  await page.getByRole("textbox", { name: /^Năm sinh/ }).fill("1995");
  await page
    .getByLabel(/^Ghi chú \(mọi thành viên/)
    .fill("ghi chú đề xuất giả");
  await page
    .getByLabel(/^Nguồn\/căn cứ \(không bắt buộc\)/)
    .fill("Theo lời kể của người nhà (giả)");
  await shots(page, "member-proposal-form");
  await noOverflow(page, "biểu mẫu đề xuất");
  await page.getByRole("button", { name: "Gửi đề xuất" }).click();
  await expect(page.getByText("Đã gửi đề xuất.")).toBeVisible();
  await expect(page.getByText("Đã gửi đề xuất.")).toBeFocused();
  let docs = await proposalsOf(m1);
  if (docs.length !== 1) throw Error("Phải có đúng 1 đề xuất");
  const first = docs[0].data();
  if (first.status !== "PENDING" || first.kind !== "CHILD")
    throw Error("Đề xuất chưa ở trạng thái CHỜ DUYỆT");
  if (first.source !== "Theo lời kể của người nhà (giả)")
    throw Error("Thiếu nguồn/căn cứ");
  if ((await db.doc(`persons/${docs[0].id}`).get()).exists)
    throw Error("Đề xuất không được ghi vào dữ liệu chính");
  if (
    (await db.doc("treeSnapshots/main").get()).data().editVersion !==
    snapshotVersion
  )
    throw Error("Snapshot không được đổi khi mới đề xuất");

  stage = "second proposal right away is blocked with a countdown";
  await page.getByRole("button", { name: "Đề xuất thêm vợ/chồng" }).click();
  await expect(page.getByText(/Vừa gửi một đề xuất\./)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Gửi đề xuất" }),
  ).toBeDisabled();
  // Chế độ đề xuất không có lựa chọn "nối người đã có".
  await expect(page.getByLabel("Người đã có trong cây")).toHaveCount(0);
  await page.getByRole("button", { name: "Hủy" }).click();

  stage = "my proposals list shows pending with text status";
  await page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await expect(
    page.getByRole("heading", { name: "Đề xuất của tôi", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("pending-count")).toHaveText(
    "Đang chờ duyệt: 1/5",
  );
  await expect(page.getByText("CHỜ DUYỆT", { exact: true })).toBeVisible();
  await expect(page.getByText("Thêm con: Giả Văn Mới")).toBeVisible();
  await expect(page.getByText("Theo lời kể của người nhà (giả)")).toBeVisible();
  await shots(page, "member-proposal-list");
  await noOverflow(page, "danh sách đề xuất");

  stage = "server throttle rejection is shown in friendly words after reload";
  await page.reload();
  await page.goto(`${URL}/#/person/a`);
  // Đặt lastAt = bây giờ ngay trước khi kiểm, để không phụ thuộc tốc độ máy chạy (cửa sổ 60 giây thật).
  await db.doc(`proposalThrottle/${m1}`).set({
    lastAt: Timestamp.now(),
    lastProposalId: docs[0].id,
    schemaVersion: 1,
  });
  await page.getByRole("button", { name: "Đề xuất thêm vợ/chồng" }).click();
  await expect(page.getByText(/vừa gửi một đề xuất gần đây/)).toBeVisible();
  await page.getByLabel("Họ tên (bắt buộc)").fill("Giả Thị Dâu");
  await page.getByRole("button", { name: "Gửi đề xuất" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "cách nhau ít nhất 60 giây" }),
  ).toBeVisible();
  if ((await proposalsOf(m1)).length !== 1)
    throw Error("Đề xuất bị throttle không được ghi");
  await page.getByRole("button", { name: "Hủy" }).click();

  stage = "withdraw with confirmation";
  await page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await page.getByRole("button", { name: "Rút lại" }).click();
  await expect(page.getByText(/Rút đề xuất này\?/)).toBeVisible();
  await page.getByRole("button", { name: "Không rút" }).click();
  await expect(page.getByRole("button", { name: "Rút lại" })).toBeFocused();
  await expect(page.getByText("CHỜ DUYỆT", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rút lại" }).click();
  await page.getByRole("button", { name: "Xác nhận rút" }).click();
  await expect(page.getByText("Đã rút đề xuất.")).toBeFocused();
  await expect(page.getByText("ĐÃ RÚT", { exact: true })).toBeVisible();
  await expect(page.getByTestId("pending-count")).toHaveText(
    "Đang chờ duyệt: 0/5",
  );
  await expect(page.getByRole("button", { name: "Rút lại" })).toHaveCount(0);
  docs = await proposalsOf(m1);
  if (docs[0].data().status !== "WITHDRAWN") throw Error("Chưa rút trong DB");
  await m.ctx.close();

  stage =
    "withdraw after admin already decided: friendly message, list reloads";
  const st = await newPage("thanhvien6-dx@example.test");
  await st.page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await st.page.getByRole("button", { name: "Rút lại" }).click();
  await expect(
    st.page.getByRole("button", { name: "Xác nhận rút" }),
  ).toBeFocused();
  await db.doc("memberProposals/p-stale0000001").update({
    status: "REJECTED",
    decisionReason: "Đã xử lý (giả).",
    decidedBy: adminUid,
  });
  await st.page.getByRole("button", { name: "Xác nhận rút" }).click();
  await expect(
    st.page
      .getByRole("alert")
      .filter({ hasText: "đã được quản trị viên xử lý" }),
  ).toBeVisible();
  await expect(
    st.page.getByRole("alert").filter({ hasText: "60 giây" }),
  ).toHaveCount(0);
  await expect(st.page.getByText("TỪ CHỐI", { exact: true })).toBeVisible();
  // Gửi lại với mã đề xuất gốc không có: báo rõ, không mở form trống âm thầm.
  await st.page.goto(`${URL}/#/person/a?propose=child&resubmit=p-khongco00001`);
  await expect(
    st.page.getByText(/Không tìm thấy đề xuất gốc để điền sẵn/),
  ).toBeVisible();
  await st.ctx.close();

  stage = "another member does not see this member's proposals";
  const o = await newPage("thanhvien2-dx@example.test");
  await o.page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await expect(o.page.getByText("Bạn chưa gửi đề xuất nào.")).toBeVisible();
  await expect(o.page.getByText("Giả Văn Mới")).toHaveCount(0);
  await o.ctx.close();

  stage = "five pending proposals block a new one";
  const f = await newPage("thanhvien3-dx@example.test");
  await f.page.goto(`${URL}/#/person/a`);
  await f.page.getByRole("button", { name: "Đề xuất thêm con" }).click();
  await expect(f.page.getByText(/5\/5 đề xuất chờ duyệt/)).toBeVisible();
  await expect(
    f.page.getByRole("button", { name: "Gửi đề xuất" }),
  ).toBeDisabled();
  await shots(f.page, "member-proposal-full");
  await f.ctx.close();

  stage = "resubmit after NEEDS_INFO prefills and withdraws the old one";
  const n = await newPage("thanhvien4-dx@example.test");
  await n.page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await expect(n.page.getByText("CẦN BỔ SUNG", { exact: true })).toBeVisible();
  await expect(
    n.page.getByText("Cần ghi rõ năm sinh theo sổ hộ khẩu."),
  ).toBeVisible();
  await n.page.getByRole("link", { name: "Gửi lại (điền sẵn)" }).click();
  await expect(
    n.page.getByRole("heading", { name: "Đề xuất thêm con" }),
  ).toBeVisible();
  await expect(n.page.getByLabel("Họ tên (bắt buộc)")).toHaveValue(
    "Giả Con Cũ",
  );
  await expect(n.page.getByLabel(/^Nguồn\/căn cứ/)).toHaveValue("nguồn cũ");
  await n.page.getByRole("textbox", { name: /^Năm sinh/ }).fill("1991");
  await n.page.getByRole("button", { name: "Gửi đề xuất" }).click();
  await expect(n.page.getByText("Đã gửi đề xuất.")).toBeVisible();
  const nd = await proposalsOf(m4);
  const old = nd.find((d) => d.id === "p-needinfo0001").data();
  const fresh = nd.find((d) => d.id !== "p-needinfo0001").data();
  if (old.status !== "WITHDRAWN") throw Error("Đề xuất cũ phải được rút");
  if (fresh.resubmitOf !== "p-needinfo0001" || fresh.payload.birthYear !== 1991)
    throw Error("Đề xuất mới phải liên kết resubmitOf và có nội dung đã sửa");
  await n.ctx.close();

  stage = "resubmit after REJECTED keeps the rejected record";
  const r = await newPage("thanhvien5-dx@example.test");
  await r.page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await expect(r.page.getByText("TỪ CHỐI", { exact: true })).toBeVisible();
  await expect(
    r.page.getByText("Lý do từ chối: Trùng với người đã có trong cây."),
  ).toBeVisible();
  await expect(r.page.getByRole("button", { name: "Rút lại" })).toHaveCount(0);
  await r.page.getByRole("link", { name: "Gửi lại (điền sẵn)" }).click();
  await r.page.getByRole("button", { name: "Gửi đề xuất" }).click();
  await expect(r.page.getByText("Đã gửi đề xuất.")).toBeVisible();
  const rd = await proposalsOf(m5);
  if (rd.find((d) => d.id === "p-rejected0001").data().status !== "REJECTED")
    throw Error("Đề xuất bị từ chối phải giữ nguyên");
  if (rd.length !== 2) throw Error("Phải có thêm đề xuất mới");
  await r.ctx.close();

  if (pageErrors.length) throw Error("Lỗi trang: " + pageErrors.join("; "));
  console.log("Kiểm tra trình duyệt đề xuất của thành viên: ĐẠT");
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
