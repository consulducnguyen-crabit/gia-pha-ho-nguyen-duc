import { describe, expect, it } from "vitest";
import {
  ACTOR,
  buildGrant,
  buildRevoke,
  buildRole,
  buildRegistry,
  diffRegistry,
  ledgerAfter,
  normalizeUser,
  planAdminWrite,
  planRebuild,
  grantRestoresAdmin,
  badUserReason,
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
      canManageMembership: false, // bool tường minh (rules đòi bool khi quản trị sửa)
    });
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

describe("bất biến users cho rules", () => {
  it("buildRevoke đặt canManageMembership=false (canManage kéo theo enabled)", () => {
    const admin = {
      enabled: true,
      canManageMembership: true,
      accessVersion: 2,
    };
    const r = buildRevoke(admin, now);
    expect(r.enabled).toBe(false);
    expect(r.canManageMembership).toBe(false);
    expect(buildRevoke(undefined, now).canManageMembership).toBe(false);
  });
  it("buildGrant/buildRole luôn ghi bool tường minh, giữ giá trị cũ khi không đổi", () => {
    expect(
      buildGrant({ canManageMembership: true }, { email: "a@x.test" }, now)
        .canManageMembership,
    ).toBe(true);
    expect(buildGrant({}, { email: "a@x.test" }, now).canManageMembership).toBe(
      false,
    );
    expect(
      buildGrant({ canManageMembership: "x" }, { email: "a@x.test" }, now)
        .canManageMembership,
    ).toBe(false);
    expect(
      buildGrant({}, { email: "a@x.test", admin: true }, now)
        .canManageMembership,
    ).toBe(true);
    const base = { enabled: true, accessVersion: 1 };
    expect(buildRole(base, { reviewer: true }).canManageMembership).toBe(false);
    expect(
      buildRole({ ...base, canManageMembership: true }, { reviewer: true })
        .canManageMembership,
    ).toBe(true);
    expect(
      buildRole({ ...base, canManageMembership: true }, { admin: false })
        .canManageMembership,
    ).toBe(false);
  });
});

describe("sổ quản trị viên", () => {
  const ledger = {
    adminUids: ["b", "a"],
    version: 4,
    lastTargetUid: "x",
    schemaVersion: 1 as const,
  };
  const adm = { enabled: true, canManageMembership: true };
  const mem = { enabled: true, canManageMembership: false };
  it("ledgerAfter: nâng, hạ, không đổi", () => {
    expect(ledgerAfter(ledger, "c", mem, adm)).toEqual({
      adminUids: ["a", "b", "c"],
      version: 5,
      lastTargetUid: "c",
      schemaVersion: 1,
    });
    expect(
      ledgerAfter(ledger, "a", adm, {
        ...adm,
        enabled: false,
        canManageMembership: false,
      }),
    ).toEqual({
      adminUids: ["b"],
      version: 5,
      lastTargetUid: "a",
      schemaVersion: 1,
    });
    expect(
      ledgerAfter(ledger, "c", mem, { ...mem, displayName: "x" }),
    ).toBeNull();
    expect(ledgerAfter(ledger, "a", adm, adm)).toBeNull();
    // khử trùng
    expect(
      ledgerAfter({ ...ledger, adminUids: ["a", "a"] }, "c", undefined, adm)
        ?.adminUids,
    ).toEqual(["a", "c"]);
  });
  it("ledgerAfter ném lỗi khi sổ rỗng hoặc quá 20", () => {
    const one = { ...ledger, adminUids: ["a"] };
    expect(() => ledgerAfter(one, "a", adm, mem)).toThrow();
    const full = {
      ...ledger,
      adminUids: Array.from(
        { length: 20 },
        (_, i) => `u${String(i).padStart(2, "0")}`,
      ),
    };
    expect(() => ledgerAfter(full, "z", mem, adm)).toThrow();
    expect(() =>
      ledgerAfter({ ...ledger, version: -1 }, "c", mem, adm),
    ).toThrow();
  });
  const users = new Map<string, Record<string, unknown>>([
    ["a", adm],
    ["b", adm],
    ["c", mem],
    ["d", { enabled: false, canManageMembership: true }],
    ["e", { enabled: true }],
    ["f", { enabled: false, canManageMembership: false }],
  ]);
  it("buildRegistry theo bất biến, sắp xếp; rỗng thì ném lỗi", () => {
    expect(buildRegistry(users)).toEqual(["a", "b"]);
    expect(() => buildRegistry(new Map([["c", mem]]))).toThrow();
  });
  it("diffRegistry: thiếu, thừa, users lệch", () => {
    const d = diffRegistry({ ...ledger, adminUids: ["a", "d"] }, users);
    expect(d.missingFromLedger).toEqual(["b"]);
    expect(d.extraInLedger).toEqual(["d"]);
    expect(d.badUsers.map((b) => b.uid)).toEqual(["d", "e"]);
    expect(d.clean).toBe(false);
    expect(diffRegistry(undefined, users).clean).toBe(false);
    const ok = new Map([
      ["a", adm],
      ["c", mem],
    ]);
    expect(diffRegistry({ ...ledger, adminUids: ["a"] }, ok).clean).toBe(true);
  });
  it("normalizeUser: sửa bool thiếu và enabled=false+canManage=true, tăng accessVersion", () => {
    expect(normalizeUser({ enabled: true, accessVersion: 2 })).toEqual({
      canManageMembership: false,
      accessVersion: 3,
    });
    expect(
      normalizeUser({ enabled: false, canManageMembership: true }),
    ).toEqual({ canManageMembership: false, accessVersion: 1 });
    expect(normalizeUser(adm)).toBeNull();
    expect(normalizeUser(mem)).toBeNull();
  });
});

