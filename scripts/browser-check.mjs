import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173");
if (process.argv.includes("--setup")) {
  await page.getByRole("heading", { name: "Sẵn sàng kết nối" }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Layout overflow");
    await page.screenshot({
      path: `/tmp/gia-pha-${width}.png`,
      fullPage: true,
    });
  }
  await browser.close();
  if (errors.length) throw Error(errors.join("\n"));
  console.log("Browser: setup screen, desktop/mobile, no page errors passed.");
  process.exit(0);
}
await page.getByRole("heading", { name: "Chào mừng trở về" }).waitFor();
await page.getByLabel("Email", { exact: true }).fill("thanhvien@example.test");
await page.getByLabel("Mật khẩu").fill("Demo-only-2026!");
await page.getByRole("button", { name: "Đăng nhập →" }).click();
await page
  .getByRole("heading", { name: "Người có tổ, cây có nguồn." })
  .waitFor();
await page.getByRole("link", { name: "♧ Tra cứu thành viên" }).click();
await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
await page
  .getByRole("heading", { name: "Nhân vật giả 1", exact: true })
  .waitFor();
await page
  .getByRole("button", { name: "N Nhân vật giả 1 Xem hồ sơ →" })
  .click();
await page.getByText("Phiên bản: 1", { exact: true }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw Error("Mobile overflow");
await page.screenshot({ path: "/tmp/gia-pha-mobile.png", fullPage: true });
await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
await page.getByRole("heading", { name: "Chào mừng trở về" }).waitFor();
await browser.close();
if (errors.length) throw Error(errors.join("\n"));
console.log("Browser: login, search, profile, mobile, logout passed.");
