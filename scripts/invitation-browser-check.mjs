// NGỪNG DÙNG (PR-D): kiểm tra UI #/accounts của hệ lời mời cũ emulator-only; giao diện đó đã bị ẩn. Lời mời hiện tại: invites-browser-check.mjs.
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

// All privileged fixture operations are fixed to local demo emulators.
const password = "Demo-only-2026!";
const invitationIds = new Set();
let managerToken;
let browser;
let stage = "initialization";
let pageErrors = 0;
let dialogErrors = 0;
let dialogCount = 0;
let cancelNext = false;
function confirmations(page) {
  page.on("dialog", async (dialog) => {
    const valid =
      dialog.type() === "confirm" &&
      (/^Thu hồi lời mời [a-f0-9]{64}\? Người nhận sẽ không còn dùng được mã này\.$/.test(
        dialog.message(),
      ) ||
        dialog.message() ===
          "Thu hồi quyền thành viên của tài khoản demo-invitee? Tài khoản sẽ không đọc được dữ liệu gia phả; các lời mời cũ sẽ mất hiệu lực.");
    if (!valid) {
      dialogErrors++;
      await dialog.dismiss();
      return;
    }
    dialogCount++;
    if (cancelNext) {
      cancelNext = false;
      await dialog.dismiss();
    } else await dialog.accept();
  });
}

