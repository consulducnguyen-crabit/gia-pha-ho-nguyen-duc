import { describe, expect, it } from "vitest";
import {
  buildCreateWrite,
  CreateAccountError,
  generatePassword,
  loginEmailFor,
  PASSWORD_LENGTH,
} from "../src/accountCreate";
import { checkNewPassword } from "../src/passwordRules";
import { loginLabel } from "../src/phoneLogin";

describe("generatePassword", () => {
  it("đúng độ dài mặc định và chỉ gồm ký tự dễ đọc", () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(PASSWORD_LENGTH);
      expect(p).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]+$/);
    }
  });
  it("không chứa ký tự dễ nhầm 0 O o 1 l I", () => {
    const all = Array.from({ length: 500 }, () => generatePassword()).join("");
    expect(all).not.toMatch(/[0OoIl1]/);
  });
  it("từ chối byte ngoài vùng đều (không thiên lệch modulo) và vẫn đủ độ dài", () => {
    // 255 và 254 nằm ngoài vùng lấy mẫu nên bị bỏ; chuỗi byte hợp lệ theo sau được dùng.
    let call = 0;
    const rand = (n: number) =>
      call++ === 0 ? new Uint8Array(n).fill(255) : new Uint8Array(n).fill(0);
    const p = generatePassword(6, rand);
    expect(p).toBe("AAAAAA");
  });
  it("hai mật khẩu liên tiếp khác nhau", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe("loginEmailFor", () => {
  it("điện thoại → email ngầm", () => {
    expect(loginEmailFor("phone", "0914 222 987")).toBe(
      "0914222987@gp.nguyenduc",
    );
  });
  it("email: viết thường, bỏ khoảng trắng", () => {
    expect(loginEmailFor("email", "  A.B@Example.TEST ")).toBe(
      "a.b@example.test",
    );
  });
  it("từ chối số sai, email sai, và email giả @gp.nguyenduc ở tab Email", () => {
    for (const [k, v] of [
      ["phone", "123"],
      ["phone", ""],
      ["email", "khong-phai-email"],
      ["email", "a@b"],
      ["email", "0914222987@gp.nguyenduc"],
    ] as const)
      expect(() => loginEmailFor(k, v)).toThrow(CreateAccountError);
  });
});

describe("buildCreateWrite", () => {
  const base = {
    actorUid: "admin1",
    targetUid: "new1",
    email: "0914222987@gp.nguyenduc",
    kind: "phone" as const,
    displayName: "  Nguyễn Văn A ",
  };
  it("hồ sơ users chỉ xem, bắt buộc đổi mật khẩu, không có mật khẩu", () => {
    const w = buildCreateWrite(base);
    expect(w.userId).toBe("new1");
    expect(w.user).toEqual({
      enabled: true,
      roleIds: ["member"],
      canManageMembership: false,
      accessVersion: 1,
      schemaVersion: 1,
      email: "0914222987@gp.nguyenduc",
      displayName: "Nguyễn Văn A",
      approvedBy: "admin1",
      createdVia: "phone",
      mustChangePassword: true,
    });
    expect(Object.keys(w.user)).not.toContain("password");
    expect(JSON.stringify(w)).not.toMatch(/"password"/i);
  });
  it("tên trống thì bỏ hẳn displayName", () => {
    expect(
      buildCreateWrite({ ...base, displayName: "   " }).user,
    ).not.toHaveProperty("displayName");
  });
  it("nhật ký ACCOUNT_CREATED không chứa email hay tên", () => {
    const w = buildCreateWrite(base);
    expect(w.auditId).toBe("account-new1-1");
    expect(w.audit).toEqual({
      event: "ACCOUNT_CREATED",
      actorUid: "admin1",
      targetUid: "new1",
      accessVersion: 1,
      schemaVersion: 1,
    });
  });
  it("từ chối tên chứa ký tự điều khiển", () => {
    expect(() => buildCreateWrite({ ...base, displayName: "A\nB" })).toThrow();
  });
});

describe("checkNewPassword", () => {
  const login = "0914222987@gp.nguyenduc";
  it("hợp lệ", () => {
    expect(checkNewPassword("matkhau-moi-1", "matkhau-moi-1", login)).toBe("");
  });
  it("quá ngắn, không khớp, dùng số điện thoại", () => {
    expect(checkNewPassword("abc", "abc", login)).toMatch(/ít nhất 8/);
    expect(checkNewPassword("matkhau-moi-1", "matkhau-moi-2", login)).toMatch(
      /chưa khớp/,
    );
    expect(checkNewPassword("0914222987", "0914222987", login)).toMatch(
      /số điện thoại/,
    );
    expect(checkNewPassword("0914 222 987", "0914 222 987", login)).toMatch(
      /số điện thoại/,
    );
  });
  it("tài khoản email thật không bị chặn theo số", () => {
    expect(checkNewPassword("0914222987", "0914222987", "a@b.test")).toBe("");
  });
});

describe("loginLabel", () => {
  it("email ngầm → số điện thoại; email thật giữ nguyên; rỗng", () => {
    expect(loginLabel("0914222987@gp.nguyenduc")).toBe("0914222987");
    expect(loginLabel("a@b.test")).toBe("a@b.test");
    expect(loginLabel(null)).toBe("");
  });
});
