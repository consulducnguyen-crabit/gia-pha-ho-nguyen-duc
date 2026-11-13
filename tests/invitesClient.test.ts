// Kiểm thử hàm dựng dữ liệu thuần của lời mời và đăng nhập bằng liên kết email. Dữ liệu giả.
import { createHash, randomUUID } from "node:crypto";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_MS,
  InviteError,
  SERVER_TIME,
  buildAcceptance,
  buildInvite,
  buildRevoke,
  inviteErrorMessage,
  inviteKeyHash,
  inviteStatus,
  normalizeInviteEmail,
} from "../src/invitesClient";
import {
  STORED_EMAIL_TTL_MS,
  actionCodeSettings,
  cleanedUrl,
  cooldownRemaining,
  parseStoredEmail,
  randomSecret,
  emailLinkErrorMessage,
  normalizeLinkEmail,
} from "../src/emailLink";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as InviteError).code;
  }
  return null;
};
const NOW = Date.UTC(2026, 10, 13, 5, 0, 0);

describe("normalizeInviteEmail", () => {
  it("viết thường, cắt khoảng trắng, chỉ ASCII như rules", () => {
    expect(normalizeInviteEmail("  Nguoi.Gia+x@Example.TEST ")).toBe(
      "nguoi.gia+x@example.test",
    );
    for (const bad of [
      "",
      "abc",
      "a@b",
      "a b@c.d",
      "@x.y",
      "nguyễn@example.test",
      "a@@example.test",
      "a@exa_mple.test",
      `${"a".repeat(250)}@x.yz`,
    ])
      expect(code(() => normalizeInviteEmail(bad))).toBe("INVALID_EMAIL");
  });
});

