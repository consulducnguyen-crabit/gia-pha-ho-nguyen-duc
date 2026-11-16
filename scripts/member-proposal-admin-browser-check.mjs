// Kiểm tra trình duyệt cho giao diện QUẢN TRỊ VIÊN duyệt "đề xuất thêm thành viên" (docs/MEMBER_PROPOSALS.md, PR3),
// hai vai (thành viên + quản trị viên), chỉ dùng DỮ LIỆU GIẢ trên emulator cục bộ.
// Chạy: CHROMIUM_PATH=... [SHOT_DIR=thư_mục] npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
//         "node scripts/member-proposal-admin-browser-check.mjs"
// Script tự khởi động Vite (VITE_USE_EMULATORS=true) và dừng khi xong. Đề xuất giả được dựng bằng Admin SDK (bỏ qua
// rules); một đề xuất được gửi thật qua giao diện thành viên để phủ luồng đầu-cuối.
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
const PORT = 5211;
const URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = "Demo-only-2026!";
const source = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn An|M|CLAN|II|I|b=1927;d=1973|",
  "P|b|Giả Thị Bình|F|CLAN|II|I|b=1930|",
  "P|c1|Giả Văn Con|M|CLAN|III|I|b=1960|",
  "P|w|Trần Thị Vợ Một|F|SPOUSE|||b=1930|",
  "K|ts|-|a,b",
  "K|a|-|c1",
  "U|a|w|1||",
  "B|I|Chi Một|ts||",
].join("\n");
const plan = buildImportPlan(parseDsl(source), "member-proposal-admin-fake");

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
const adminUid = await account("quantri-dxa@example.test", {
  canManageMembership: true,
  displayName: "Quản Trị Giả",
});
await db.doc("accessControl/admins").set({
  adminUids: [adminUid],
  version: 1,
  lastTargetUid: "",
  schemaVersion: 1,
});
const m1 = await account("thanhvien1-dxa@example.test", {
  displayName: "Thành Viên Một",
});
const m2 = await account("thanhvien2-dxa@example.test", {
  displayName: "Thành Viên Hai",
});
const m3 = await account("thanhvien3-dxa@example.test", {
  displayName: "Thành Viên Ba",
});
const m4 = await account("thanhvien4-dxa@example.test", {
  displayName: "Thành Viên Bốn",
});
const m5 = await account("thanhvien5-dxa@example.test", {
  displayName: "Thành Viên Năm",
});
const GHOST = "ghostauthor12345678"; // tác giả không còn hồ sơ tài khoản
for (const d of plan.docs) await db.doc(d.path).set(d.data);

const payloadChild = (name, extra = {}) => ({
  name,
  sex: "M",
  birthYear: 1990,
  deathYear: null,
  deceased: false,
  note: "ghi chú giả",
  role: "FATHER",
  otherParentId: null,
  adoptive: false,
  category: "CLAN",
  branch: "I",
  ...extra,
});
async function seed(id, authorUid, over = {}) {
  await db.doc(`memberProposals/${id}`).set({
    schemaVersion: 1,
    kind: "CHILD",
    anchorId: "a",
    newId: id,
    payload: payloadChild("Giả Con Mẫu"),
    source: "nguồn giả",
    status: "PENDING",
    authorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...over,
  });
  await sleep(30); // createdAt khác nhau để thứ tự "cũ nhất trước" ổn định
}
const P_ASK = "p-askmore00001";
const P_REJ = "p-rejectme0001";
const P_OWN = "p-ownprop00001";
const P_HID = "p-hiddenanc001";
const P_SPO = "p-spouseprop01";
const P_OTH = "p-otherchild01";
const P_FRG = "p-forgedresub1";
await seed(P_ASK, m2, { payload: payloadChild("Giả Con Bổ Sung") });
await seed(P_REJ, m3, { payload: payloadChild("Giả Con Bị Loại") });
await seed(P_OWN, adminUid, { payload: payloadChild("Giả Con Của Admin") });
await seed(P_HID, m4, {
  anchorId: "b",
  payload: payloadChild("Giả Con Của Bình", {
      role: "MOTHER",
      category: "EXTERNAL",
      branch: null,
    }),
});
await seed(P_SPO, GHOST, {
  kind: "SPOUSE",
  payload: {
    name: "Trần Thị Vợ",
    sex: "F",
    birthYear: 1932,
    deathYear: null,
    deceased: false,
    note: "",
    category: "SPOUSE",
    order: "1",
  },
});
await seed(P_OTH, m5, { payload: payloadChild("Giả Văn Khác") });
// Gửi lại GIẢ: resubmitOf trỏ tới đề xuất của người khác (rules không kiểm) -> giao diện không được tin.
await seed(P_FRG, m5, {
  payload: payloadChild("Giả Văn Gửi Lại Giả"),
  resubmitOf: P_REJ,
});