describe("planAdminWrite / planRebuild (từ chối khi sổ thiếu hoặc lệch)", () => {
  const adm = { enabled: true, canManageMembership: true, accessVersion: 1 };
  const mem = { enabled: true, canManageMembership: false, accessVersion: 1 };
  const L = (adminUids: string[], version = 3) => ({
    adminUids,
    version,
    lastTargetUid: "x",
    schemaVersion: 1 as const,
  });
  const revoked = {
    enabled: false,
    canManageMembership: false,
    accessVersion: 2,
  };

  it("sổ khớp: revoke admin (còn người khác) ghi sổ mới", () => {
    const users = new Map([
      ["a", adm],
      ["b", adm],
    ]);
    const p = planAdminWrite(L(["a", "b"]), users, "b", revoked);
    expect(p.error).toBeUndefined();
    expect(p.ledgerWrite?.adminUids).toEqual(["a"]);
  });
  it("#1 sổ lệch + revoke/đổi admin bị từ chối; lệnh không đổi admin vẫn ghi kèm cảnh báo", () => {
    const users = new Map([
      ["a", adm],
      ["b", adm],
      ["c", mem],
    ]);
    const drifted = L(["a"]); // b là admin trong users nhưng thiếu trong sổ
    expect(planAdminWrite(drifted, users, "b", revoked).error).toMatch(/lệch/);
    expect(
      planAdminWrite(drifted, users, "c", { ...mem, canManageMembership: true })
        .error,
    ).toMatch(/lệch/);
    const ok = planAdminWrite(drifted, users, "c", {
      ...mem,
      displayName: "x",
    });
    expect(ok.error).toBeUndefined();
    expect(ok.ledgerWrite).toBeNull();
    expect(ok.warnings.join(" ")).toMatch(/lệch/);
  });
  it("#1 giao rỗng sau ghi bị từ chối: sổ chỉ còn uid không phải admin trong users", () => {
    // users: a (admin) trong sổ; sổ chứa thêm ghost không phải admin => lệch, cũng bị từ chối
    const users = new Map([
      ["a", adm],
      ["ghost", mem],
    ]);
    expect(
      planAdminWrite(L(["a", "ghost"]), users, "a", revoked).error,
    ).toBeTruthy();
    // Sổ khớp, hạ người cuối: không còn admin
    expect(
      planAdminWrite(L(["a"]), new Map([["a", adm]]), "a", revoked).error,
    ).toBeTruthy();
  });
  it("#1 chưa có sổ: từ chối đổi admin (hướng dẫn rebuild); không đổi admin thì ghi kèm cảnh báo", () => {
    const users = new Map([
      ["a", adm],
      ["c", mem],
    ]);
    const e = planAdminWrite(undefined, users, "c", {
      ...mem,
      canManageMembership: true,
    });
    expect(e.error).toMatch(/registry --rebuild --apply/);
    const w = planAdminWrite(undefined, users, "c", {
      ...mem,
      displayName: "x",
    });
    expect(w.error).toBeUndefined();
    expect(w.ledgerWrite).toBeNull();
    expect(w.warnings.length).toBe(1);
  });
  it("chưa có sổ và chưa có admin nào: chỉ quản trị viên đầu tiên được khởi tạo sổ", () => {
    const users = new Map([["c", mem]]);
    const first = planAdminWrite(undefined, users, "c", {
      ...mem,
      canManageMembership: true,
    });
    expect(first.ledgerWrite).toEqual({
      adminUids: ["c"],
      version: 1,
      lastTargetUid: "c",
      schemaVersion: 1,
    });
    expect(
      planAdminWrite(undefined, new Map(), "z", mem).error,
    ).toBeUndefined();
    expect(
      planAdminWrite(undefined, users, "c", { ...mem, enabled: false }).error,
    ).toBeUndefined();
  });
  it("bootstrap với admin thu hồi kiểu cũ: khôi phục admin cũ khi chưa có admin hiệu lực khởi tạo sổ", () => {
    const legacy = {
      enabled: false,
      canManageMembership: true,
      accessVersion: 2,
    };
    const users = new Map<string, Record<string, unknown>>([
      ["c", legacy],
      ["m", mem],
    ]);
    const restored = { ...legacy, enabled: true };
    const p = planAdminWrite(undefined, users, "c", restored);
    expect(p.ledgerWrite).toEqual({
      adminUids: ["c"],
      version: 1,
      lastTargetUid: "c",
      schemaVersion: 1,
    });
    // role --admin on cho người thường khi chưa có admin hiệu lực cũng khởi tạo được
    expect(
      planAdminWrite(undefined, users, "m", {
        ...mem,
        canManageMembership: true,
      }).ledgerWrite?.adminUids,
    ).toEqual(["m"]);
    // đã có admin hiệu lực mà chưa có sổ thì bị từ chối
    const withAdmin = new Map<string, Record<string, unknown>>([
      ["a", adm],
      ["c", legacy],
    ]);
    expect(
      planAdminWrite(undefined, withAdmin, "c", restored).error,
    ).toBeTruthy();
  });
  it("#4 thông báo sổ lệch nêu uid trùng / sổ hỏng cụ thể", () => {
    const users = new Map<string, Record<string, unknown>>([
      ["a", adm],
      ["c", mem],
    ]);
    const promote = { ...mem, canManageMembership: true };
    expect(planAdminWrite(L(["a", "a"]), users, "c", promote).error).toMatch(
      /uid trùng trong sổ/,
    );
    expect(
      planAdminWrite(
        { ...L(["a"]), adminUids: "a" as unknown as string[] },
        users,
        "c",
        promote,
      ).error,
    ).toMatch(/hỏng/);
    expect(planAdminWrite(L(["a", "z"]), users, "c", promote).error).toMatch(
      /thừa trong sổ: z/,
    );
  });
  it("sổ đã đủ 20 admin: nâng thêm bị từ chối với thông báo riêng", () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => `u${String(i).padStart(2, "0")}`,
    );
    const users = new Map<string, Record<string, unknown>>(
      ids.map((i) => [i, adm]),
    );
    users.set("z", mem);
    expect(
      planAdminWrite(L(ids), users, "z", { ...mem, canManageMembership: true })
        .error,
    ).toMatch(/tối đa 20/);
  });
  it("planRebuild: version sổ hỏng, adminUids hỏng, 0 admin, >20 admin, chuẩn hóa lỗi có uid", () => {
    const users = new Map([["a", adm]]);
    expect(planRebuild({ ...L(["a"]), version: -1 }, users).error).toMatch(
      /hỏng/,
    );
    expect(planRebuild({ ...L(["a"]), version: 1.5 }, users).error).toMatch(
      /hỏng/,
    );
    expect(
      planRebuild({ ...L(["a"]), adminUids: [1] as unknown as string[] }, users)
        .error,
    ).toMatch(/hỏng/);
    expect(planRebuild(undefined, new Map([["c", mem]])).error).toMatch(
      /chưa có quản trị viên/,
    );
    const many = new Map<string, Record<string, unknown>>(
      Array.from({ length: 21 }, (_, i) => [`u${i}`, adm]),
    );
    expect(planRebuild(undefined, many).error).toMatch(/20/);
    expect(
      planRebuild(
        undefined,
        new Map<string, Record<string, unknown>>([
          ["a", adm],
          ["bad", { enabled: true, accessVersion: -3 }],
        ]),
      ).error,
    ).toMatch(/users\/bad/);
    const ok = planRebuild(
      L(["a"], 7),
      new Map<string, Record<string, unknown>>([
        ["a", adm],
        ["m", { enabled: true }],
      ]),
    );
    expect(ok.next).toEqual({
      adminUids: ["a"],
      version: 8,
      lastTargetUid: "registry-rebuild",
      schemaVersion: 1,
    });
    expect(ok.fixes.map(([u]) => u)).toEqual(["m"]);
  });
  it("diffRegistry: uid trùng trong sổ => clean=false; adminUids hỏng => clean=false", () => {
    const users = new Map([["a", adm]]);
    expect(diffRegistry(L(["a", "a"]), users).clean).toBe(false);
    expect(diffRegistry(L(["a"]), users).clean).toBe(true);
    expect(
      diffRegistry(
        { ...L(["a"]), adminUids: "a" as unknown as string[] },
        users,
      ).clean,
    ).toBe(false);
  });
  it("ledgerAfter: adminUids hỏng hoặc version không hợp lệ ném lỗi", () => {
    expect(() =>
      ledgerAfter(
        { ...L(["a"]), adminUids: [1, 2] as unknown as string[] },
        "c",
        mem,
        adm,
      ),
    ).toThrow();
    expect(() =>
      ledgerAfter(
        { ...L(["a"]), adminUids: undefined as unknown as string[] },
        "c",
        mem,
        adm,
      ),
    ).toThrow();
    expect(() =>
      ledgerAfter({ ...L(["a"]), version: Number.NaN }, "c", mem, adm),
    ).toThrow();
  });
  it("#8 badUserReason bắt enabled không phải bool và accessVersion hỏng", () => {
    expect(
      badUserReason({ enabled: "yes", canManageMembership: false }),
    ).toMatch(/enabled/);
    expect(
      badUserReason({
        enabled: true,
        canManageMembership: false,
        accessVersion: -1,
      }),
    ).toMatch(/accessVersion/);
    expect(
      badUserReason({
        enabled: true,
        canManageMembership: false,
        accessVersion: 2,
      }),
    ).toBeNull();
    expect(
      normalizeUser({ enabled: "yes", canManageMembership: false }),
    ).toEqual({ canManageMembership: false, enabled: false, accessVersion: 1 });
  });
  it("#7 grantRestoresAdmin cảnh báo khi cấp lại tài khoản thu hồi còn canManage=true", () => {
    const legacy = { enabled: false, canManageMembership: true };
    expect(grantRestoresAdmin(legacy, undefined)).toBe(true);
    expect(grantRestoresAdmin(legacy, true)).toBe(false);
    expect(
      grantRestoresAdmin(
        { enabled: false, canManageMembership: false },
        undefined,
      ),
    ).toBe(false);
    expect(grantRestoresAdmin(undefined, undefined)).toBe(false);
  });
});
