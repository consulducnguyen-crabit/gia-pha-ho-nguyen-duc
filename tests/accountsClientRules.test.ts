// Chạy updateAccount (giao dịch thật) qua firestore.rules trên emulator: dữ liệu dựng phải được rules chấp nhận.
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import {
  AccountError,
  accountErrorMessage,
  updateAccount,
} from "../src/accountsClient";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha-accounts-client",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}, 30000);
afterAll(async () => {
  await env?.cleanup();
});
const user = (extra: object = {}) => ({
  enabled: true,
  roleIds: ["member"],
  canManageMembership: false,
  accessVersion: 1,
  schemaVersion: 1,
  displayName: "Tên giả",
  email: "x@example.test",
  ...extra,
});
const ledgerDoc = (adminUids: string[]) => ({
  adminUids,
  version: 1,
  lastTargetUid: "",
  schemaVersion: 1,
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const u of ["a1", "a2"])
      await setDoc(doc(db, "users", u), user({ canManageMembership: true }));
    await setDoc(doc(db, "users", "m1"), user());
    await setDoc(doc(db, "users", "off"), user({ enabled: false }));
    await setDoc(doc(db, "users", "legacy"), {
      enabled: true,
      roleIds: ["member"],
      accessVersion: 1,
      schemaVersion: 1,
    });
    await setDoc(doc(db, "accessControl", "admins"), ledgerDoc(["a1", "a2"]));
  });
});
const as = (uid: string) =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;
const read = async (path: string, id: string) => {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (c) => {
    data = (await getDoc(doc(c.firestore(), path, id))).data();
  });
  return data;
};

describe("updateAccount qua firestore.rules", () => {
  it("đổi tên", async () => {
    await updateAccount(as("a1"), "a1", "m1", { displayName: "Tên Mới" });
    expect((await read("users", "m1"))?.displayName).toBe("Tên Mới");
    expect((await read("users", "m1"))?.accessVersion).toBe(2);
    expect((await read("auditLogs", "account-m1-2"))?.event).toBe(
      "ACCOUNT_UPDATED",
    );
    expect((await read("accessControl", "admins"))?.version).toBe(1);
  });
  it("nâng rồi hạ quyền: users, sổ và nhật ký cùng đổi", async () => {
    await updateAccount(as("a1"), "a1", "m1", { admin: true });
    let l = await read("accessControl", "admins");
    expect(l?.adminUids).toEqual(["a1", "a2", "m1"]);
    expect(l?.version).toBe(2);
    expect(l?.lastTargetUid).toBe("m1");
    // người vừa được nâng thao tác được ngay
    await updateAccount(as("m1"), "m1", "a2", { admin: false });
    l = await read("accessControl", "admins");
    expect(l?.adminUids).toEqual(["a1", "m1"]);
    await updateAccount(as("a1"), "a1", "m1", { admin: false });
    expect((await read("accessControl", "admins"))?.adminUids).toEqual(["a1"]);
    expect((await read("users", "m1"))?.canManageMembership).toBe(false);
  });
  it("vô hiệu hóa rồi bật lại; vô hiệu hóa quản trị viên khác hạ cả quyền", async () => {
    await updateAccount(as("a1"), "a1", "m1", { enabled: false });
    expect((await read("users", "m1"))?.enabled).toBe(false);
    expect((await read("users", "m1"))?.disabledBy).toBe("a1");
    await updateAccount(as("a1"), "a1", "m1", { enabled: true });
    expect((await read("users", "m1"))?.approvedBy).toBe("a1");
    await updateAccount(as("a1"), "a1", "a2", { enabled: false });
    expect((await read("users", "a2"))?.canManageMembership).toBe(false);
    expect((await read("accessControl", "admins"))?.adminUids).toEqual(["a1"]);
  });
  it("bật lại tài khoản đã tắt, rồi nâng quyền", async () => {
    await updateAccount(as("a1"), "a1", "off", { enabled: true });
    await updateAccount(as("a1"), "a1", "off", { admin: true });
    expect((await read("accessControl", "admins"))?.adminUids).toEqual([
      "a1",
      "a2",
      "off",
    ]);
  });
  it("users cũ thiếu canManageMembership vẫn sửa được (ghi bool tường minh)", async () => {
    await updateAccount(as("a1"), "a1", "legacy", { displayName: "Cũ" });
    expect((await read("users", "legacy"))?.canManageMembership).toBe(false);
  });
  it("đổi tên + nâng quyền trong một lần", async () => {
    await updateAccount(as("a1"), "a1", "m1", {
      displayName: "Đồng Thời",
      admin: true,
    });
    expect((await read("auditLogs", "account-m1-2"))?.fields).toEqual([
      "admin",
      "displayName",
    ]);
  });
  it("lỗi phía client không chạm dữ liệu: tự đổi mình, không đổi gì", async () => {
    await expect(
      updateAccount(as("a1"), "a1", "a1", { displayName: "Y" }),
    ).rejects.toBeInstanceOf(AccountError);
    await expect(
      updateAccount(as("a1"), "a1", "m1", {}),
    ).rejects.toBeInstanceOf(AccountError);
    expect((await read("users", "m1"))?.accessVersion).toBe(1);
  });
  it("quyền đã đổi: người thao tác đã bị tắt trong users thì permission-denied, thông báo tiếng Việt", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "users", "a1"),
        user({ enabled: false, canManageMembership: false }),
      );
    });
    const err = await updateAccount(as("a1"), "a1", "m1", {
      displayName: "Y",
    }).catch((e) => e);
    expect(accountErrorMessage(err)).toBe(
      "Không thực hiện được: quyền đã thay đổi hoặc dữ liệu vừa được người khác sửa. Hãy tải lại và thử lại.",
    );
  });
  it("thành viên thường không sửa được; người thao tác không có trong sổ bị chặn phía client", async () => {
    await assertFails(
      updateAccount(as("m1"), "m1", "legacy", { displayName: "Y" }),
    );
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "accessControl", "admins"),
        ledgerDoc(["a2"]),
      );
    });
    const e2 = await updateAccount(as("a1"), "a1", "m1", {
      displayName: "Z",
    }).catch((e) => e);
    expect((e2 as AccountError).code).toBe("LEDGER_ACTOR");
  });
});

