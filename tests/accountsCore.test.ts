import { describe, expect, it } from "vitest";
import {
  ACTOR,
  buildGrant,
  buildRevoke,
  buildRole,
  generatePassword,
  isActiveAdmin,
  validateEmail,
  validateName,
  wouldRemoveLastAdmin,
} from "../scripts/gia-pha/accounts-core";

// Dữ liệu hoàn toàn giả.
const now = { fake: "timestamp" };

describe("kiểm tra đầu vào", () => {
  it("chuẩn hóa email và từ chối giá trị sai", () => {
    expect(validateEmail("  Nguoi.Gia@Example.TEST ")).toBe(
      "nguoi.gia@example.test",
    );
    for (const bad of [
      undefined,
      "",
      "abc",
      "a@b",
      "a b@c.d",
      "@x.y",
      `${"a".repeat(250)}@x.yz`,
    ])
      expect(() => validateEmail(bad)).toThrow();
  });
  it("kiểm tra họ tên", () => {
    expect(validateName(undefined)).toBeUndefined();
    expect(validateName("  Người Giả ")).toBe("Người Giả");
    expect(() => validateName("   ")).toThrow();
    expect(() => validateName("a\u0000b")).toThrow();
    expect(() => validateName("x".repeat(121))).toThrow();
  });
  it("mật khẩu ngẫu nhiên đủ dài, không ký tự dễ nhầm và không lặp", () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toHaveLength(16);
    expect(a).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/,
    );
    expect(a).not.toBe(b);
  });
});

describe("hồ sơ quyền users/{uid}", () => {
  it("cấp quyền mới: thành viên thường, phiên bản quyền tăng, ghi người cấp", () => {
    const doc = buildGrant(
      undefined,
      { email: "a@x.test", name: "Người Giả" },
      now,
    );
    expect(doc).toEqual({
      enabled: true,
      roleIds: ["member"],
      accessVersion: 1,
      approvedBy: ACTOR,
      approvedAt: now,
      schemaVersion: 1,
      email: "a@x.test",
      displayName: "Người Giả",
    });
    expect(doc).not.toHaveProperty("canManageMembership");
  });
  it("cấp lại giữ cờ đặc quyền cũ và tăng accessVersion (vô hiệu hóa lời mời/phiếu cũ)", () => {
    const existing = {
      enabled: false,
      roleIds: ["member"],
      accessVersion: 3,
      canReviewChanges: true,
      schemaVersion: 1,
    };
    const doc = buildGrant(existing, { email: "a@x.test" }, now);
    expect(doc).toMatchObject({
      enabled: true,
      accessVersion: 4,
      canReviewChanges: true,
    });
  });
  it("chỉ gắn đặc quyền khi được yêu cầu rõ", () => {
    expect(
      buildGrant(undefined, { email: "a@x.test", admin: true }, now),
    ).toMatchObject({ canManageMembership: true });
    expect(
      buildGrant(undefined, { email: "a@x.test", reviewer: true }, now),
    ).toMatchObject({ canReviewChanges: true });
  });
  it("thu hồi: tắt quyền, tăng accessVersion, giữ vai trò member", () => {
    const doc = buildRevoke(
      {
        enabled: true,
        roleIds: ["member"],
        accessVersion: 2,
        canManageMembership: true,
      },
      now,
    );
    expect(doc).toMatchObject({
      enabled: false,
      accessVersion: 3,
      disabledBy: ACTOR,
      roleIds: ["member"],
    });
  });
  it("đổi vai trò chỉ cho tài khoản đang được cấp quyền", () => {
    expect(() => buildRole(undefined, { admin: true })).toThrow();
    expect(() =>
      buildRole({ enabled: false, accessVersion: 1 }, { admin: true }),
    ).toThrow();
    const doc = buildRole(
      { enabled: true, accessVersion: 1, canManageMembership: true },
      { admin: false, reviewer: true },
    );
    expect(doc).toMatchObject({
      canManageMembership: false,
      canReviewChanges: true,
      accessVersion: 2,
    });
  });
  it("accessVersion hỏng thì dừng thay vì đoán", () => {
    expect(() =>
      buildGrant({ accessVersion: "x" }, { email: "a@x.test" }, now),
    ).toThrow();
    expect(() =>
      buildGrant({ accessVersion: -1 }, { email: "a@x.test" }, now),
    ).toThrow();
  });
});

describe("bảo vệ quản trị viên cuối cùng", () => {
  const admin = { enabled: true, canManageMembership: true };
  it("nhận diện quản trị viên đang hoạt động", () => {
    expect(isActiveAdmin(admin)).toBe(true);
    expect(isActiveAdmin({ enabled: false, canManageMembership: true })).toBe(
      false,
    );
    expect(isActiveAdmin({ enabled: true })).toBe(false);
  });
  it("chặn thu hồi người quản trị duy nhất, cho phép khi còn người khác", () => {
    const revoked = { ...admin, enabled: false };
    expect(wouldRemoveLastAdmin(admin, [admin], revoked)).toBe(true);
    expect(wouldRemoveLastAdmin(admin, [admin, { ...admin }], revoked)).toBe(
      false,
    );
    expect(
      wouldRemoveLastAdmin({ enabled: true }, [admin], { enabled: false }),
    ).toBe(false);
    expect(wouldRemoveLastAdmin(admin, [admin], { ...admin })).toBe(false);
  });
});
