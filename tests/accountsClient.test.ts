// Kiểm thử hàm dựng dữ liệu thuần của accountsClient (không I/O). Dữ liệu giả.
import { describe, expect, it } from "vitest";
import {
  AccountError,
  SERVER_TIME,
  accountErrorMessage,
  buildAccountUpdate,
  ledgerShapeOk,
  validateAccountName,
} from "../src/accountsClient";

const ledger = { adminUids: ["a1", "a2"], version: 3 };
const member = {
  enabled: true,
  canManageMembership: false,
  accessVersion: 2,
  displayName: "Tên Cũ",
};
const admin = { ...member, canManageMembership: true };
const run = (
  before: Record<string, unknown> | undefined,
  patch = {},
  l: unknown = ledger,
  target = "m1",
  actor = "a1",
) =>
  buildAccountUpdate({
    actorUid: actor,
    targetUid: target,
    before,
    ledger: l,
    patch,
  });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AccountError).code;
  }
  return null;
};

describe("buildAccountUpdate — khớp giả định của firestore.rules", () => {
  it("đổi tên: chỉ các khóa cho phép, accessVersion +1, không đụng sổ", () => {
    const u = run(member, { displayName: "  Tên Mới " });
    expect(u.ledgerWrite).toBeNull();
    expect(u.accessVersion).toBe(3);
    expect(Object.keys(u.userPatch).sort()).toEqual(
      [
        "accessVersion",
        "canManageMembership",
        "displayName",
        "enabled",
        "updatedAt",
        "updatedBy",
      ].sort(),
    );
    expect(u.userPatch.displayName).toBe("Tên Mới");
    expect(u.userPatch.updatedAt).toBe(SERVER_TIME);
    expect(u.userPatch.updatedBy).toBe("a1");
    expect(u.auditId).toBe("account-m1-3");
    expect(u.audit).toMatchObject({
      event: "ACCOUNT_UPDATED",
      actorUid: "a1",
      targetUid: "m1",
      accessVersion: 3,
      fields: ["displayName"],
      before: { enabled: true, admin: false },
      after: { enabled: true, admin: false },
      schemaVersion: 1,
    });
  });
  it("nâng quyền: sổ thêm uid ở CUỐI, version +1, lastTargetUid, giá trị cụ thể", () => {
    const u = run(member, { admin: true });
    expect(u.ledgerWrite).toEqual({
      adminUids: ["a1", "a2", "m1"],
      version: 4,
      lastTargetUid: "m1",
    });
    expect(u.userPatch.canManageMembership).toBe(true);
    expect(u.audit.fields).toEqual(["admin"]);
    expect(u.audit.after).toEqual({ enabled: true, admin: true });
  });
  it("hạ quyền: sổ bỏ đúng một uid", () => {
    const u = run(
      admin,
      { admin: false },
      { adminUids: ["a1", "m1", "a2"], version: 7 },
    );
    expect(u.ledgerWrite).toEqual({
      adminUids: ["a1", "a2"],
      version: 8,
      lastTargetUid: "m1",
    });
  });
  it("vô hiệu hóa quản trị viên cũng hạ quyền quản trị (canManage kéo theo enabled) và ghi sổ", () => {
    const u = run(
      admin,
      { enabled: false },
      { adminUids: ["a1", "m1"], version: 1 },
    );
    expect(u.userPatch).toMatchObject({
      enabled: false,
      canManageMembership: false,
      disabledBy: "a1",
      disabledAt: SERVER_TIME,
    });
    expect(u.ledgerWrite?.adminUids).toEqual(["a1"]);
    expect(u.audit.fields).toEqual(["enabled", "admin"]);
    expect(u.audit.before).toEqual({ enabled: true, admin: true });
    expect(u.audit.after).toEqual({ enabled: false, admin: false });
  });
  it("vô hiệu hóa thành viên thường không đụng sổ; bật lại đặt approvedBy/At và KHÔNG khôi phục quản trị", () => {
    const off = run(member, { enabled: false });
    expect(off.ledgerWrite).toBeNull();
    const legacy = {
      enabled: false,
      canManageMembership: true,
      accessVersion: 1,
    };
    const on = run(legacy, { enabled: true });
    expect(on.userPatch).toMatchObject({
      enabled: true,
      canManageMembership: false,
      approvedBy: "a1",
      approvedAt: SERVER_TIME,
    });
    expect(on.ledgerWrite).toBeNull();
  });
  it("luôn ghi bool tường minh, kể cả khi users thiếu canManageMembership; accessVersion thiếu = 0", () => {
    const u = run({ enabled: true }, { displayName: "X" });
    expect(u.userPatch.canManageMembership).toBe(false);
    expect(u.accessVersion).toBe(1);
  });
  it("nhật ký không chứa tên hoặc email", () => {
    const u = run(
      { ...member, email: "x@example.test" },
      { displayName: "Tên Riêng Tư", admin: true },
    );
    const text = JSON.stringify(u.audit);
    expect(text).not.toContain("Tên Riêng Tư");
    expect(text).not.toContain("@");
    expect(Object.keys(u.audit.before as object).sort()).toEqual([
      "admin",
      "enabled",
    ]);
    expect(Object.keys(u.audit.after as object).sort()).toEqual([
      "admin",
      "enabled",
    ]);
  });
  it("chặn phía client: tự đổi mình, không thay đổi, tên sai, quản trị khi đã tắt", () => {
    expect(
      code(() => run(member, { displayName: "Y" }, ledger, "a1", "a1")),
    ).toBe("SELF");
    expect(code(() => run(member, {}))).toBe("NO_CHANGE");
    expect(code(() => run(member, { displayName: "Tên Cũ" }))).toBe(
      "NO_CHANGE",
    );
    expect(code(() => run(member, { enabled: true, admin: false }))).toBe(
      "NO_CHANGE",
    );
    for (const bad of ["", "   ", "a".repeat(121), "a\u0000b", "dòng\nmới"])
      expect(code(() => run(member, { displayName: bad }))).toBe(
        "INVALID_NAME",
      );
    expect(
      code(() => run({ ...member, enabled: false }, { admin: true })),
    ).toBe("INVALID_STATE");
    expect(code(() => run(member, { enabled: false, admin: true }))).toBe(
      "INVALID_STATE",
    );
    expect(code(() => run(undefined, { displayName: "Y" }))).toBe("NOT_FOUND");
  });
  it("sổ thiếu/hỏng, người thao tác không có trong sổ, sổ đầy, sổ lệch, dữ liệu hỏng", () => {
    expect(code(() => run(member, { admin: true }, null))).toBe(
      "LEDGER_MISSING",
    );
    expect(
      code(() => run(member, { admin: true }, { adminUids: "a1", version: 1 })),
    ).toBe("LEDGER_MISSING");
    expect(
      code(() =>
        run(member, { admin: true }, { adminUids: ["a1", "a1"], version: 1 }),
      ),
    ).toBe("LEDGER_MISSING");
    expect(
      code(() =>
        run(member, { admin: true }, { adminUids: ["a2"], version: 1 }),
      ),
    ).toBe("LEDGER_ACTOR");
    const full = {
      adminUids: ["a1", ...Array.from({ length: 19 }, (_, i) => `u${i}`)],
      version: 1,
    };
    expect(code(() => run(member, { admin: true }, full))).toBe("LEDGER_FULL");
    expect(
      code(() =>
        run(member, { admin: true }, { adminUids: ["a1", "m1"], version: 1 }),
      ),
    ).toBe("INVALID_STATE");
    expect(
      code(() =>
        run(admin, { admin: false }, { adminUids: ["a1"], version: 1 }),
      ),
    ).toBe("INVALID_STATE");
    expect(
      code(() => run({ ...member, accessVersion: -1 }, { displayName: "Z" })),
    ).toBe("INVALID_STATE");
    expect(
      code(() => run({ ...member, enabled: "yes" }, { displayName: "Z" })),
    ).toBe("INVALID_STATE");
  });
  it("validateAccountName/ledgerShapeOk", () => {
    expect(validateAccountName("  Nguyễn Đức Giả ")).toBe("Nguyễn Đức Giả");
    expect(ledgerShapeOk(ledger)).toBe(true);
    expect(ledgerShapeOk({ adminUids: [1], version: 1 })).toBe(false);
    expect(ledgerShapeOk({ adminUids: [], version: 1.5 })).toBe(false);
  });
});

describe("accountErrorMessage — tiếng Việt", () => {
  it("ánh xạ mã lỗi", () => {
    expect(accountErrorMessage({ code: "permission-denied" })).toBe(
      "Không thực hiện được: quyền đã thay đổi hoặc dữ liệu vừa được người khác sửa. Hãy tải lại và thử lại.",
    );
    expect(accountErrorMessage({ code: "aborted" })).toMatch(
      /người khác thay đổi/,
    );
    expect(accountErrorMessage({ code: "failed-precondition" })).toMatch(
      /người khác thay đổi/,
    );
    expect(accountErrorMessage({ code: "not-found" })).toMatch(
      /Không tìm thấy/,
    );
    expect(accountErrorMessage({ code: "unavailable" })).toMatch(/mạng/);
    expect(
      accountErrorMessage(
        new AccountError("SELF", "Không tự đổi quyền của chính mình."),
      ),
    ).toBe("Không tự đổi quyền của chính mình.");
    expect(accountErrorMessage(new Error("x"))).toMatch(/Không lưu được/);
  });
});