describe("đua ghi giữa hai quản trị viên (retry khi dữ liệu vừa đổi)", () => {
  const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);
  it("cùng tài khoản: đổi tên (a1) và nâng quyền (a2) cùng lúc: cả hai được áp dụng hoặc báo lỗi rõ", async () => {
    const r = await settle([
      updateAccount(as("a1"), "a1", "m1", { displayName: "Tên Đua" }),
      updateAccount(as("a2"), "a2", "m1", { admin: true }),
    ]);
    const u = await read("users", "m1");
    const l = await read("accessControl", "admins");
    for (const x of r)
      if (x.status === "rejected")
        expect(accountErrorMessage(x.reason)).toMatch(/\S/);
    const ok = r.filter((x) => x.status === "fulfilled").length;
    expect(ok).toBeGreaterThanOrEqual(1);
    // Mỗi lần thành công tăng accessVersion đúng một; dữ liệu nhất quán với sổ.
    expect(u?.accessVersion).toBe(1 + ok);
    expect((l?.adminUids as string[]).includes("m1")).toBe(
      u?.canManageMembership === true,
    );
    if (ok === 2) {
      expect(u?.displayName).toBe("Tên Đua");
      expect(u?.canManageMembership).toBe(true);
    }
  });
  it("hai người khác nhau: cả hai phải thành công sau retry", async () => {
    const r = await settle([
      updateAccount(as("a1"), "a1", "m1", { admin: true }),
      updateAccount(as("a2"), "a2", "legacy", { admin: true }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    const l = await read("accessControl", "admins");
    expect([...(l?.adminUids as string[])].sort()).toEqual(
      ["a1", "a2", "legacy", "m1"].sort(),
    );
    expect(l?.version).toBe(3);
  });
  it("hai quản trị hạ nhau: đúng một thành công, sổ không rỗng", async () => {
    const r = await settle([
      updateAccount(as("a1"), "a1", "a2", { admin: false }),
      updateAccount(as("a2"), "a2", "a1", { admin: false }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const l = await read("accessControl", "admins");
    expect((l?.adminUids as string[]).length).toBe(1);
    const survivor = (l?.adminUids as string[])[0];
    expect((await read("users", survivor))?.canManageMembership).toBe(true);
    const failed = r.find((x) => x.status === "rejected") as
      PromiseRejectedResult | undefined;
    expect(accountErrorMessage(failed?.reason)).toMatch(/\S/);
  });
});
