import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

// Run only against fake fixtures on the fixed local demo emulators.
// The demo-parent -> demo-child relation requires a fresh graph fixture.
const password = "Demo-only-2026!";
let browser;
let stage = "initialization";
let pageErrors = 0;
let failed = false;
let dialogErrors = 0;
let dialogCount = 0;
const dialogControls = new Map();
function confirmations(page) {
  const control = { cancelNext: false };
  dialogControls.set(page, control);
  page.on("dialog", async (dialog) => {
    const uuid =
      "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
    const valid =
      dialog.type() === "confirm" &&
      new RegExp(
        `^(Gửi đề xuất ${uuid}, bản sửa [1-9][0-9]*[?] Bản nháp sẽ chuyển sang chờ duyệt[.]|Ghi nhận phiếu đồng ý cho đề xuất ${uuid}, bản sửa [1-9][0-9]*[?] Dữ liệu chỉ được áp dụng khi đủ phiếu hợp lệ[.]|Từ chối cho đề xuất ${uuid}, bản sửa [1-9][0-9]*[?] Đề xuất sẽ kết thúc ở trạng thái từ chối[.]|Yêu cầu bổ sung cho đề xuất ${uuid}, bản sửa [1-9][0-9]*[?] Các phiếu cũ sẽ mất hiệu lực; người đề xuất phải sửa và gửi lại[.])$`,
      ).test(dialog.message());
    if (!valid) {
      dialogErrors++;
      await dialog.dismiss();
      return;
    }
    dialogCount++;
    if (control.cancelNext) {
      control.cancelNext = false;
      await dialog.dismiss();
    } else await dialog.accept();
  });
}