// Đề xuất có cha/mẹ còn lại (vợ hiện có của a): dùng cho kịch bản "mở chi tiết khi cây còn đang tải".
const P_RACE = "p-racetwomoms1";
await seed(P_RACE, m4, {
  payload: payloadChild("Giả Con Hai Mẹ", { otherParentId: "w" }),
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
const nav = (page) => page.getByRole("navigation");
const itemOf = (page, name) =>
  page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: new RegExp(name) }) });
const openItem = (page, name) =>
  itemOf(page, name).getByRole("button", { name: /Xem và xử lý/ }).click();
const proposalsOf = async (uid) =>
  (await db.collection("memberProposals").where("authorUid", "==", uid).get())
    .docs;
const pendingNow = async () =>
  (await db.collection("memberProposals").where("status", "==", "PENDING").get())
    .size;
const editVersion = async () =>
  ((await db.doc("treeSnapshots/main").get()).data().editVersion ?? 0);
const startVersion = await editVersion();

try {
  stage = "thành viên thường không thấy menu/route quản trị";
  const m = await newPage("thanhvien1-dxa@example.test");
  await expect(
    nav(m.page).getByRole("link", { name: /Đề xuất chờ duyệt/ }),
  ).toHaveCount(0);
  await expect(
    nav(m.page).getByRole("link", { name: "Đề xuất của tôi" }),
  ).toBeVisible();
  await m.page.goto(`${URL}/#/member-proposals`);
  await expect(m.page).toHaveURL(/#\/$/);
  await expect(
    m.page.getByRole("heading", { name: "Đề xuất chờ duyệt" }),
  ).toHaveCount(0);

  stage = "thành viên gửi một đề xuất thật qua giao diện";
  await m.page.goto(`${URL}/#/person/a`);
  await m.page.getByRole("button", { name: "Đề xuất thêm con" }).click();
  await m.page.getByLabel("Họ tên (bắt buộc)").fill("Giả Văn Con");
  await m.page.getByLabel("Cha của đứa trẻ").check();
  await m.page.getByRole("textbox", { name: /^Năm sinh/ }).fill("1995");
  await m.page
    .getByLabel(/^Ghi chú \(mọi thành viên/)
    .fill("ghi chú đề xuất giả");
  await m.page
    .getByLabel(/^Nguồn\/căn cứ \(không bắt buộc\)/)
    .fill("Theo lời kể (giả)");
  await m.page.getByRole("button", { name: "Gửi đề xuất" }).click();
  await expect(m.page.getByText("Đã gửi đề xuất.")).toBeVisible();
  const p1 = (await proposalsOf(m1))[0];
  const P1 = p1.id;
  await m.ctx.close();

  stage = "quản trị viên: menu có số chờ duyệt, đếm một lần (không nghe liên tục)";
  const a = await newPage("quantri-dxa@example.test");
  let aggregations = 0;
  a.page.on("request", (rq) => {
    if (rq.url().includes("runAggregationQuery")) aggregations++;
  });
  await a.page.reload();
  const expectedPending = await pendingNow();
  await expect(
    nav(a.page).getByRole("link", {
      name: `Đề xuất chờ duyệt (${expectedPending})`,
      exact: true,
    }),
  ).toBeVisible();
  const seen = aggregations;
  await sleep(2500);
  if (seen < 1 || aggregations !== seen)
    throw Error(
      `Số chờ phải đếm bằng truy vấn đếm, không nghe liên tục (${seen} -> ${aggregations})`,
    );

  stage = "danh sách: cũ nhất trước, trạng thái bằng chữ, tên người gửi";
  await nav(a.page)
    .getByRole("link", { name: /^Đề xuất chờ duyệt/ })
    .click();
  await expect(
    a.page.getByRole("heading", { name: "Đề xuất chờ duyệt", level: 1 }),
  ).toBeVisible();
  await expect(itemOf(a.page, "Giả Con Bổ Sung")).toBeVisible();
  const headings = await a.page
    .locator("ul.proposal-admin-list > li > h2")
    .allTextContents();
  if (headings.length !== expectedPending)
    throw Error(`Phải có ${expectedPending} mục, thấy ${headings.length}`);
  if (!headings[0].includes("Giả Con Bổ Sung"))
    throw Error("Đề xuất cũ nhất phải đứng đầu: " + headings[0]);
  if (!headings[headings.length - 1].includes("Giả Văn Con"))
    throw Error("Đề xuất mới nhất (gửi qua giao diện) phải đứng cuối");
  await expect(a.page.getByText("CHỜ DUYỆT", { exact: true }).first()).toBeVisible();
  await expect(itemOf(a.page, "Giả Văn Con").getByText(/Thành Viên Một/)).toBeVisible();
  await expect(itemOf(a.page, "Trần Thị Vợ").getByText(/tài khoản đã thu hồi/)).toBeVisible();
  await shots(a.page, "admin-queue");
  await noOverflow(a.page, "danh sách đề xuất của quản trị viên");

  stage = "đề xuất của chính admin: không có nút duyệt/từ chối, có giải thích";
  await openItem(a.page, "Giả Con Của Admin");
  await expect(
    a.page.getByRole("heading", { name: /Giả Con Của Admin/, level: 2 }),
  ).toBeFocused();
  await expect(a.page.getByText(/do chính bạn gửi/)).toBeVisible();
  for (const name of ["Duyệt và ghi vào gia phả", "Từ chối", "Cần bổ sung"])
    await expect(a.page.getByRole("button", { name })).toHaveCount(0);
  await a.page.getByRole("button", { name: "Về danh sách" }).click();
  await expect(
    itemOf(a.page, "Giả Con Của Admin").getByRole("button", { name: /Xem và xử lý/ }),
  ).toBeFocused();

  stage = "chi tiết: cảnh báo trùng (con hiện có + đề xuất khác cùng người gốc)";
  await openItem(a.page, "Giả Văn Con");
  await expect(a.page.getByText("Có thể trùng, hãy đối chiếu trước khi duyệt")).toBeVisible();
  await expect(
    a.page.getByText(/Con hiện có tên gần giống/).locator("a", { hasText: "Giả Văn Con" }),
  ).toBeVisible();
  await expect(
    a.page.getByText(/Đề xuất khác cùng người được gắn/).first(),
  ).toBeVisible();
  await expect(a.page.getByText("Thành Viên Một")).toBeVisible();
  await expect(a.page.getByText("Theo lời kể (giả)")).toBeVisible();
  // Cảnh báo ghi chú hiện đúng (mọi thành viên xem được sau khi duyệt).
  await expect(a.page.getByLabel(/^Ghi chú \(mọi thành viên/)).toHaveValue(
    "ghi chú đề xuất giả",
  );
  await expect(a.page.getByText(/Người gửi đọc được nội dung này/)).toBeVisible();
  await shots(a.page, "admin-detail");
  await noOverflow(a.page, "chi tiết/duyệt đề xuất");

  stage = "sửa tên rồi Duyệt: người mới vào cây, đề xuất APPROVED, nhật ký có proposalId";
  await a.page.getByLabel("Họ tên (bắt buộc)").fill("Giả Văn Con Đã Sửa");
  await a.page.getByLabel(/^Lý do hoặc ghi chú gửi người gửi/).fill("Đã đối chiếu sổ (giả)");
  await a.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" }).click();
  await expect(a.page.getByText(/Đã duyệt và ghi "Giả Văn Con Đã Sửa" vào gia phả/)).toBeFocused();
  const person = await db.doc(`persons/${P1}`).get();
  if (!person.exists || person.data().displayName !== "Giả Văn Con Đã Sửa")
    throw Error("Người mới phải có trong persons với tên đã sửa");
  if (!(await db.doc(`relations/r-a-${P1}`).get()).exists)
    throw Error("Thiếu quan hệ cha-con");
  const snapAfter = (await db.doc("treeSnapshots/main").get()).data();
  if (snapAfter.editVersion !== startVersion + 1) throw Error("editVersion phải tăng 1");
  if (!JSON.parse(snapAfter.data).persons[P1]) throw Error("Snapshot phải có người mới");
  const prop1 = (await db.doc(`memberProposals/${P1}`).get()).data();
  if (
    prop1.status !== "APPROVED" ||
    prop1.decidedBy !== adminUid ||
    prop1.appliedEditVersion !== startVersion + 1 ||
    prop1.decisionReason !== "Đã đối chiếu sổ (giả)" ||
    prop1.payload.name !== "Giả Văn Con"
  )
    throw Error("Đề xuất phải APPROVED, giữ nguyên nội dung gốc: " + JSON.stringify(prop1));
  const auditN = (await db.doc(`auditLogs/edit-${startVersion + 1}`).get()).data();
  if (auditN.event !== "PERSON_ADDED" || auditN.after.proposalId !== P1)
    throw Error("Nhật ký phải là PERSON_ADDED có after.proposalId");
  await expect(
    nav(a.page).getByRole("link", { name: `Đề xuất chờ duyệt (${expectedPending - 1})`, exact: true }),
  ).toBeVisible();
  await expect(itemOf(a.page, "Giả Văn Con")).toHaveCount(0);

  stage = "duyệt đề xuất thêm vợ/chồng";
  await openItem(a.page, "Trần Thị Vợ");
  await a.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" }).click();
  await expect(a.page.getByText(/Đã duyệt và ghi "Trần Thị Vợ"/)).toBeFocused();
  if (!(await db.doc(`unions/u-a-${P_SPO}`).get()).exists)
    throw Error("Thiếu liên kết vợ/chồng");
  if ((await db.doc(`memberProposals/${P_SPO}`).get()).data().status !== "APPROVED")
    throw Error("Đề xuất vợ/chồng phải APPROVED");

  stage = "Từ chối: bắt buộc lý do, có xác nhận, không ghi gì khi thiếu lý do";
  await openItem(a.page, "Giả Con Bị Loại");
  await a.page.getByRole("button", { name: "Từ chối" }).click();
  await expect(a.page.getByText(/Nhập lý do/)).toBeVisible();
  await expect(a.page.getByLabel(/^Lý do hoặc ghi chú gửi người gửi/)).toBeFocused();
  if ((await db.doc(`memberProposals/${P_REJ}`).get()).data().status !== "PENDING")
    throw Error("Thiếu lý do thì không được từ chối");
  await a.page
    .getByLabel(/^Lý do hoặc ghi chú gửi người gửi/)
    .fill("Trùng với người đã có trong cây (giả).");
  await a.page.getByRole("button", { name: "Từ chối" }).click();
  await expect(a.page.getByText(/Từ chối là quyết định cuối/)).toBeVisible();
  await expect(a.page.getByRole("button", { name: "Xác nhận từ chối" })).toBeFocused();
  await a.page.getByRole("button", { name: "Xác nhận từ chối" }).click();
  await expect(a.page.getByText(/Đã từ chối đề xuất "Giả Con Bị Loại"/)).toBeFocused();
  const rej = (await db.doc(`memberProposals/${P_REJ}`).get()).data();
  if (
    rej.status !== "REJECTED" ||
    rej.decisionReason !== "Trùng với người đã có trong cây (giả)." ||
    rej.decidedBy !== adminUid
  )
    throw Error("Đề xuất phải bị từ chối kèm lý do");
  if ((await db.doc(`persons/${P_REJ}`).get()).exists)
    throw Error("Từ chối không được ghi người mới");

  stage = "Cần bổ sung: bắt buộc lý do";
  await openItem(a.page, "Giả Con Bổ Sung");
  await a.page.getByRole("button", { name: "Cần bổ sung" }).click();
  await expect(a.page.getByText(/Nhập lý do/)).toBeVisible();
  await a.page
    .getByLabel(/^Lý do hoặc ghi chú gửi người gửi/)
    .fill("Cần ghi rõ năm sinh theo sổ (giả).");
  await a.page.getByRole("button", { name: "Cần bổ sung" }).click();
  await expect(a.page.getByText(/Đã yêu cầu bổ sung cho đề xuất "Giả Con Bổ Sung"/)).toBeFocused();
  const ask = (await db.doc(`memberProposals/${P_ASK}`).get()).data();
  if (
    ask.status !== "NEEDS_INFO" ||
    ask.infoRequestReason !== "Cần ghi rõ năm sinh theo sổ (giả)." ||
    "decisionReason" in ask
  )
    throw Error("Cần bổ sung chỉ ghi infoRequest*: " + JSON.stringify(ask));
  await shots(a.page, "admin-after-decision");
  // Đề xuất CẦN BỔ SUNG đã hỏi một lần: không còn nút "Cần bổ sung" nữa (chỉ Duyệt/Từ chối).
  await openItem(a.page, "Giả Con Bổ Sung");
  await expect(a.page.getByRole("button", { name: "Cần bổ sung" })).toHaveCount(0);
  await expect(a.page.getByRole("button", { name: "Từ chối" })).toBeVisible();
  await a.page.getByRole("button", { name: "Về danh sách" }).click();

  stage = "tab Đã xử lý: lọc theo trạng thái";
  await a.page.getByRole("button", { name: "Đã xử lý", exact: true }).click();
  // Đề xuất giữ nguyên nội dung gốc (tên người gửi đề xuất), dù quản trị viên đã sửa tên khi duyệt.
  await expect(itemOf(a.page, "Giả Văn Con")).toBeVisible();
  await expect(itemOf(a.page, "Trần Thị Vợ")).toBeVisible();
  await a.page.getByLabel("Trạng thái").selectOption("REJECTED");
  await expect(itemOf(a.page, "Giả Con Bị Loại")).toBeVisible();
  await expect(a.page.getByText("Lý do từ chối: Trùng với người đã có trong cây (giả).")).toBeVisible();
  await expect(itemOf(a.page, "Giả Văn Con")).toHaveCount(0);
  await shots(a.page, "admin-history");
  await noOverflow(a.page, "lịch sử đề xuất");
  await a.ctx.close();

  stage = "thành viên thấy kết quả: ĐÃ DUYỆT, TỪ CHỐI, CẦN BỔ SUNG";
  const v1 = await newPage("thanhvien1-dxa@example.test");
  await v1.page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await expect(v1.page.getByText("ĐÃ DUYỆT", { exact: true })).toBeVisible();
  await expect(v1.page.getByText(/Ghi chú: Đã đối chiếu sổ \(giả\)/)).toBeVisible();
  stage = "dòng ĐÃ DUYỆT màu xanh (--color-success), vẫn có chữ";
  const approvedColor = await v1.page
    .getByText(/Quản trị viên đã duyệt và ghi vào gia phả/)
    .evaluate((el) => globalThis.getComputedStyle(el).color);
  if (approvedColor !== "rgb(56, 87, 59)")
    throw Error(`Màu dòng đã duyệt: ${approvedColor}`);
  await shots(v1.page, "my-proposal-approved");
  await v1.ctx.close();
  const v3 = await newPage("thanhvien3-dxa@example.test");
  await v3.page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await expect(v3.page.getByText("TỪ CHỐI", { exact: true })).toBeVisible();
  await expect(
    v3.page.getByText("Lý do từ chối: Trùng với người đã có trong cây (giả)."),
  ).toBeVisible();
  stage = "lý do TỪ CHỐI màu đỏ (--color-danger), vẫn có chữ";
  const rejectedColor = await v3.page
    .getByText("Lý do từ chối: Trùng với người đã có trong cây (giả).")
    .evaluate((el) => globalThis.getComputedStyle(el).color);
  if (rejectedColor !== "rgb(155, 44, 34)")
    throw Error(`Màu lý do từ chối: ${rejectedColor}`);
  await shots(v3.page, "my-proposal-rejected");
  await v3.ctx.close();
  const v2 = await newPage("thanhvien2-dxa@example.test");
  await v2.page.getByRole("link", { name: "Đề xuất của tôi" }).click();
  await expect(v2.page.getByText("CẦN BỔ SUNG", { exact: true })).toBeVisible();
  await expect(
    v2.page.getByText("Quản trị viên cần bổ sung: Cần ghi rõ năm sinh theo sổ (giả)."),
  ).toBeVisible();

  stage = "thành viên gửi lại sau khi được yêu cầu bổ sung";
  await v2.page.getByRole("link", { name: "Gửi lại (điền sẵn)" }).click();
  await expect(v2.page.getByLabel("Họ tên (bắt buộc)")).toHaveValue("Giả Con Bổ Sung");
  await v2.page.getByRole("textbox", { name: /^Năm sinh/ }).fill("1991");
  await v2.page.getByRole("button", { name: "Gửi đề xuất" }).click();
  await expect(v2.page.getByText("Đã gửi đề xuất.")).toBeVisible();
  const m2docs = await proposalsOf(m2);
  const resub = m2docs.find((d) => d.id !== P_ASK);
  if (!resub || resub.data().resubmitOf !== P_ASK) throw Error("Thiếu đề xuất gửi lại");
  if (m2docs.find((d) => d.id === P_ASK).data().status !== "WITHDRAWN")
    throw Error("Đề xuất cũ phải được rút");
  await v2.ctx.close();

  stage = "admin: 'gửi lại của' chỉ khi hợp lệ; gửi lại giả không được tin";
  const b = await newPage("quantri-dxa@example.test");
  await b.page.goto(`${URL}/#/member-proposals`);
  await openItem(b.page, "Giả Con Bổ Sung");
  await expect(
    b.page.getByText(`Gửi lại của đề xuất #${P_ASK} (ĐÃ RÚT)`),
  ).toBeVisible();
  await expect(b.page.getByLabel("Năm sinh")).toHaveValue("1991");
  await b.page.getByRole("button", { name: "Về danh sách" }).click();
  // Firestore web SDK đọc qua kênh Listen (WebChannel): chờ yêu cầu thêm đích đọc đề xuất cũ rồi chờ phản hồi lắng xuống.
  const oldRead = b.page.waitForRequest(
    (rq) =>
      rq.url().includes("/Listen/channel") &&
      (rq.postData() ?? "").includes(P_REJ),
  );
  await openItem(b.page, "Giả Văn Gửi Lại Giả");
  await expect(b.page.getByRole("heading", { name: /Giả Văn Gửi Lại Giả/, level: 2 })).toBeFocused();
  // Chờ phản hồi đọc đề xuất cũ (P_REJ) rồi mới kiểm, để "không có dòng gửi lại" không đạt vì chưa tải xong.
  await oldRead;
  await sleep(1000);
  await expect(b.page.getByText(/Gửi lại của đề xuất/)).toHaveCount(0);
  await b.page.getByRole("button", { name: "Về danh sách" }).click();

  stage = "mở chi tiết khi cây còn đang tải: không được bỏ cha/mẹ còn lại";
  await b.page.goto(`${URL}/#/`);
  let releaseTree;
  const treeGate = new Promise((res) => (releaseTree = res));
  // Chặn yêu cầu đọc treeSnapshots/main (kênh Listen của Firestore) cho tới khi nhả cổng: giả lập cây tải chậm.
  await b.page.route("**/Listen/channel*", async (route) => {
    if ((route.request().postData() ?? "").includes("treeSnapshots"))
      await treeGate;
    await route.continue();
  });
  await nav(b.page).getByRole("link", { name: /^Đề xuất chờ duyệt/ }).click();
  await openItem(b.page, "Giả Con Hai Mẹ");
  await expect(b.page.getByText(/Đang tải cây gia phả/)).toBeVisible();
  await expect(b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" })).toHaveCount(0);
  await expect(b.page.getByLabel("Họ tên (bắt buộc)")).toHaveCount(0);
  await shots(b.page, "admin-tree-loading");
  releaseTree();
  await expect(b.page.getByLabel("Mẹ của đứa trẻ (nếu có ghi)")).toHaveValue("w");
  // Chốt an toàn: để "Không ghi" thì phải xác nhận, không bỏ âm thầm.
  await b.page.getByLabel("Mẹ của đứa trẻ (nếu có ghi)").selectOption("");
  await b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" }).click();
  await expect(b.page.getByText("KHÔNG có quan hệ với người này")).toBeVisible();
  if ((await db.doc(`memberProposals/${P_RACE}`).get()).data().status !== "PENDING")
    throw Error("Chưa xác nhận thì không được duyệt");
  await b.page.getByRole("button", { name: "Quay lại chọn" }).click();
  await b.page.getByLabel("Mẹ của đứa trẻ (nếu có ghi)").selectOption("w");
  await b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" }).click();
  await expect(b.page.getByText(/Đã duyệt và ghi "Giả Con Hai Mẹ"/)).toBeFocused();
  for (const rid of [`r-a-${P_RACE}`, `r-w-${P_RACE}`])
    if (!(await db.doc(`relations/${rid}`).get()).exists)
      throw Error("Thiếu quan hệ " + rid);
  await b.page.unroute("**/Listen/channel*");

  stage = "xung đột phiên bản: thông báo chưa ghi gì, tải lại, duyệt lại được";
  await openItem(b.page, "Giả Văn Khác");
  await expect(b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" })).toBeEnabled();
  await db.doc("treeSnapshots/main").update({ editVersion: FieldValue.increment(1) });
  await b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" }).click();
  await expect(
    b.page.getByRole("alert").filter({ hasText: "vừa được người khác thay đổi" }),
  ).toBeVisible();
  await expect(b.page.getByText(/Chưa có gì được ghi/)).toBeVisible();
  if ((await db.doc(`persons/${P_OTH}`).get()).exists || (await db.doc(`memberProposals/${P_OTH}`).get()).data().status !== "PENDING")
    throw Error("Xung đột phiên bản thì không được ghi gì");
  await sleep(1500); // chờ cây tải lại với editVersion mới
  await b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" }).click();
  await expect(b.page.getByText(/Đã duyệt và ghi "Giả Văn Khác"/)).toBeFocused();
  if ((await db.doc(`memberProposals/${P_OTH}`).get()).data().status !== "APPROVED")
    throw Error("Duyệt lại sau khi tải lại phải thành công");

  stage = "nhật ký: liên kết chỉ khi đề xuất APPROVED và appliedEditVersion khớp";
  const latestReal = await editVersion();
  const forge = async (v, proposalId) => {
    await db.doc(`auditLogs/edit-${v}`).set({
      event: "PERSON_ADDED",
      actorUid: adminUid,
      target: "persons/forged",
      personId: "forged",
      createdPersonIds: [],
      relationIds: [],
      unionId: null,
      editVersion: v,
      fields: ["child", "relations"],
      before: {},
      after: {
        name: "Người Giả Mạo",
        category: "CLAN",
        fatherId: "a",
        motherId: null,
        adoptive: false,
        noteChars: 0,
        proposalId,
      },
      timestamp: Timestamp.now(),
      schemaVersion: 1,
    });
  };
  await forge(latestReal + 1, P_HID); // đề xuất chưa APPROVED
  await forge(latestReal + 2, P1); // đề xuất APPROVED nhưng appliedEditVersion khác
  await db.doc("treeSnapshots/main").update({ editVersion: latestReal + 2 });
  await b.page.goto(`${URL}/#/audit`);
  const row = (v) =>
    b.page.locator("tr").filter({
      has: b.page.getByRole("rowheader", { name: `#${v}`, exact: true }),
    });
  await expect(row(startVersion + 1)).toBeVisible();
  await row(startVersion + 1).getByText("Chi tiết").click();
  await expect(row(startVersion + 1).getByText(`Từ đề xuất #${P1} (đã xác minh)`)).toBeVisible();
  await expect(row(startVersion + 1).getByRole("link", { name: "Mở đề xuất" })).toBeVisible();
  for (const v of [latestReal + 1, latestReal + 2]) {
    await row(v).getByText("Chi tiết").click();
    await expect(row(v).getByText(/chưa xác minh/)).toBeVisible();
    await expect(row(v).getByRole("link", { name: "Mở đề xuất" })).toHaveCount(0);
  }
  await shots(b.page, "admin-audit");
  await noOverflow(b.page, "nhật ký có dòng từ đề xuất");
  await row(startVersion + 1).getByRole("link", { name: "Mở đề xuất" }).click();
  await expect(
    b.page.getByRole("heading", { name: /Thêm con: Giả Văn Con/, level: 2 }),
  ).toBeVisible();
  await expect(b.page.getByText("ĐÃ DUYỆT", { exact: true })).toBeVisible();
  await expect(b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" })).toHaveCount(0);
  await b.page.getByRole("button", { name: "Về danh sách" }).click();

  stage = "duyệt khi người gốc đã bị ẩn: thông báo an toàn, không ghi gì";
  await b.page.goto(`${URL}/#/member-proposals`);
  await openItem(b.page, "Giả Con Của Bình");
  await expect(b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" })).toBeEnabled();
  // Giả lập "ẩn": bỏ người b (và quan hệ của họ) khỏi ảnh chụp cây trong DB, KHÔNG đổi editVersion.
  const snapDoc = (await db.doc("treeSnapshots/main").get()).data();
  const tree = JSON.parse(snapDoc.data);
  delete tree.persons.b;
  tree.relations = tree.relations.filter((r) => r[0] !== "b" && r[1] !== "b");
  tree.unions = tree.unions.filter((u) => u[0] !== "b" && u[1] !== "b");
  await db.doc("treeSnapshots/main").update({ data: JSON.stringify(tree) });
  const verBefore = await editVersion();
  await b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" }).click();
  await expect(
    b.page.getByRole("alert").filter({ hasText: "không còn trong cây" }),
  ).toBeVisible();
  await expect(b.page.getByText(/Chưa có gì được ghi/)).toBeVisible();
  if ((await db.doc(`persons/${P_HID}`).get()).exists)
    throw Error("Không được tạo người khi người gốc đã ẩn");
  if ((await db.doc(`memberProposals/${P_HID}`).get()).data().status !== "PENDING")
    throw Error("Đề xuất phải giữ nguyên CHỜ DUYỆT");
  if ((await editVersion()) !== verBefore) throw Error("editVersion không được đổi");
  // Sau khi tải lại cây: nút Duyệt bị khóa, vẫn Từ chối/Cần bổ sung được.
  await expect(
    b.page.getByText(/Người được gắn không còn trong cây nên không thể duyệt/),
  ).toBeVisible();
  await expect(b.page.getByRole("button", { name: "Duyệt và ghi vào gia phả" })).toBeDisabled();
  await expect(b.page.getByRole("button", { name: "Từ chối" })).toBeEnabled();
  await shots(b.page, "admin-hidden-anchor");
  await b.ctx.close();

  if (pageErrors.length) throw Error("Lỗi trang: " + pageErrors.join("; "));
  console.log("Kiểm tra trình duyệt duyệt đề xuất (quản trị viên): ĐẠT");
} catch (error) {
  failed = true;
  console.error(`THẤT BẠI ở bước "${stage}":`, error);
} finally {
  await browser.close();
  spawn(`taskkill /pid ${vite.pid} /T /F`, { shell: true, stdio: "ignore" });
  vite.kill();
}
process.exit(failed ? 1 : 0);