describe("inviteKeyHash", () => {
  it("sha256 hex thường của khóa email (khớp rules .lower())", async () => {
    const expected = createHash("sha256")
      .update("a@example.test")
      .digest("hex");
    expect(await inviteKeyHash("a@example.test")).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildInvite", () => {
  it("đúng hình dạng inviteCreateOk, nhật ký không chứa email", async () => {
    const nonce = randomUUID();
    const b = await buildInvite({
      actorUid: "a1",
      email: "Moi@Example.test",
      displayName: "  Người Mời  ",
      nonce,
      nowMs: NOW,
    });
    expect(b.emailKey).toBe("moi@example.test");
    expect(Object.keys(b.invite).sort()).toEqual(
      [
        "createdAt",
        "createdBy",
        "displayName",
        "email",
        "expiresAt",
        "nonce",
        "role",
        "schemaVersion",
        "status",
      ].sort(),
    );
    expect(b.invite).toMatchObject({
      email: "moi@example.test",
      role: "VIEWER",
      displayName: "Người Mời",
      status: "PENDING",
      nonce,
      createdBy: "a1",
      createdAt: SERVER_TIME,
      schemaVersion: 1,
    });
    const exp = (b.invite.expiresAt as Timestamp).toMillis();
    expect(exp).toBe(NOW + INVITE_TTL_MS);
    // Rules: expiresAt <= request.time + 7 ngày; còn dư >= 2 giờ cho lệch đồng hồ.
    expect(exp).toBeLessThanOrEqual(NOW + 7 * 86400000 - 2 * 3600000);
    expect(exp).toBeGreaterThan(NOW);
    expect(b.auditId).toBe(`invite-${nonce}`);
    expect(b.audit).toEqual({
      event: "INVITE_CREATED",
      actorUid: "a1",
      nonce,
      inviteKey: await inviteKeyHash("moi@example.test"),
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    });
    expect(JSON.stringify(b.audit)).not.toContain("@");
  });
  it("bỏ displayName khi trống; từ chối tên sai và nonce sai", async () => {
    const base = {
      actorUid: "a1",
      email: "x@example.test",
      nonce: randomUUID(),
      nowMs: NOW,
    };
    expect(
      "displayName" in
        (await buildInvite({ ...base, displayName: "  " })).invite,
    ).toBe(false);
    await expect(
      buildInvite({ ...base, displayName: "a\u0000b" }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
    await expect(
      buildInvite({ ...base, displayName: "a".repeat(121) }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
    await expect(buildInvite({ ...base, nonce: "ngan" })).rejects.toMatchObject(
      { code: "BAD_INVITE" },
    );
  });
});

describe("buildRevoke", () => {
  it("chỉ đổi status/revokedBy/revokedAt; mã nhật ký mang uid người thu hồi", async () => {
    const nonce = randomUUID();
    const r = await buildRevoke({
      actorUid: "a2",
      invite: { email: "Moi@Example.test", nonce },
    });
    expect(r.patch).toEqual({
      status: "REVOKED",
      revokedBy: "a2",
      revokedAt: SERVER_TIME,
    });
    expect(r.auditId).toBe(`invite-${nonce}-revoked-a2`);
    expect(r.audit).toMatchObject({
      event: "INVITE_REVOKED",
      actorUid: "a2",
      nonce,
      inviteKey: await inviteKeyHash("moi@example.test"),
    });
  });
});

describe("buildAcceptance", () => {
  const nonce = randomUUID();
  const invite = {
    email: "moi@example.test",
    role: "VIEWER",
    displayName: "Người Mời",
    status: "PENDING",
    nonce,
    createdBy: "a1",
    expiresAt: Timestamp.fromMillis(NOW + 86400000),
  };
  const ok = (over = {}) =>
    buildAcceptance({
      uid: "u1",
      email: "Moi@Example.test",
      emailVerified: true,
      invite: { ...invite, ...over },
      nowMs: NOW,
    });
  it("users đúng acceptOk: khóa cố định, email viết thường, approvedBy = người mời", () => {
    const b = ok();
    expect(Object.keys(b.user).sort()).toEqual(
      [
        "accessVersion",
        "approvedAt",
        "approvedBy",
        "canManageMembership",
        "canReviewChanges",
        "displayName",
        "email",
        "enabled",
        "invitationNonce",
        "roleIds",
        "schemaVersion",
      ].sort(),
    );
    expect(b.user).toMatchObject({
      enabled: true,
      roleIds: ["member"],
      canManageMembership: false,
      canReviewChanges: false,
      accessVersion: 1,
      schemaVersion: 1,
      email: "moi@example.test",
      displayName: "Người Mời",
      approvedBy: "a1",
      approvedAt: SERVER_TIME,
      invitationNonce: nonce,
    });
    expect(b.invitePatch).toEqual({
      status: "ACCEPTED",
      acceptedBy: "u1",
      acceptedAt: SERVER_TIME,
    });
    expect(b.auditId).toBe("account-u1-1");
    expect(b.audit).toMatchObject({
      event: "INVITATION_ACCEPTED",
      actorUid: "u1",
      targetUid: "u1",
      accessVersion: 1,
      invitationNonce: nonce,
    });
  });
  it("lời mời không có tên thì users không có displayName", () => {
    const { displayName, ...rest } = invite;
    void displayName;
    const b = buildAcceptance({
      uid: "u1",
      email: "moi@example.test",
      emailVerified: true,
      invite: rest,
      nowMs: NOW,
    });
    expect("displayName" in b.user).toBe(false);
  });
  it("chặn: email chưa xác minh, không có lời mời, hết hạn/đã thu hồi/đã dùng, role lạ", () => {
    expect(
      code(() =>
        buildAcceptance({
          uid: "u1",
          email: "moi@example.test",
          emailVerified: false,
          invite,
          nowMs: NOW,
        }),
      ),
    ).toBe("UNVERIFIED");
    expect(
      code(() =>
        buildAcceptance({
          uid: "u1",
          email: "moi@example.test",
          emailVerified: true,
          invite: undefined,
          nowMs: NOW,
        }),
      ),
    ).toBe("NO_INVITE");
    expect(code(() => ok({ expiresAt: Timestamp.fromMillis(NOW - 1) }))).toBe(
      "INVITE_UNUSABLE",
    );
    expect(code(() => ok({ status: "REVOKED" }))).toBe("INVITE_UNUSABLE");
    expect(code(() => ok({ status: "ACCEPTED" }))).toBe("INVITE_UNUSABLE");
    expect(code(() => ok({ role: "ADMIN" }))).toBe("INVITE_UNUSABLE");
    expect(code(() => ok({ email: "khac@example.test" }))).toBe("BAD_INVITE");
  });
});

describe("inviteStatus / thông báo", () => {
  it("PENDING quá hạn thành EXPIRED", () => {
    const f = Timestamp.fromMillis(NOW + 1000);
    const p = Timestamp.fromMillis(NOW - 1000);
    expect(inviteStatus({ status: "PENDING", expiresAt: f }, NOW)).toBe(
      "PENDING",
    );
    expect(inviteStatus({ status: "PENDING", expiresAt: p }, NOW)).toBe(
      "EXPIRED",
    );
    expect(inviteStatus({ status: "REVOKED", expiresAt: f }, NOW)).toBe(
      "REVOKED",
    );
    expect(inviteStatus({ status: "ACCEPTED" }, NOW)).toBe("ACCEPTED");
    expect(inviteStatus(undefined, NOW)).toBeNull();
    expect(inviteStatus({ status: "?" }, NOW)).toBeNull();
  });
  it("ánh xạ lỗi tiếng Việt theo ngữ cảnh", () => {
    expect(inviteErrorMessage({ code: "permission-denied" }, "accept")).toMatch(
      /Không nhận được lời mời/,
    );
    expect(inviteErrorMessage({ code: "permission-denied" }, "create")).toMatch(
      /Không tạo được lời mời/,
    );
    expect(inviteErrorMessage({ code: "permission-denied" }, "revoke")).toMatch(
      /Không thu hồi được/,
    );
    expect(inviteErrorMessage({ code: "unavailable" })).toMatch(/mạng/);
    expect(inviteErrorMessage(new InviteError("ACTIVE_INVITE", "x"))).toBe("x");
    expect(inviteErrorMessage(new Error("?"))).toMatch(/Không hoàn tất/);
  });
});

describe("đăng nhập bằng liên kết email (hàm thuần)", () => {
  it("continue URL = origin + pathname, không có hash", () => {
    expect(
      actionCodeSettings({
        origin: "https://ex.github.io",
        pathname: "/gia-pha/",
      }),
    ).toEqual({
      url: "https://ex.github.io/gia-pha/",
      handleCodeInApp: true,
    });
  });
  it("làm sạch oobCode nhưng giữ hash router", () => {
    expect(
      cleanedUrl({
        origin: "http://127.0.0.1:5198",
        pathname: "/",
        hash: "#/users",
      }),
    ).toBe("http://127.0.0.1:5198/#/users");
    expect(cleanedUrl({ origin: "http://x", pathname: "/p/", hash: "" })).toBe(
      "http://x/p/",
    );
  });
  it("chuẩn hóa email và thông báo lỗi", () => {
    expect(normalizeLinkEmail(" A@B.Co ")).toBe("a@b.co");
    expect(() => normalizeLinkEmail("abc")).toThrow();
    expect(emailLinkErrorMessage({ code: "auth/invalid-action-code" })).toMatch(
      /không còn hiệu lực/,
    );
    expect(emailLinkErrorMessage({ code: "auth/invalid-email" })).toMatch(
      /không khớp/,
    );
    expect(emailLinkErrorMessage({ code: "auth/quota-exceeded" })).toMatch(
      /hạn mức/,
    );
    expect(
      emailLinkErrorMessage({ code: "auth/unauthorized-continue-uri" }),
    ).toMatch(/tên miền/);
    expect(emailLinkErrorMessage({})).toMatch(/Không gửi hoặc hoàn tất/);
  });
});

describe("bảo vệ đăng nhập bằng liên kết email", () => {
  it("randomSecret: >= 32 ký tự, ngẫu nhiên, không lặp", () => {
    const a = randomSecret();
    const b = randomSecret();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
    expect(new Set(a).size).toBeGreaterThan(10);
  });
  it("email tạm: chỉ hợp lệ trong 1 giờ, hỏng/lạ thì bỏ", () => {
    const now = 10_000_000;
    const raw = (at: number) => JSON.stringify({ email: "a@b.co", at });
    expect(parseStoredEmail(raw(now - 1000), now)).toBe("a@b.co");
    expect(parseStoredEmail(raw(now - STORED_EMAIL_TTL_MS - 1), now)).toBe("");
    expect(parseStoredEmail(raw(now + 5000), now)).toBe("");
    expect(parseStoredEmail("a@b.co", now)).toBe("");
    expect(parseStoredEmail(null, now)).toBe("");
    expect(parseStoredEmail('{"email":5,"at":1}', now)).toBe("");
  });
  it("thời gian chờ giữa các lần gửi", () => {
    expect(cooldownRemaining(undefined, 1000)).toBe(0);
    expect(cooldownRemaining(1000, 1000 + 59000)).toBe(1000);
    expect(cooldownRemaining(1000, 1000 + 60000)).toBe(0);
  });
});

describe("đồng hồ thiết bị lệch", () => {
  it("đồng hồ nhanh hơn 8 ngày: lời mời hợp lệ bị coi là hết hạn kèm gợi ý kiểm tra đồng hồ", () => {
    const invite = {
      email: "moi@example.test",
      role: "VIEWER",
      status: "PENDING",
      nonce: randomUUID(),
      createdBy: "a1",
      expiresAt: Timestamp.fromMillis(NOW + 86400000),
    };
    let err: InviteError | null = null;
    try {
      buildAcceptance({
        uid: "u",
        email: "moi@example.test",
        emailVerified: true,
        invite,
        nowMs: NOW + 8 * 86400000,
      });
    } catch (e) {
      err = e as InviteError;
    }
    expect(err?.code).toBe("INVITE_UNUSABLE");
    expect(err?.message).toMatch(/đồng hồ/);
  });
});