async function capability(enabled) {
  const response = await fetch(
    "http://127.0.0.1:8080/v1/projects/demo-gia-pha/databases/(default)/documents/users/demo-reviewer-one?updateMask.fieldPaths=canReviewChanges",
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: { canReviewChanges: { booleanValue: enabled } },
      }),
    },
  );
  if (!response.ok)
    throw Error("Local reviewer capability fixture update failed");
}
async function login(page, email) {
  await page.goto("http://127.0.0.1:5173");
  await page
    .getByRole("heading", { name: "Chào mừng trở về", exact: true })
    .waitFor();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập →", exact: true }).click();
  await page
    .getByRole("heading", { name: "Người có tổ, cây có nguồn.", exact: true })
    .waitFor();
}
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile proposal layout overflow");
}
function detail(page) {
  return page.locator("section.detail").filter({
    has: page.getByRole("heading", { name: "Chi tiết đề xuất", exact: true }),
  });
}
async function open(page, id) {
  await page.getByLabel("Mã đề xuất cần xem", { exact: true }).fill(id);
  await page
    .getByRole("button", { name: "Mở theo mã đề xuất", exact: true })
    .click();
  await expect(
    page.getByLabel("Mã đề xuất đang xem", { exact: true }),
  ).toHaveValue(id);
  await expect(
    page.getByRole("button", { name: "Tải lại đề xuất", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
}
async function save(page, edit = false) {
  await page
    .getByRole("button", {
      name: edit ? "Lưu bản sửa" : "Lưu bản nháp",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    edit
      ? "Đã lưu bản sửa. Các phiếu cũ không còn hiệu lực."
      : "Đã lưu bản nháp. Chưa thay đổi dữ liệu chính thức.",
  );
  return page.getByLabel("Mã đề xuất đang xem", { exact: true }).inputValue();
}
async function submit(page) {
  await page.getByRole("button", { name: "Gửi đề xuất", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Đã gửi đề xuất để kiểm tra và phê duyệt.",
  );
  await expect(detail(page).getByText(/Trạng thái: Chờ duyệt/)).toBeVisible();
}
async function approve(page) {
  await page.getByRole("button", { name: "Đồng ý duyệt", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tải lại đề xuất", exact: true }),
  ).toBeEnabled();
}
async function newPersonDraft(page, name) {
  await page
    .getByRole("button", { name: "Tạo bản nháp khác", exact: true })
    .click();
  await page
    .getByLabel("Loại đề xuất", { exact: true })
    .selectOption("PERSON_BASIC");
  await page.getByLabel("Họ tên đề xuất", { exact: true }).fill(name);
  await page
    .getByLabel("Nguồn và căn cứ", { exact: true })
    .fill("Nguồn giả dùng riêng cho kiểm thử đề xuất trên emulator.");
  return save(page);
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
  });
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [author, reviewerOne, reviewerTwo] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  for (const page of [author, reviewerOne, reviewerTwo]) {
    confirmations(page);
    page.on("pageerror", () => {
      pageErrors++;
    });
  }
  stage = "three separate authenticated sessions";
  await Promise.all([
    login(author, "nguoidexuat@example.test"),
    login(reviewerOne, "duyetmot@example.test"),
    login(reviewerTwo, "duyethai@example.test"),
  ]);
  await author
    .getByRole("link", { name: "Đề xuất thay đổi", exact: true })
    .click();
  await reviewerOne
    .getByRole("link", { name: "Hộp duyệt", exact: true })
    .click();
  await reviewerTwo
    .getByRole("link", { name: "Hộp duyệt", exact: true })
    .click();
  await author
    .getByRole("heading", { name: "Đề xuất thay đổi", exact: true })
    .waitFor();
  await Promise.all([mobile(author), mobile(reviewerOne), mobile(reviewerTwo)]);

  stage = "basic person draft and unsaved edit guard";
  const firstName = `Nhân vật đề xuất giả ${randomUUID().slice(0, 8)}`;
  const personRequest = await newPersonDraft(author, firstName);
  await author
    .getByLabel("Họ tên đề xuất", { exact: true })
    .fill(`${firstName} chưa lưu`);
  await expect(
    author.getByRole("button", { name: "Gửi đề xuất", exact: true }),
  ).toBeDisabled();
  await expect(
    author.getByText("Có thay đổi chưa lưu. Lưu bản sửa trước khi gửi.", {
      exact: true,
    }),
  ).toBeVisible();
  // Restore the server snapshot explicitly; do not submit the unsaved form.
  await author
    .getByRole("button", { name: "Sửa bản nháp", exact: true })
    .click();
  await expect(
    author.getByLabel("Họ tên đề xuất", { exact: true }),
  ).toHaveValue(firstName);
  await submit(author);

  stage = "author has no reviewer route or self-review action";
  await expect(
    author.getByRole("link", { name: "Hộp duyệt", exact: true }),
  ).toHaveCount(0);
  await author.goto("http://127.0.0.1:5173/#/review");
  await author
    .getByRole("heading", { name: "Không tìm thấy trang", exact: true })
    .waitFor();
  await expect(
    author.getByRole("button", { name: "Đồng ý duyệt", exact: true }),
  ).toHaveCount(0);
  await author
    .getByRole("link", { name: "Đề xuất thay đổi", exact: true })
    .click();

  stage = "one reviewer applies a basic profile and public search finds it";
  await open(reviewerOne, personRequest);
  await expect(
    detail(reviewerOne).getByText(`Sau: ${firstName}`, { exact: true }),
  ).toBeVisible();
  stage = "cancel review preserves note and does not call backend";
  let reviewRequests = 0;
  reviewerOne.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/reviewChangeRequest")
    )
      reviewRequests++;
  });
  const keptNote = "Ghi chú giả được giữ lại khi hủy xác nhận.";
  await reviewerOne.getByLabel("Ý kiến duyệt", { exact: true }).fill(keptNote);
  dialogControls.get(reviewerOne).cancelNext = true;
  const dialogsBeforeCancel = dialogCount;
  await reviewerOne
    .getByRole("button", { name: "Đồng ý duyệt", exact: true })
    .click();
  await expect.poll(() => dialogCount).toBe(dialogsBeforeCancel + 1);
  await expect(
    reviewerOne.getByLabel("Ý kiến duyệt", { exact: true }),
  ).toHaveValue(keptNote);
  await open(reviewerOne, personRequest);
  await expect(
    detail(reviewerOne).getByText(/Trạng thái: Chờ duyệt/),
  ).toBeVisible();
  if (reviewRequests !== 0)
    throw Error("Canceled review made a mutation request");
  await approve(reviewerOne);
  await expect(
    detail(reviewerOne).getByText(/Trạng thái: Đã phê duyệt/),
  ).toBeVisible();
  await open(author, personRequest);
  await expect(
    detail(author).getByText(/Trạng thái: Đã phê duyệt/),
  ).toBeVisible();
  await author
    .getByRole("link", { name: "♧ Tra cứu thành viên", exact: true })
    .click();
  await author.getByLabel("Họ tên", { exact: true }).fill(firstName);
  await author.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  await author.getByRole("heading", { name: firstName, exact: true }).waitFor();
  await author
    .locator("button.person")
    .filter({
      has: author.getByRole("heading", { name: firstName, exact: true }),
    })
    .click();
  await author.getByText("Phiên bản: 1", { exact: true }).waitFor();
  await mobile(author);
  await author
    .getByRole("link", { name: "Đề xuất thay đổi", exact: true })
    .click();

  stage = "needs-info requires edit and resubmit then rejection is terminal";
  const infoName = `Hồ sơ bổ sung giả ${randomUUID().slice(0, 8)}`;
  const infoRequest = await newPersonDraft(author, infoName);
  await submit(author);
  await open(reviewerOne, infoRequest);
  await reviewerOne
    .getByLabel("Ý kiến duyệt", { exact: true })
    .fill("Cần bổ sung căn cứ giả trước khi phê duyệt.");
  await reviewerOne
    .getByRole("button", { name: "Yêu cầu bổ sung", exact: true })
    .click();
  await expect(
    detail(reviewerOne).getByText(/Trạng thái: Cần bổ sung/),
  ).toBeVisible();
  await open(author, infoRequest);
  await expect(
    author.getByRole("button", { name: "Gửi đề xuất", exact: true }),
  ).toHaveCount(0);
  await author
    .getByRole("button", { name: "Sửa bản nháp", exact: true })
    .click();
  await author
    .getByLabel("Nguồn và căn cứ", { exact: true })
    .fill("Căn cứ giả đã bổ sung, dùng cho kiểm thử bản sửa hai.");
  await save(author, true);
  await expect(detail(author).getByText(/Bản sửa: 2/)).toBeVisible();
  await submit(author);
  await open(reviewerOne, infoRequest);
  await reviewerOne
    .getByLabel("Ý kiến duyệt", { exact: true })
    .fill("Căn cứ giả chưa được chấp nhận trong kịch bản kiểm thử từ chối.");
  await reviewerOne
    .getByRole("button", { name: "Từ chối đề xuất", exact: true })
    .click();
  await expect(
    detail(reviewerOne).getByText(/Trạng thái: Đã từ chối/),
  ).toBeVisible();
  await open(author, infoRequest);
  await expect(
    detail(author).getByText(/Trạng thái: Đã từ chối/),
  ).toBeVisible();
  await expect(
    author.getByRole("button", { name: "Gửi đề xuất", exact: true }),
  ).toHaveCount(0);
  await expect(
    author.getByRole("button", { name: "Sửa bản nháp", exact: true }),
  ).toHaveCount(0);

  stage = "lineage relation draft with explicit role, source and reason";
  await author
    .getByRole("button", { name: "Tạo bản nháp khác", exact: true })
    .click();
  await author
    .getByLabel("Loại đề xuất", { exact: true })
    .selectOption("RELATION_CREATE");
  await author.getByLabel("Mã cha/mẹ", { exact: true }).fill("demo-parent");
  await author.getByLabel("Mã người con", { exact: true }).fill("demo-child");
  await author
    .getByLabel("Vai trò cha/mẹ", { exact: true })
    .selectOption("FATHER");
  await author
    .getByLabel("Loại quan hệ", { exact: true })
    .selectOption("BIOLOGICAL");
  await author.getByLabel("Truyền dòng họ", { exact: true }).check();
  await author
    .getByLabel("Lý do truyền dòng", { exact: true })
    .fill(
      "Đường truyền dòng giả được chỉ rõ để hai người duyệt độc lập kiểm chứng.",
    );
  await author
    .getByLabel("Nguồn và căn cứ", { exact: true })
    .fill("Tư liệu quan hệ giả, chỉ phục vụ kiểm thử trên emulator.");
  await mobile(author);
  const relationRequest = await save(author);
  await submit(author);

  stage = "first lineage vote does not apply and duplicate vote is a no-op";
  await open(reviewerOne, relationRequest);
  await expect(
    detail(reviewerOne).getByText("Cần 2 người duyệt; đã ghi nhận 0.", {
      exact: true,
    }),
  ).toBeVisible();
  await approve(reviewerOne);
  await expect(
    detail(reviewerOne).getByText("Cần 2 người duyệt; đã ghi nhận 1.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    detail(reviewerOne).getByText(/Trạng thái: Chờ duyệt/),
  ).toBeVisible();
  await reviewerOne
    .getByRole("button", { name: "Đồng ý duyệt", exact: true })
    .click();
  await expect(
    reviewerOne.getByRole("button", { name: "Tải lại đề xuất", exact: true }),
  ).toBeEnabled();
  await expect(reviewerOne.getByRole("alert")).toHaveCount(0);
  await expect(
    detail(reviewerOne).getByText(/Trạng thái: Chờ duyệt/),
  ).toBeVisible();
  await open(reviewerOne, relationRequest);
  await expect(
    detail(reviewerOne).getByText("Cần 2 người duyệt; đã ghi nhận 1.", {
      exact: true,
    }),
  ).toBeVisible();

  stage = "second distinct reviewer applies lineage relation";
  await open(reviewerTwo, relationRequest);
  await approve(reviewerTwo);
  await expect(
    detail(reviewerTwo).getByText(/Trạng thái: Đã phê duyệt/),
  ).toBeVisible();
  await expect(
    detail(reviewerTwo).getByText("Cần 2 người duyệt; đã ghi nhận 2.", {
      exact: true,
    }),
  ).toBeVisible();
  await open(author, relationRequest);
  await expect(
    detail(author).getByText(/Trạng thái: Đã phê duyệt/),
  ).toBeVisible();
  await expect(
    author.getByRole("button", { name: "Gửi đề xuất", exact: true }),
  ).toHaveCount(0);
  await author
    .getByRole("link", { name: "♧ Tra cứu thành viên", exact: true })
    .click();
  await author.getByLabel("Họ tên", { exact: true }).fill("nguoi con gia");
  await author.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  await author
    .getByRole("heading", { name: "Người con giả", exact: true })
    .waitFor();
  await author
    .locator("button.person")
    .filter({
      has: author.getByRole("heading", { name: "Người con giả", exact: true }),
    })
    .click();
  await author
    .getByText("Đời và chi: chờ xác minh quan hệ truyền dòng.", { exact: true })
    .waitFor();
  await mobile(author);
  await mobile(reviewerTwo);

  stage = "loss of reviewer capability clears review route and proposal data";
  await open(reviewerOne, relationRequest);
  await capability(false);
  await expect(
    reviewerOne.getByRole("link", { name: "Hộp duyệt", exact: true }),
  ).toHaveCount(0);
  await reviewerOne
    .getByRole("heading", { name: "Không tìm thấy trang", exact: true })
    .waitFor();
  await expect(
    reviewerOne.getByLabel("Mã đề xuất đang xem", { exact: true }),
  ).toHaveCount(0);
  await expect(
    reviewerOne.getByRole("heading", { name: "Chi tiết đề xuất", exact: true }),
  ).toHaveCount(0);
  await expect(
    reviewerOne.getByLabel("Ý kiến duyệt", { exact: true }),
  ).toHaveCount(0);
  await mobile(reviewerOne);
  if (pageErrors || dialogErrors || dialogCount < 8)
    throw Error("Unexpected browser page error or confirmation coverage");
} catch {
  // Do not leak entered evidence or operation contents through Playwright call logs.
  failed = true;
} finally {
  try {
    await capability(true);
  } catch {
    failed = true;
    stage = "reviewer fixture capability cleanup";
  }
  await browser?.close();
}
if (failed)
  throw Error(`Proposal browser verification failed at stage: ${stage}`);
console.log(
  "Browser: proposal draft/edit/submit, one-review profile, needs-info/revision/reject, two-review lineage, confirmation/cancel guards, duplicate vote, public search, capability removal and mobile passed.",
);
