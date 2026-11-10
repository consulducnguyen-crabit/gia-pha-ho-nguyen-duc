import { chromium, expect } from "@playwright/test";
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
await page.getByLabel("Họ tên", { exact: true }).fill("khong-co-ho-so-gia");
await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
await expect(page.getByRole("status")).toHaveText("Không tìm thấy hồ sơ.");
await expect(page.locator(".person")).toHaveCount(0);
await page.getByLabel("Họ tên", { exact: true }).fill("nhan vat gia");
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

// These privileged calls are deliberately fixed to the local demo emulators.
// Never allow a command-line argument or environment value to select a host.
const login = await fetch(
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "thanhvien@example.test",
      password: "Demo-only-2026!",
      returnSecureToken: true,
    }),
  },
);
if (!login.ok) throw Error(`Local test account lookup failed: ${login.status}`);
const { localId } = await login.json();
if (typeof localId !== "string" || !localId)
  throw Error("Local test account has no UID");
async function membership(enabled) {
  const response = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-gia-pha/databases/(default)/documents/users/${encodeURIComponent(localId)}?updateMask.fieldPaths=enabled`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { enabled: { booleanValue: enabled } } }),
    },
  );
  if (!response.ok)
    throw Error(`Local test membership update failed: ${response.status}`);
}
try {
  await membership(false);
  await page.getByRole("heading", { name: "Chờ cấp quyền" }).waitFor();
  await expect(page.locator(".person, .detail")).toHaveCount(0);
  await expect(page.getByText("Phiên bản: 1", { exact: true })).toHaveCount(0);
  await membership(true);
  await page
    .getByRole("heading", { name: "Tra cứu thành viên", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  await page
    .getByRole("heading", { name: "Nhân vật giả 1", exact: true })
    .waitFor();

  await page.context().setOffline(true);
  await expect(page.getByRole("status")).toHaveText(
    "Đang kiểm tra quyền truy cập…",
    { timeout: 30000 },
  );
  await expect(page.locator(".person, .detail")).toHaveCount(0);
  // The browser is offline, but this Node-side emulator call still revokes access.
  await membership(false);
  await page.context().setOffline(false);
  await page.getByRole("heading", { name: "Chờ cấp quyền" }).waitFor();
  await expect(page.locator(".person, .detail")).toHaveCount(0);
  await membership(true);
  await page
    .getByRole("heading", { name: "Tra cứu thành viên", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  await page
    .getByRole("heading", { name: "Nhân vật giả 1", exact: true })
    .waitFor();
} finally {
  await page.context().setOffline(false);
  await membership(true);
}
await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
await page.getByRole("heading", { name: "Chào mừng trở về" }).waitFor();
await browser.close();
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "Browser: login, search/no-match/recovery, profile, mobile, membership revocation, offline gate/reconnect, logout passed.",
);