async function capability(enabled) {
  const response = await fetch(
    "http://127.0.0.1:8080/v1/projects/demo-gia-pha/databases/(default)/documents/users/demo-manager?updateMask.fieldPaths=canManageMembership",
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: { canManageMembership: { booleanValue: enabled } },
      }),
    },
  );
  if (!response.ok) throw Error("Local capability fixture update failed");
}
async function backend(name, data) {
  const response = await fetch(
    `http://127.0.0.1:5001/demo-gia-pha/us-central1/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data }),
    },
  );
  const result = await response.json();
  if (!response.ok || result.error)
    throw Error("Local fixture cleanup operation failed");
  return result.result;
}
async function login(page, email) {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "Chào mừng trở về" }).waitFor();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập →" }).click();
}
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile layout overflow");
}
async function issue(page) {
  await page
    .getByLabel("Email người được mời", { exact: true })
    .fill("duocmoi@example.test");
  await page.getByRole("button", { name: "Tạo lời mời", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Đã tạo lời mời. Chưa gửi email.",
  );
  const token = await page
    .getByLabel("Mã nhận quyền", { exact: true })
    .inputValue();
  const id = await page
    .getByLabel("Mã quản lý lời mời", { exact: true })
    .inputValue();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(id))
    throw Error("Invalid invitation response shape");
  invitationIds.add(id);
  return { token, id };
}
async function accept(page, token, succeeds) {
  await page.getByLabel("Mã lời mời", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Nhận lời mời", exact: true }).click();
  if (succeeds) {
    await page
      .getByRole("heading", { name: "Người có tổ, cây có nguồn." })
      .waitFor();
  } else {
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("heading", { name: "Chờ cấp quyền" }).waitFor();
    await expect(page.locator(".person")).toHaveCount(0);
  }
}
async function disable(page, expectedStatus = "Đã thu hồi quyền thành viên.") {
  await page
    .getByLabel("UID tài khoản cần thu hồi", { exact: true })
    .fill("demo-invitee");
  await page
    .getByRole("button", { name: "Thu hồi quyền thành viên", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(expectedStatus);
}

let failed = false;
try {
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "quanly@example.test",
        password,
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok) throw Error("Local manager login failed");
  const auth = await response.json();
  if (auth.localId !== "demo-manager" || typeof auth.idToken !== "string")
    throw Error("Unexpected local manager fixture");
  managerToken = auth.idToken;
  await capability(true);
  await backend("disableMembership", {
    targetUid: "demo-invitee",
    requestId: randomUUID(),
  });

  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
  });
  const managerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const manager = await managerContext.newPage();
  const invitee = await inviteeContext.newPage();
  for (const page of [manager, invitee])
    page.on("pageerror", () => {
      pageErrors++;
    });

  confirmations(manager);
  stage = "manager login and account screen";
  await login(manager, "quanly@example.test");
  await manager
    .getByRole("link", { name: "Tài khoản và lời mời", exact: true })
    .click();
  await manager
    .getByRole("heading", { name: "Tài khoản và lời mời", exact: true })
    .waitFor();
  await mobile(manager);
  stage = "issue invitation";
  const first = await issue(manager);
  await manager
    .getByRole("button", { name: "Ẩn mã lời mời", exact: true })
    .click();

  stage = "pending login and invalid invitation";
  await login(invitee, "duocmoi@example.test");
  await invitee.getByRole("heading", { name: "Chờ cấp quyền" }).waitFor();
  await mobile(invitee);
  await accept(invitee, "invalid-local-token", false);
  stage = "accept and search";
  await accept(invitee, first.token, true);
  await invitee
    .getByRole("link", { name: "♧ Tra cứu thành viên", exact: true })
    .click();
  await invitee.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  await invitee
    .getByRole("heading", { name: "Nhân vật giả 1", exact: true })
    .waitFor();
  await expect(
    invitee.getByRole("link", { name: "Tài khoản và lời mời", exact: true }),
  ).toHaveCount(0);

  stage = "cancel revocation keeps account access and sends no mutation";
  let disableRequests = 0;
  manager.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/disableMembership")
    )
      disableRequests++;
  });
  await manager
    .getByLabel("UID tài khoản cần thu hồi", { exact: true })
    .fill("demo-invitee");
  const dialogsBeforeCancel = dialogCount;
  const statusBeforeCancel = await manager.getByRole("status").textContent();
  cancelNext = true;
  await manager
    .getByRole("button", { name: "Thu hồi quyền thành viên", exact: true })
    .click();
  await expect.poll(() => dialogCount).toBe(dialogsBeforeCancel + 1);
  await expect(
    manager.getByLabel("UID tài khoản cần thu hồi", { exact: true }),
  ).toHaveValue("demo-invitee");
  await expect(manager.getByRole("status")).toHaveText(statusBeforeCancel);
  await expect(
    invitee.getByRole("heading", { name: "Nhân vật giả 1", exact: true }),
  ).toBeVisible();
  if (disableRequests !== 0)
    throw Error("Canceled disable made a mutation request");

  stage = "no-op retry reports accurately and renews request ID";
  let handledRequestId;
  let interceptedRetry = false;
  const disablePattern = "**/disableMembership";
  const handledRetry = async (route) => {
    if (route.request().method() !== "POST" || interceptedRetry)
      return route.continue();
    interceptedRetry = true;
    handledRequestId = route.request().postDataJSON()?.data?.requestId;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5173" },
      body: JSON.stringify({ result: { changed: false } }),
    });
  };
  await manager.route(disablePattern, handledRetry);
  await disable(
    manager,
    "Yêu cầu trước đã được xử lý; quyền hiện tại có thể đã thay đổi. Gửi yêu cầu mới nếu cần thu hồi lại.",
  );
  await expect(
    invitee.getByRole("heading", { name: "Nhân vật giả 1", exact: true }),
  ).toBeVisible();
  await manager.unroute(disablePattern, handledRetry);
  if (typeof handledRequestId !== "string")
    throw Error("Missing handled retry request ID");

  stage = "membership revocation and replay rejection";
  const nextRequest = manager.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/disableMembership"),
  );
  await disable(manager);
  const nextRequestId = (await nextRequest).postDataJSON()?.data?.requestId;
  if (typeof nextRequestId !== "string" || nextRequestId === handledRequestId)
    throw Error("A new revocation must use a fresh request ID");
  await invitee.getByRole("heading", { name: "Chờ cấp quyền" }).waitFor();
  await expect(invitee.locator(".person, .detail")).toHaveCount(0);
  await accept(invitee, first.token, false);

  stage = "fresh invitation restores membership";
  const second = await issue(manager);
  await manager
    .getByRole("button", { name: "Ẩn mã lời mời", exact: true })
    .click();
  // The hash route is retained from the search page when membership returns.
  await invitee.getByLabel("Mã lời mời", { exact: true }).fill(second.token);
  await invitee
    .getByRole("button", { name: "Nhận lời mời", exact: true })
    .click();
  await invitee
    .getByRole("heading", { name: "Tra cứu thành viên", exact: true })
    .waitFor();
  await invitee.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  await invitee
    .getByRole("heading", { name: "Nhân vật giả 1", exact: true })
    .waitFor();

  stage = "invitation revocation";
  await disable(manager);
  await invitee.getByRole("heading", { name: "Chờ cấp quyền" }).waitFor();
  const third = await issue(manager);
  await manager
    .getByLabel("Mã lời mời cần thu hồi", { exact: true })
    .fill(third.id);
  await manager
    .getByRole("button", { name: "Thu hồi lời mời", exact: true })
    .click();
  await expect(manager.getByRole("status")).toHaveText("Đã thu hồi lời mời.");
  await expect(
    manager.getByLabel("Mã nhận quyền", { exact: true }),
  ).toHaveCount(0);
  await accept(invitee, third.token, false);

  stage = "manager capability removal clears privileged screen";
  await issue(manager);
  await capability(false);
  await expect(
    manager.getByRole("link", { name: "Tài khoản và lời mời", exact: true }),
  ).toHaveCount(0);
  await manager
    .getByRole("heading", { name: "Không tìm thấy trang", exact: true })
    .waitFor();
  await expect(
    manager.getByLabel("Mã nhận quyền", { exact: true }),
  ).toHaveCount(0);
  await expect(
    manager.getByLabel("Email người được mời", { exact: true }),
  ).toHaveCount(0);
  await mobile(manager);
  if (pageErrors || dialogErrors || dialogCount < 5)
    throw Error("Unexpected browser page error or confirmation coverage");
} catch {
  // Suppress Playwright input call logs so a failed fill cannot expose a token.
  failed = true;
} finally {
  try {
    await capability(true);
    if (managerToken) {
      for (const invitationId of invitationIds)
        await backend("revokeInvitation", { invitationId });
      await backend("disableMembership", {
        targetUid: "demo-invitee",
        requestId: randomUUID(),
      });
    }
  } catch {
    failed = true;
    stage = "fixture cleanup";
  }
  await browser?.close();
}
if (failed)
  throw Error(`Invitation browser verification failed at stage: ${stage}`);
console.log(
  "Browser: invitation create/accept/replay/revoke, re-invite, no-op retry status and new request ID, membership revoke, confirmation/cancel guards, manager capability removal, mobile and cleanup passed.",
);
