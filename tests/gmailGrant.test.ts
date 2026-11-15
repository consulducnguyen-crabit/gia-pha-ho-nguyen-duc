import { describe, expect, it } from "vitest";
import { buildClaimWrite, buildGrant, normalizeGmail } from "../src/gmailGrant";

describe("Gmail-only", () => {
  it("chuẩn hóa: viết thường, cắt khoảng trắng", () => {
    expect(normalizeGmail("  Ten.Ho@Gmail.com ")).toBe("ten.ho@gmail.com");
  });
  it("chỉ nhận @gmail.com", () => {
    for (const bad of [
      "a@example.com",
      "a@googlemail.com",
      "a@gmail.com.vn",
      "@gmail.com",
      "a b@gmail.com",
      "0914222987@gp.nguyenduc",
      `${"a".repeat(60)}@gmail.com`,
    ])
      expect(() => normalizeGmail(bad), bad).toThrow();
  });
  it("grant: không có tên thì không ghi displayName", () => {
    const g = buildGrant({
      actorUid: "a1",
      email: "x@gmail.com",
      displayName: "",
    });
    expect(g.id).toBe("x@gmail.com");
    expect(g.data).toEqual({
      email: "x@gmail.com",
      createdBy: "a1",
      schemaVersion: 1,
    });
  });
  it("claim: chỉ xem, createdVia google, không mustChangePassword, audit ACCOUNT_CLAIMED", () => {
    const w = buildClaimWrite({
      uid: "u1",
      email: "x@gmail.com",
      grant: { displayName: "Tên giả", createdBy: "a1" },
    });
    expect(w.user).toEqual({
      enabled: true,
      roleIds: ["member"],
      canManageMembership: false,
      accessVersion: 1,
      schemaVersion: 1,
      email: "x@gmail.com",
      displayName: "Tên giả",
      approvedBy: "a1",
      createdVia: "google",
    });
    expect(w.auditId).toBe("account-u1-1");
    expect(w.audit).toMatchObject({
      event: "ACCOUNT_CLAIMED",
      actorUid: "u1",
      targetUid: "u1",
    });
  });
});
