import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
});
const errors = [];
const samples = [];
const pages = [];
async function session(email) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  pages.push(page);
  page.on("pageerror", (error) => errors.push(error.name));
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Demo-only-2026!");
  await page.getByRole("button", { name: "Đăng nhập →", exact: true }).click();
  await page
    .getByRole("heading", { name: "Người có tổ, cây có nguồn." })
    .waitFor();
  return page;
}
async function fits(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw Error(`Horizontal page overflow: ${label}`);
}
async function contrast(locator, focus = false) {
  return locator.evaluate((element, focus) => {
    const rgb = (text) =>
      text
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    const luminance = (color) =>
      rgb(color)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    let node = element;
    while (
      node &&
      (globalThis.getComputedStyle(node).backgroundColor ===
        "rgba(0, 0, 0, 0)" ||
        globalThis.getComputedStyle(node).backgroundColor === "transparent")
    )
      node = node.parentElement;
    const background = node
      ? globalThis.getComputedStyle(node).backgroundColor
      : "rgb(255, 255, 255)";
    const style = globalThis.getComputedStyle(element);
    const foreground = focus ? style.outlineColor : style.color;
    const a = luminance(foreground),
      b = luminance(background);
    return {
      foreground,
      background,
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      outline: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  }, focus);
}
try {
  const author = await session("nguoidexuat@example.test");
  const reviewer = await session("duyetmot@example.test");
  await session("quanly@example.test"); // tài khoản quản lý vẫn được đăng nhập; trang #/accounts cũ đã bị ẩn
  for (const width of [360, 768, 1280, 1440]) {
    for (const page of pages)
      await page.setViewportSize({ width, height: 900 });
    await author.goto("http://127.0.0.1:5173/#/persons");
    await expect(author.getByRole("status")).toContainText("Nhấn Tìm kiếm");
    await author
      .getByLabel("Họ tên", { exact: true })
      .fill("khong-co-ket-qua-ui-test");
    await author.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
    await expect(author.getByRole("status")).toHaveText(
      "Không tìm thấy hồ sơ.",
    );
    await fits(author, `people ${width}`);
    await author.goto("http://127.0.0.1:5173/#/changes");
    await author
      .getByRole("heading", { name: "Đề xuất thay đổi", exact: true })
      .waitFor();
    await author
      .getByRole("button", { name: "Tạo bản nháp khác", exact: true })
      .click();
    const longName =
      "Nhân vật giả Nguyễn Đặng Hoàng Phương Thảo — hồ sơ kiểm thử giao diện tiếng Việt";
    await author.getByLabel("Họ tên đề xuất", { exact: true }).fill(longName);
    await author
      .getByRole("button", { name: "Lưu bản nháp", exact: true })
      .click();
    await expect(
      author.getByLabel("Họ tên đề xuất", { exact: true }),
    ).toHaveValue(longName);
    if (
      !(await author
        .getByLabel("Nguồn và căn cứ", { exact: true })
        .evaluate((e) => !e.validity.valid))
    )
      throw Error("Required evidence not validated");
    await author
      .getByLabel("Loại đề xuất", { exact: true })
      .selectOption("RELATION_CREATE");
    await author
      .getByLabel("Mã cha/mẹ", { exact: true })
      .fill("fake-parent-" + "x".repeat(110));
    await author
      .getByLabel("Mã người con", { exact: true })
      .fill("fake-child-" + "x".repeat(110));
    const checkbox = author.getByRole("checkbox", {
      name: "Truyền dòng họ",
      exact: true,
    });
    await checkbox.focus();
    await author.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await author.keyboard.press("Tab");
    const reason = author.getByLabel("Lý do truyền dòng", { exact: true });
    await expect(reason).toBeFocused();
    const focus = await contrast(reason, true);
    if (
      focus.outline === "none" ||
      parseFloat(focus.outlineWidth) < 2 ||
      focus.ratio < 3
    )
      throw Error(
        `Focus visibility insufficient ${width}: ${JSON.stringify(focus)}`,
      );
    await reason.fill(
      "Căn cứ giả dành riêng cho kiểm thử giao diện, không phải thông tin dòng họ thật. ".repeat(
        8,
      ),
    );
    await author
      .getByLabel("Nguồn và căn cứ", { exact: true })
      .fill("Nguồn giả — kiểm thử độ dài và dấu tiếng Việt. ".repeat(10));
    for (const [label, locator] of [
      ["body text", author.locator("main p").first()],
      [
        "primary button",
        author.getByRole("button", { name: "Lưu bản nháp", exact: true }),
      ],
      ["input", reason],
    ]) {
      const result = await contrast(locator);
      if (result.ratio < 4.5)
        throw Error(
          `Text contrast insufficient ${label}: ${JSON.stringify(result)}`,
        );
      samples.push({ width, label, ratio: Number(result.ratio.toFixed(2)) });
    }
    if (width === 360) {
      let release;
      let captured;
      const intercepted = new Promise((resolve) => {
        captured = resolve;
      });
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      await author.route("**/listChangeRequests", async (route) => {
        captured();
        await pending;
        await route.continue();
      });
      const refresh = author.getByRole("button", {
        name: "Tải lại danh sách",
        exact: true,
      });
      await refresh.click();
      await intercepted;
      await expect(refresh).toBeDisabled();
      await expect(
        author.getByLabel("Loại đề xuất", { exact: true }),
      ).toBeDisabled();
      release();
      await expect(refresh).toBeEnabled();
      await author.unroute("**/listChangeRequests");
      await author.route("**/listChangeRequests", (route) =>
        route.fulfill({
          contentType: "application/json",
          status: 403,
          body: JSON.stringify({
            error: {
              status: "PERMISSION_DENIED",
              message: "Fake UI permission test",
            },
          }),
        }),
      );
      await refresh.click();
      await expect(author.getByRole("alert")).toContainText(
        "Bạn không có quyền",
      );
      await expect(
        author.getByLabel("Nguồn và căn cứ", { exact: true }),
      ).not.toHaveValue("");
      await author.unroute("**/listChangeRequests");
      await refresh.click();
      await expect(author.getByRole("alert")).toHaveCount(0);
    }
    await fits(author, `proposal ${width}`);
    await author.screenshot({
      path: `/tmp/gia-pha-ui-${width}.png`,
      fullPage: true,
    });
    await reviewer.goto("http://127.0.0.1:5173/#/review");
    await reviewer
      .getByRole("heading", { name: "Hộp duyệt", exact: true })
      .waitFor();
    await fits(reviewer, `review ${width}`);
    // Trang #/accounts (hệ lời mời cũ emulator-only) đã bị ẩn; lời mời mới nằm trong #/users (users-browser-check, invites-browser-check).
    const controls = await author
      .locator("input,select,textarea")
      .evaluateAll((elements) =>
        elements.every((e) => e.labels?.length || e.getAttribute("aria-label")),
      );
    if (!controls) throw Error("Unlabelled proposal control");
  }
  if (errors.length) throw Error(`Browser pageerrors: ${errors.join(",")}`);
  console.log(
    JSON.stringify(
      {
        result: "passed",
        viewports: [360, 768, 1280, 1440],
        selectedContrastSamples: samples,
        states: [
          "empty search",
          "no results",
          "native validation",
          "long input",
          "keyboard checkbox and focus",
          "review queue",
          "reduced motion",
          "loading/disabled",
          "permission-denied/recovery",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
