// Kiểm tra rules cấp quyền trong app (sổ quản trị viên, lời mời, nhận lời mời) trên emulator Firestore.
// Dữ liệu hoàn toàn giả; không chạm Firebase thật.
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  arrayUnion,
  increment,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
  type WriteBatch,
  type Firestore,
} from "firebase/firestore";

let env: RulesTestEnvironment;
const DAY = 86400000;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha-accounts",
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

const baseUser = (extra: object = {}) => ({
  enabled: true,
  roleIds: ["member"],
  canManageMembership: false,
  canReviewChanges: false,
  accessVersion: 1,
  schemaVersion: 1,
  displayName: "Tên giả",
  ...extra,
});
const ledger = (adminUids: string[], version = 1) => ({
  adminUids,
  version,
  lastTargetUid: "",
  schemaVersion: 1,
});
const futureTs = (days: number) =>
  Timestamp.fromMillis(Date.now() + days * DAY);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const uid of ["a1", "a2"])
      await setDoc(
        doc(db, "users", uid),
        baseUser({ canManageMembership: true }),
      );
    for (const uid of ["m1", "m2"])
      await setDoc(doc(db, "users", uid), baseUser());
    await setDoc(doc(db, "users", "off"), baseUser({ enabled: false }));
    await setDoc(doc(db, "accessControl", "admins"), ledger(["a1", "a2"]));
    // Lời mời mẫu (PENDING, do a1 phát hành) cho email chưa có tài khoản.
    await setDoc(doc(db, "accountInvites", "new1@example.test"), {
      email: "new1@example.test",
      role: "VIEWER",
      displayName: "Người được mời giả",
      status: "PENDING",
      nonce: NONCE1,
      createdBy: "a1",
      createdAt: Timestamp.now(),
      expiresAt: futureTs(3),
      schemaVersion: 1,
    });
  });
});

const NONCE1 = "11111111-1111-4111-8111-111111111111";
type Over = Record<string, unknown>;

// ---- Cập nhật tài khoản bởi quản trị viên -----------------------------------------------------
type Kind = "promote" | "demote" | "disable" | "enable" | "rename";
interface Plan {
  patch: Over;
  fields: string[];
  before: Over;
  after: Over;
  ledger: Over | null;
}
function plan(kind: Kind, target: string): Plan {
  const off = { enabled: true, admin: false };
  switch (kind) {
    case "promote":
      return {
        patch: { canManageMembership: true },
        fields: ["admin"],
        before: off,
        after: { enabled: true, admin: true },
        ledger: {
          adminUids: ["a1", "a2", target],
          version: 2,
          lastTargetUid: target,
        },
      };
    case "demote":
      return {
        patch: { canManageMembership: false },
        fields: ["admin"],
        before: { enabled: true, admin: true },
        after: off,
        ledger: { adminUids: ["a1"], version: 2, lastTargetUid: target },
      };
    case "disable":
      return {
        patch: { enabled: false },
        fields: ["enabled"],
        before: off,
        after: { enabled: false, admin: false },
        ledger: null,
      };
    case "enable":
      return {
        patch: { enabled: true },
        fields: ["enabled"],
        before: { enabled: false, admin: false },
        after: off,
        ledger: null,
      };
    case "rename":
      return {
        patch: { displayName: "Tên mới giả" },
        fields: ["displayName"],
        before: off,
        after: off,
        ledger: null,
      };
  }
}
interface Opts {
  patch?: Over;
  ledger?: Over | null;
  audit?: Over | null;
  av?: number;
  auditId?: string;
  updatedBy?: string;
  updatedAt?: unknown;
  noUserWrite?: boolean;
  into?: WriteBatch;
}
function updateBatch(
  db: Firestore,
  me: string,
  target: string,
  kind: Kind,
  o: Opts = {},
) {
  const p = plan(kind, target);
  const av = o.av ?? 2;
  const batch = o.into ?? writeBatch(db);
  if (!o.noUserWrite)
    batch.update(doc(db, "users", target), {
      ...p.patch,
      ...o.patch,
      accessVersion: av,
      updatedBy: o.updatedBy ?? me,
      updatedAt: o.updatedAt ?? serverTimestamp(),
    });
  const l = o.ledger === undefined ? p.ledger : o.ledger;
  if (l) batch.update(doc(db, "accessControl", "admins"), l);
  if (o.audit !== null)
    batch.set(doc(db, "auditLogs", o.auditId ?? `account-${target}-${av}`), {
      event: "ACCOUNT_UPDATED",
      actorUid: me,
      targetUid: target,
      accessVersion: av,
      fields: p.fields,
      before: p.before,
      after: p.after,
      timestamp: serverTimestamp(),
      schemaVersion: 1,
      ...o.audit,
    });
  return batch;
}
const as = (uid: string) =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;
const run = (me: string, target: string, kind: Kind, o?: Opts) =>
  updateBatch(as(me), me, target, kind, o).commit();

describe("quản trị viên cập nhật tài khoản — ca dương", () => {
  it("nâng một thành viên lên quản trị viên (sổ + users + nhật ký cùng lô)", async () => {
    await assertSucceeds(run("a1", "m1", "promote"));
  });
  it("hạ một quản trị viên khi vẫn còn ít nhất một người", async () => {
    await assertSucceeds(run("a1", "a2", "demote"));
  });
  it("người bị hạ mất quyền liệt kê users ở yêu cầu kế tiếp", async () => {
    const db = as("a2");
    await assertSucceeds(getDocs(collection(db, "users")));
    await assertSucceeds(run("a1", "a2", "demote"));
    await assertFails(getDocs(collection(db, "users")));
    await assertFails(getDoc(doc(db, "accessControl", "admins")));
  });
  it("tắt rồi bật lại một thành viên", async () => {
    await assertSucceeds(run("a1", "m1", "disable"));
    await assertSucceeds(run("a1", "m1", "enable", { av: 3 }));
  });
  it("bật lại tài khoản đã tắt", async () => {
    await assertSucceeds(run("a1", "off", "enable"));
  });
  it("đổi tên hiển thị", async () => {
    await assertSucceeds(run("a1", "m1", "rename"));
  });
  it("tắt một quản trị viên khác (đổi trạng thái admin nên ghi cả sổ)", async () => {
    await assertSucceeds(
      run("a1", "a2", "disable", {
        patch: { enabled: false, canManageMembership: false },
        audit: {
          fields: ["enabled", "admin"],
          before: { enabled: true, admin: true },
          after: { enabled: false, admin: false },
        },
        ledger: { adminUids: ["a1"], version: 2, lastTargetUid: "a2" },
      }),
    );
  });
  it("quản trị viên được đọc sổ", async () => {
    await assertSucceeds(getDoc(doc(as("a1"), "accessControl", "admins")));
  });
});

describe("quản trị viên cập nhật tài khoản — leo thang đặc quyền", () => {
  for (const uid of ["m1", "off"])
    it(`${uid} (thành viên thường/đã tắt) không ghi được users của người khác`, async () => {
      await assertFails(run(uid, "m2", "rename"));
      await assertFails(run(uid, "m2", "promote"));
    });
  for (const [name, patch] of [
    ["roleIds", { roleIds: ["admin"] }],
    ["canReviewChanges", { canReviewChanges: true }],
    ["email", { email: "khac@example.test" }],
    ["schemaVersion", { schemaVersion: 2 }],
    ["trường lạ", { isOwner: true }],
  ] as const)
    it(`không được chạm ${name}`, async () => {
      await assertFails(run("a1", "m1", "rename", { patch }));
    });
  it("accessVersion tăng 2 hoặc giữ nguyên đều bị chặn", async () => {
    await assertFails(run("a1", "m1", "rename", { av: 3 }));
    await assertFails(run("a1", "m1", "rename", { av: 1 }));
  });
  it("updatedBy giả hoặc actorUid giả bị chặn", async () => {
    await assertFails(run("a1", "m1", "rename", { updatedBy: "a2" }));
    await assertFails(run("a1", "m1", "rename", { audit: { actorUid: "a2" } }));
  });
  it("updatedAt không bằng thời điểm máy chủ bị chặn", async () => {
    await assertFails(
      run("a1", "m1", "rename", { updatedAt: Timestamp.fromMillis(1000) }),
    );
  });
  it("thiếu nhật ký hoặc nhật ký sai mã bị chặn", async () => {
    await assertFails(run("a1", "m1", "rename", { audit: null }));
    await assertFails(run("a1", "m1", "rename", { auditId: "account-m1-9" }));
    await assertFails(run("a1", "m1", "rename", { auditId: "account-m2-2" }));
  });
  it("nhật ký ghi sai trạng thái (before/after/fields) bị chặn", async () => {
    await assertFails(
      run("a1", "m1", "disable", {
        audit: { after: { enabled: true, admin: false } },
      }),
    );
    await assertFails(run("a1", "m1", "rename", { audit: { fields: [] } }));
    await assertFails(
      run("a1", "m1", "rename", { audit: { fields: ["email"] } }),
    );
  });
  it("nhật ký không được chứa tên hoặc email", async () => {
    await assertFails(
      run("a1", "m1", "rename", {
        audit: { before: { enabled: true, admin: false, displayName: "Tên" } },
      }),
    );
    await assertFails(
      run("a1", "m1", "rename", { audit: { email: "x@example.test" } }),
    );
  });
  it("tên không hợp lệ (rỗng, quá 120, ký tự điều khiển) bị chặn", async () => {
    for (const displayName of [
      "",
      "a".repeat(121),
      "Tên\u0000giả",
      "Dòng\nmới",
    ])
      await assertFails(run("a1", "m1", "rename", { patch: { displayName } }));
  });
  it("nâng quyền không ghi sổ, hoặc ghi sổ mà không đổi users, bị chặn", async () => {
    await assertFails(run("a1", "m1", "promote", { ledger: null }));
    await assertFails(
      run("a1", "m1", "promote", { noUserWrite: true, audit: null }),
    );
  });
  it("sổ sai: thêm uid lạ, thêm hai uid, lastTargetUid sai, version sai", async () => {
    const L = (adminUids: string[], v = 2, last = "m1") => ({
      adminUids,
      version: v,
      lastTargetUid: last,
    });
    await assertFails(
      run("a1", "m1", "promote", { ledger: L(["a1", "a2", "x"]) }),
    );
    await assertFails(
      run("a1", "m1", "promote", { ledger: L(["a1", "a2", "m1", "m2"]) }),
    );
    await assertFails(
      run("a1", "m1", "promote", { ledger: L(["a1", "a2", "m1"], 2, "m2") }),
    );
    await assertFails(
      run("a1", "m1", "promote", { ledger: L(["a1", "a2", "m1"], 3) }),
    );
    await assertFails(
      run("a1", "m1", "promote", { ledger: L(["a1", "a2", "m1"], 1) }),
    );
    await assertFails(run("a1", "m1", "promote", { ledger: L(["a1", "m1"]) }));
  });
  it("sổ đổi khi users không đổi trạng thái admin bị chặn", async () => {
    await assertFails(
      run("a1", "m1", "rename", {
        ledger: {
          adminUids: ["a1", "a2", "m1"],
          version: 2,
          lastTargetUid: "m1",
        },
      }),
    );
  });
  it("sổ không có trường lạ và không xóa được", async () => {
    await assertFails(
      run("a1", "m1", "promote", {
        ledger: {
          adminUids: ["a1", "a2", "m1"],
          version: 2,
          lastTargetUid: "m1",
          note: "x",
        },
      }),
    );
    await assertFails(deleteDoc(doc(as("a1"), "accessControl", "admins")));
    await assertFails(
      setDoc(doc(as("a1"), "accessControl", "other"), ledger(["a1"])),
    );
  });
  it("sổ không được tạo từ client", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await deleteDoc(doc(c.firestore(), "accessControl", "admins"));
    });
    await assertFails(
      setDoc(doc(as("a1"), "accessControl", "admins"), ledger(["a1", "m1"])),
    );
    // Không có sổ thì không ai là quản trị viên (đóng khi lỗi).
    await assertFails(run("a1", "m1", "rename"));
  });
  it("quản trị viên đã tắt vẫn cố thao tác bị chặn", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "users", "a3"),
        baseUser({ enabled: false, canManageMembership: true }),
      );
      await setDoc(
        doc(c.firestore(), "accessControl", "admins"),
        ledger(["a1", "a2", "a3"]),
      );
    });
    await assertFails(run("a3", "m1", "rename"));
  });
  it("admin có trong users nhưng thiếu trong sổ không có quyền", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "users", "ghost"),
        baseUser({ canManageMembership: true }),
      );
    });
    await assertFails(run("ghost", "m1", "rename"));
    await assertFails(getDocs(collection(as("ghost"), "accountInvites")));
  });
  it("quản trị viên không tạo hoặc xóa được users từ client", async () => {
    const db = as("a1");
    await assertFails(deleteDoc(doc(db, "users", "m1")));
    await assertFails(setDoc(doc(db, "users", "brand-new"), baseUser()));
  });
  it("canManageMembership=true kèm enabled=false bị chặn", async () => {
    await assertFails(
      run("a1", "m1", "disable", {
        patch: { enabled: false, canManageMembership: true },
      }),
    );
  });
});

describe("tự thao tác và admin cuối", () => {
  it("không tự hạ quyền, tự tắt, tự đổi tên", async () => {
    await assertFails(
      run("a1", "a1", "demote", {
        ledger: { adminUids: ["a2"], version: 2, lastTargetUid: "a1" },
      }),
    );
    await assertFails(run("a1", "a1", "disable"));
    await assertFails(run("a1", "a1", "rename"));
    await assertFails(updateOwnLedger("a1"));
  });
  it("người vừa bị hạ không hạ được người còn lại (admin cuối được giữ)", async () => {
    await assertSucceeds(run("a1", "a2", "demote"));
    await assertFails(
      run("a2", "a1", "demote", {
        ledger: { adminUids: [], version: 3, lastTargetUid: "a1" },
        av: 2,
      }),
    );
  });
  it("sổ rỗng bị chặn (lý do: người thao tác phải còn trong sổ sau khi hạ)", async () => {
    // "sau >= 1" là phòng thủ chồng lớp: người thao tác thuộc sổ cũ và khác mục tiêu nên luôn còn lại.
    // Biến thể hợp lệ duy nhất (hạ a2, sổ còn [a1]) phải thành công; chỉ sổ rỗng thì thất bại
    // vì adminUids != before.removeAll([target]).
    await assertFails(
      run("a1", "a2", "demote", {
        ledger: { adminUids: [], version: 2, lastTargetUid: "a2" },
      }),
    );
    await assertSucceeds(run("a1", "a2", "demote"));
  });
});
function updateOwnLedger(me: string) {
  const db = as(me);
  const b = writeBatch(db);
  b.update(doc(db, "accessControl", "admins"), {
    adminUids: ["a2"],
    version: 2,
    lastTargetUid: me,
  });
  return b.commit();
}

describe("mô phỏng đua ghi (lô dựng từ sổ cũ)", () => {
  it("lô dựng từ sổ cũ đến sau khi lô khác đã commit thì thất bại", async () => {
    const stale = updateBatch(as("a1"), "a1", "m2", "promote");
    await assertSucceeds(run("a1", "m1", "promote"));
    await assertFails(stale.commit());
  });
  it("hai lô nâng hai người khác nhau từ cùng sổ cũ: chỉ một lô thành công", async () => {
    const x = updateBatch(as("a1"), "a1", "m1", "promote");
    const y = updateBatch(as("a2"), "a2", "m2", "promote");
    await assertSucceeds(x.commit());
    await assertFails(y.commit());
  });
  it("lô hạ dựng từ sổ cũ thất bại sau khi sổ đã đổi", async () => {
    const stale = updateBatch(as("a1"), "a1", "a2", "demote");
    await assertSucceeds(run("a1", "m1", "promote"));
    await assertFails(stale.commit());
  });
  it("lô nâng cùng một người hai lần: lần hai thất bại", async () => {
    const again = updateBatch(as("a1"), "a1", "m1", "promote");
    await assertSucceeds(run("a1", "m1", "promote"));
    await assertFails(again.commit());
  });
});

// ---- Lời mời ------------------------------------------------------------------------------------
function inviteData(email: string, over: Over = {}) {
  return {
    email,
    role: "VIEWER",
    displayName: "Người mời giả",
    status: "PENDING",
    nonce: randomUUID(),
    createdBy: "a1",
    createdAt: serverTimestamp(),
    expiresAt: futureTs(3),
    schemaVersion: 1,
    ...over,
  };
}
// Khóa lời mời trong nhật ký là sha256 của email (không lưu email).
const sha = (k: string) => createHash("sha256").update(k).digest("hex");
function createInvite(
  me: string,
  key: string,
  over: Over = {},
  audit: Over | null = {},
) {
  const db = as(me);
  const d = inviteData(key, { createdBy: me, ...over });
  const b = writeBatch(db);
  b.set(doc(db, "accountInvites", key), d);
  if (audit !== null)
    b.set(doc(db, "auditLogs", `invite-${String(d.nonce)}`), {
      event: "INVITE_CREATED",
      actorUid: me,
      nonce: d.nonce,
      inviteKey: sha(key),
      timestamp: serverTimestamp(),
      schemaVersion: 1,
      ...audit,
    });
  return b.commit();
}
function revokeInvite(
  me: string,
  key: string,
  nonce: string,
  over: Over = {},
  audit: Over | null = {},
) {
  const db = as(me);
  const b = writeBatch(db);
  b.update(doc(db, "accountInvites", key), {
    status: "REVOKED",
    revokedBy: me,
    revokedAt: serverTimestamp(),
    ...over,
  });
  if (audit !== null)
    b.set(doc(db, "auditLogs", `invite-${nonce}-revoked-${me}`), {
      event: "INVITE_REVOKED",
      actorUid: me,
      nonce,
      inviteKey: sha(key),
      timestamp: serverTimestamp(),
      schemaVersion: 1,
      ...audit,
    });
  return b.commit();
}

describe("lời mời — tạo, thu hồi, ghi đè", () => {
  it("quản trị viên tạo lời mời Chỉ xem cùng nhật ký", async () => {
    await assertSucceeds(createInvite("a1", "moi@example.test"));
  });
  it("quản trị viên thu hồi lời mời PENDING", async () => {
    await assertSucceeds(revokeInvite("a1", "new1@example.test", NONCE1));
  });
  it("ghi đè lời mời đã hết hạn, đã thu hồi hoặc đã dùng", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      const base = (status: string, expiresAt: Timestamp) => ({
        email: "x@example.test",
        role: "VIEWER",
        status,
        nonce: randomUUID(),
        createdBy: "a1",
        createdAt: Timestamp.now(),
        expiresAt,
        schemaVersion: 1,
      });
      await setDoc(doc(db, "accountInvites", "het@example.test"), {
        ...base("PENDING", Timestamp.fromMillis(Date.now() - 1000)),
        email: "het@example.test",
      });
      await setDoc(doc(db, "accountInvites", "thu@example.test"), {
        ...base("REVOKED", futureTs(1)),
        email: "thu@example.test",
        revokedBy: "a1",
        revokedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "accountInvites", "dung@example.test"), {
        ...base("ACCEPTED", futureTs(1)),
        email: "dung@example.test",
        acceptedBy: "m1",
        acceptedAt: Timestamp.now(),
      });
    });
    for (const k of ["het", "thu", "dung"])
      await assertSucceeds(createInvite("a1", `${k}@example.test`));
  });
  it("không ghi đè lời mời còn hiệu lực (PENDING chưa hết hạn)", async () => {
    await assertFails(createInvite("a1", "new1@example.test"));
  });
  it("lời mời bị từ chối: role ADMIN, hạn quá 7 ngày hoặc ở quá khứ, trường lạ", async () => {
    const k = "x1@example.test";
    await assertFails(createInvite("a1", k, { role: "ADMIN" }));
    await assertFails(createInvite("a1", k, { role: "EDITOR" }));
    await assertFails(createInvite("a1", k, { expiresAt: futureTs(8) }));
    await assertFails(
      createInvite("a1", k, {
        expiresAt: Timestamp.fromMillis(Date.now() - DAY),
      }),
    );
    await assertFails(createInvite("a1", k, { expiresAt: "2099-01-01" }));
    await assertFails(createInvite("a1", k, { canManageMembership: true }));
    await assertFails(createInvite("a1", k, { status: "ACCEPTED" }));
    await assertFails(createInvite("a1", k, { createdBy: "a2" }));
    await assertFails(
      createInvite("a1", k, { createdAt: Timestamp.fromMillis(5) }),
    );
    await assertFails(createInvite("a1", k, { email: "khac@example.test" }));
    await assertFails(createInvite("a1", k, { nonce: "ngan" }));
    await assertFails(createInvite("a1", k, { displayName: "" }));
    await assertFails(createInvite("a1", k, { schemaVersion: 2 }));
    await assertSucceeds(createInvite("a1", k, { expiresAt: futureTs(6.9) }));
  });
  it("khóa lời mời phải là email viết thường hợp lệ", async () => {
    await assertFails(createInvite("a1", "Moi@Example.test"));
    await assertFails(createInvite("a1", "khong-co-a-cong"));
  });
  it("thiếu hoặc sai nhật ký lời mời bị chặn (kể cả ghi email)", async () => {
    await assertFails(createInvite("a1", "y1@example.test", {}, null));
    await assertFails(
      createInvite("a1", "y2@example.test", {}, { actorUid: "a2" }),
    );
    await assertFails(
      createInvite("a1", "y3@example.test", {}, { event: "INVITE_REVOKED" }),
    );
    await assertFails(
      createInvite("a1", "y4@example.test", {}, { email: "y4@example.test" }),
    );
    await assertFails(
      createInvite("a1", "y5@example.test", {}, { nonce: randomUUID() }),
    );
  });
  it("thành viên thường hoặc admin thiếu trong sổ không tạo được lời mời", async () => {
    await assertFails(createInvite("m1", "z1@example.test"));
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "users", "ghost"),
        baseUser({ canManageMembership: true }),
      );
    });
    await assertFails(createInvite("ghost", "z2@example.test"));
  });
  it("thu hồi sai: đổi thêm trường, thiếu nhật ký, thu hồi lời mời đã REVOKED", async () => {
    await assertFails(
      revokeInvite("a1", "new1@example.test", NONCE1, {
        expiresAt: futureTs(6),
      }),
    );
    await assertFails(
      revokeInvite("a1", "new1@example.test", NONCE1, { role: "ADMIN" }),
    );
    await assertFails(
      revokeInvite("a1", "new1@example.test", NONCE1, {}, null),
    );
    await assertFails(
      revokeInvite("a1", "new1@example.test", NONCE1, { revokedBy: "a2" }),
    );
    await assertFails(revokeInvite("m1", "new1@example.test", NONCE1));
    await assertSucceeds(revokeInvite("a1", "new1@example.test", NONCE1));
    await assertFails(revokeInvite("a1", "new1@example.test", NONCE1));
  });
  it("lời mời không xóa được", async () => {
    await assertFails(
      deleteDoc(doc(as("a1"), "accountInvites", "new1@example.test")),
    );
  });
});

describe("lời mời — quyền đọc", () => {
  const tok = (email: string, verified = true) =>
    env
      .authenticatedContext("nu", {
        email,
        email_verified: verified,
        firebase: { sign_in_provider: "google.com" },
      })
      .firestore();
  it("quản trị viên get và list; người được mời chỉ get đúng lời mời của mình", async () => {
    await assertSucceeds(getDocs(collection(as("a1"), "accountInvites")));
    await assertSucceeds(
      getDoc(doc(as("a1"), "accountInvites", "new1@example.test")),
    );
    await assertSucceeds(
      getDoc(
        doc(tok("New1@Example.test"), "accountInvites", "new1@example.test"),
      ),
    );
  });
  it("người khác không đọc được lời mời", async () => {
    const key = "new1@example.test";
    await assertFails(
      getDoc(doc(tok("khac@example.test"), "accountInvites", key)),
    );
    await assertFails(
      getDoc(doc(tok("new1@example.test", false), "accountInvites", key)),
    );
    await assertFails(getDoc(doc(as("m1"), "accountInvites", key)));
    await assertFails(
      getDoc(
        doc(env.unauthenticatedContext().firestore(), "accountInvites", key),
      ),
    );
    await assertFails(
      getDocs(collection(tok("new1@example.test"), "accountInvites")),
    );
    await assertFails(getDocs(collection(as("m1"), "accountInvites")));
  });
  it("nhật ký tài khoản/lời mời không đọc được bởi bất kỳ client nào", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "auditLogs", "account-m1-2"), {
        event: "ACCOUNT_UPDATED",
      });
    });
    await assertFails(getDoc(doc(as("a1"), "auditLogs", "account-m1-2")));
    await assertFails(getDocs(collection(as("a1"), "auditLogs")));
  });
});

describe("ca bổ sung theo review độc lập", () => {
  const drift = async (uid: string, admin: boolean) =>
    env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "users", uid),
        baseUser({ canManageMembership: admin }),
      );
    });
  it("T4: sổ không cập nhật đứng riêng (users đã lệch do script/thu hồi ngoài lô)", async () => {
    await drift("m1", true); // m1 là admin trong users nhưng chưa có trong sổ
    const db = as("a1");
    const nang = writeBatch(db);
    nang.update(doc(db, "accessControl", "admins"), {
      adminUids: ["a1", "a2", "m1"],
      version: 2,
      lastTargetUid: "m1",
    });
    await assertFails(nang.commit());
    await drift("a2", false); // a2 bị thu hồi bằng script, sổ vẫn còn a2
    const ha = writeBatch(db);
    ha.update(doc(db, "accessControl", "admins"), {
      adminUids: ["a1"],
      version: 2,
      lastTargetUid: "a2",
    });
    await assertFails(ha.commit());
  });
  it("lô đổi tên hai người hợp lệ (sổ không đổi)", async () => {
    const db = as("a1");
    const b = updateBatch(db, "a1", "m1", "rename");
    updateBatch(db, "a1", "m2", "rename", { into: b });
    await assertSucceeds(b.commit());
  });
  it("lô đổi tên kèm nâng/hạ người khác bị từ chối (sổ đổi thì mọi users còn lại phải đổi admin)", async () => {
    const db = as("a1");
    const b1 = updateBatch(db, "a1", "m1", "rename");
    updateBatch(db, "a1", "m2", "promote", { into: b1 });
    await assertFails(b1.commit());
    const b2 = updateBatch(db, "a1", "m1", "rename");
    updateBatch(db, "a1", "a2", "demote", { into: b2 });
    await assertFails(b2.commit());
  });
  it("nâng quyền cho tài khoản đang tắt phải bật enabled cùng lúc", async () => {
    await assertFails(run("a1", "off", "promote"));
    await assertSucceeds(
      run("a1", "off", "promote", {
        patch: { enabled: true, canManageMembership: true },
        audit: {
          fields: ["enabled", "admin"],
          before: { enabled: false, admin: false },
          after: { enabled: true, admin: true },
        },
      }),
    );
  });
  it("T3: approvedBy/disabledBy/approvedAt/disabledAt chỉ nhận người thao tác và thời điểm máy chủ", async () => {
    // Biến thể hợp lệ trước, rồi từng biến thể chỉ khác một điều kiện.
    await assertSucceeds(
      run("a1", "m1", "rename", {
        patch: {
          approvedBy: "a1",
          approvedAt: serverTimestamp(),
          disabledBy: "a1",
          disabledAt: serverTimestamp(),
        },
      }),
    );
    for (const patch of [
      { approvedBy: "a2" },
      { disabledBy: "a2" },
      { approvedBy: null },
      { approvedAt: Timestamp.fromMillis(1000) },
      { disabledAt: Timestamp.fromMillis(1000) },
      { approvedAt: "bây giờ" },
      { disabledBy: 5 },
    ])
      await assertFails(run("a1", "m2", "rename", { patch }));
  });
  it("R10: increment/arrayUnion được rules đánh giá theo giá trị kết quả, nên lô lỗi thời vẫn an toàn", async () => {
    // Hành vi thật trên emulator: request.resource.data chứa kết quả sau transform (không phải toán tử).
    // Lô hợp lệ qua; lô dựng trước đó cũng qua nhưng tính lại trên sổ mới, không ghi đè mất người vừa nâng.
    const mk = (t: string) => {
      const db = as("a1");
      const b = writeBatch(db);
      b.update(doc(db, "users", t), {
        canManageMembership: true,
        accessVersion: increment(1),
        updatedBy: "a1",
        updatedAt: serverTimestamp(),
      });
      b.update(doc(db, "accessControl", "admins"), {
        adminUids: arrayUnion(t),
        version: increment(1),
        lastTargetUid: t,
      });
      b.set(doc(db, "auditLogs", `account-${t}-2`), {
        event: "ACCOUNT_UPDATED",
        actorUid: "a1",
        targetUid: t,
        accessVersion: 2,
        fields: ["admin"],
        before: { enabled: true, admin: false },
        after: { enabled: true, admin: true },
        timestamp: serverTimestamp(),
        schemaVersion: 1,
      });
      return b;
    };
    const x = mk("m1");
    const y = mk("m2");
    await assertSucceeds(x.commit());
    await assertSucceeds(y.commit());
    let l: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async (c) => {
      l = (await getDoc(doc(c.firestore(), "accessControl", "admins"))).data();
    });
    expect(l?.adminUids).toEqual(["a1", "a2", "m1", "m2"]);
    expect(l?.version).toBe(3);
  });
});

describe("lời mời — nhật ký 1:1 và chống chiếm mã (T1, T2)", () => {
  const auditOf = (
    me: string,
    nonce: string,
    key: string,
    over: Over = {},
  ) => ({
    event: "INVITE_CREATED",
    actorUid: me,
    nonce,
    inviteKey: sha(key),
    timestamp: serverTimestamp(),
    schemaVersion: 1,
    ...over,
  });
  const invite = (key: string, nonce: string) =>
    inviteData(key, { nonce, createdBy: "a1" });
  it("R1: tái dùng nonce của lời mời cũ bị chặn (nhật ký cũ không cùng request)", async () => {
    const n = randomUUID();
    await assertSucceeds(createInvite("a1", "r1a@example.test", { nonce: n }));
    const db = as("a1");
    const b = writeBatch(db);
    b.set(
      doc(db, "accountInvites", "r1b@example.test"),
      invite("r1b@example.test", n),
    );
    await assertFails(b.commit()); // chỉ khác: không ghi nhật ký mới, dựa vào nhật ký cũ
    const b2 = writeBatch(db);
    b2.set(
      doc(db, "accountInvites", "r1b@example.test"),
      invite("r1b@example.test", n),
    );
    b2.set(
      doc(db, "auditLogs", `invite-${n}`),
      auditOf("a1", n, "r1b@example.test"),
    );
    await assertFails(b2.commit()); // nhật ký đã tồn tại: không ghi đè được
  });
  it("R2: hai lời mời cùng nonce dùng chung một nhật ký trong một lô bị chặn", async () => {
    const n = randomUUID();
    const db = as("a1");
    const b = writeBatch(db);
    b.set(
      doc(db, "accountInvites", "r2a@example.test"),
      invite("r2a@example.test", n),
    );
    b.set(
      doc(db, "accountInvites", "r2b@example.test"),
      invite("r2b@example.test", n),
    );
    b.set(
      doc(db, "auditLogs", `invite-${n}`),
      auditOf("a1", n, "r2a@example.test"),
    );
    await assertFails(b.commit());
    // Biến thể chỉ một lời mời + nhật ký đúng thì qua.
    const ok = writeBatch(db);
    ok.set(
      doc(db, "accountInvites", "r2a@example.test"),
      invite("r2a@example.test", n),
    );
    ok.set(
      doc(db, "auditLogs", `invite-${n}`),
      auditOf("a1", n, "r2a@example.test"),
    );
    await assertSucceeds(ok.commit());
  });
  it("nhật ký tạo lời mời sai khóa băm, sai thời điểm hoặc thiếu khóa bị chặn", async () => {
    await assertFails(
      createInvite(
        "a1",
        "k1@example.test",
        {},
        { inviteKey: sha("khac@example.test") },
      ),
    );
    await assertFails(
      createInvite(
        "a1",
        "k2@example.test",
        {},
        { timestamp: Timestamp.fromMillis(5) },
      ),
    );
    await assertFails(
      createInvite("a1", "k3@example.test", {}, { inviteKey: "abc" }),
    );
    await assertFails(
      createInvite(
        "a1",
        "k4@example.test",
        {},
        { inviteKey: sha("K4@example.test") },
      ),
    );
    await assertSucceeds(createInvite("a1", "k5@example.test"));
  });
  it("T2: nhật ký thu hồi mang uid người thao tác; quản trị khác không chiếm mã", async () => {
    const db2 = as("a2");
    const b = writeBatch(db2);
    b.set(
      doc(db2, "auditLogs", `invite-${NONCE1}-revoked-a1`),
      auditOf("a2", NONCE1, "new1@example.test", { event: "INVITE_REVOKED" }),
    );
    await assertFails(b.commit()); // a2 không đặt được mã mang uid a1
    const dbOld = writeBatch(db2);
    dbOld.set(
      doc(db2, "auditLogs", `invite-${NONCE1}-revoked`),
      auditOf("a2", NONCE1, "new1@example.test", { event: "INVITE_REVOKED" }),
    );
    await assertFails(dbOld.commit()); // mã cũ không còn hợp lệ
    await assertSucceeds(revokeInvite("a1", "new1@example.test", NONCE1));
  });
  it("thu hồi bởi quản trị viên khác người phát hành", async () => {
    await assertSucceeds(revokeInvite("a2", "new1@example.test", NONCE1));
  });
  it("thu hồi: nhật ký sai khóa băm hoặc thời điểm cũ bị chặn", async () => {
    await assertFails(
      revokeInvite(
        "a1",
        "new1@example.test",
        NONCE1,
        {},
        { inviteKey: sha("x@example.test") },
      ),
    );
    await assertFails(
      revokeInvite(
        "a1",
        "new1@example.test",
        NONCE1,
        {},
        { timestamp: Timestamp.fromMillis(7) },
      ),
    );
  });
});

// ---- Nhận lời mời -------------------------------------------------------------------------------
interface Acc {
  uid?: string;
  email?: string | null;
  verified?: boolean;
  provider?: string;
  key?: string;
  user?: Over | null;
  inviteUpdate?: Over | null;
  audit?: Over | null;
  noName?: boolean;
}
function acceptBatch(a: Acc = {}) {
  const uid = a.uid ?? "nu";
  const email = a.email === undefined ? "new1@example.test" : a.email;
  const claims: Over = {
    email_verified: a.verified ?? true,
    firebase: { sign_in_provider: a.provider ?? "google.com" },
  };
  if (email !== null) claims.email = email;
  const db = env.authenticatedContext(uid, claims).firestore();
  const key = a.key ?? "new1@example.test";
  const b = writeBatch(db);
  if (a.user !== null) {
    const u: Over = {
      enabled: true,
      roleIds: ["member"],
      canManageMembership: false,
      canReviewChanges: false,
      accessVersion: 1,
      schemaVersion: 1,
      email: key,
      displayName: "Người được mời giả",
      approvedBy: "a1",
      approvedAt: serverTimestamp(),
      invitationNonce: NONCE1,
      ...a.user,
    };
    if (a.noName) delete u.displayName;
    b.set(doc(db, "users", uid), u);
  }
  if (a.inviteUpdate !== null)
    b.update(doc(db, "accountInvites", key), {
      status: "ACCEPTED",
      acceptedBy: uid,
      acceptedAt: serverTimestamp(),
      ...a.inviteUpdate,
    });
  if (a.audit !== null)
    b.set(doc(db, "auditLogs", `account-${uid}-1`), {
      event: "INVITATION_ACCEPTED",
      actorUid: uid,
      targetUid: uid,
      accessVersion: 1,
      invitationNonce: NONCE1,
      timestamp: serverTimestamp(),
      schemaVersion: 1,
      ...a.audit,
    });
  return b.commit();
}

describe("nhận lời mời — ca dương", () => {
  for (const provider of ["google.com", "password"])
    it(`nhận lời mời bằng ${provider} (đăng nhập liên kết email cũng mang password)`, async () => {
      await assertSucceeds(acceptBatch({ provider }));
    });
  it("email viết hoa trong token được chuẩn hóa", async () => {
    await assertSucceeds(acceptBatch({ email: "New1@Example.TEST" }));
  });
  it("sau khi nhận, người dùng đọc được hồ sơ cơ bản và chỉ users của mình", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "memberProfiles", "p1"), {
        displayName: "Giả",
      });
    });
    await assertSucceeds(acceptBatch());
    const db = env
      .authenticatedContext("nu", {
        email: "new1@example.test",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      })
      .firestore();
    await assertSucceeds(getDoc(doc(db, "memberProfiles", "p1")));
    await assertFails(getDocs(collection(db, "users")));
    await assertFails(getDocs(collection(db, "accountInvites")));
  });
  it("lời mời không có displayName thì users cũng không có", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "accountInvites", "nd@example.test"), {
        email: "nd@example.test",
        role: "VIEWER",
        status: "PENDING",
        nonce: NONCE1,
        createdBy: "a1",
        createdAt: Timestamp.now(),
        expiresAt: futureTs(2),
        schemaVersion: 1,
      });
    });
    const acc = { email: "nd@example.test", key: "nd@example.test" };
    await assertFails(acceptBatch(acc));
    await assertSucceeds(acceptBatch({ ...acc, noName: true }));
  });
});

describe("nhận lời mời — ca âm", () => {
  it("email chưa xác minh, thiếu email, email khác bị chặn", async () => {
    await assertFails(acceptBatch({ verified: false }));
    await assertFails(acceptBatch({ email: null }));
    await assertFails(acceptBatch({ email: "khac@example.test" }));
  });
  for (const provider of ["anonymous", "custom", "facebook.com"])
    it(`provider ${provider} bị chặn`, async () => {
      await assertFails(acceptBatch({ provider }));
    });
  it("lời mời hết hạn, đã thu hồi, đã dùng bị chặn", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, "accountInvites", "new1@example.test"), {
        email: "new1@example.test",
        role: "VIEWER",
        displayName: "Người được mời giả",
        status: "PENDING",
        nonce: NONCE1,
        createdBy: "a1",
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() - 1000),
        schemaVersion: 1,
      });
    });
    await assertFails(acceptBatch());
    for (const status of ["REVOKED", "ACCEPTED"]) {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(
          doc(c.firestore(), "accountInvites", "new1@example.test"),
          {
            email: "new1@example.test",
            role: "VIEWER",
            displayName: "Người được mời giả",
            status,
            nonce: NONCE1,
            createdBy: "a1",
            createdAt: Timestamp.now(),
            expiresAt: futureTs(2),
            schemaVersion: 1,
          },
        );
      });
      await assertFails(acceptBatch());
    }
  });
  it("tự đặt quyền quản trị, accessVersion, trường lạ hoặc vai trò khác bị chặn", async () => {
    await assertFails(acceptBatch({ user: { canManageMembership: true } }));
    await assertFails(acceptBatch({ user: { canReviewChanges: true } }));
    await assertFails(acceptBatch({ user: { accessVersion: 5 } }));
    await assertFails(acceptBatch({ user: { schemaVersion: 2 } }));
    await assertFails(acceptBatch({ user: { roleIds: ["admin"] } }));
    await assertFails(acceptBatch({ user: { isOwner: true } }));
    await assertFails(acceptBatch({ user: { enabled: false } }));
    await assertFails(acceptBatch({ user: { approvedBy: "nu" } }));
    await assertFails(
      acceptBatch({ user: { approvedAt: Timestamp.fromMillis(9) } }),
    );
    await assertFails(acceptBatch({ user: { invitationNonce: randomUUID() } }));
    await assertFails(acceptBatch({ user: { displayName: "Tên khác" } }));
    await assertFails(acceptBatch({ user: { email: "khac@example.test" } }));
  });
  it("không cập nhật trạng thái lời mời, hoặc cập nhật sai, bị chặn", async () => {
    await assertFails(acceptBatch({ inviteUpdate: null }));
    await assertFails(acceptBatch({ inviteUpdate: { acceptedBy: "a1" } }));
    await assertFails(acceptBatch({ inviteUpdate: { role: "ADMIN" } }));
    await assertFails(
      acceptBatch({ inviteUpdate: { expiresAt: futureTs(7) } }),
    );
    await assertFails(acceptBatch({ inviteUpdate: { status: "PENDING" } }));
  });
  it("thiếu hoặc sai nhật ký nhận lời mời bị chặn", async () => {
    await assertFails(acceptBatch({ audit: null }));
    await assertFails(acceptBatch({ audit: { actorUid: "a1" } }));
    await assertFails(acceptBatch({ audit: { event: "ACCOUNT_UPDATED" } }));
    await assertFails(acceptBatch({ audit: { accessVersion: 2 } }));
    await assertFails(
      acceptBatch({ audit: { invitationNonce: randomUUID() } }),
    );
  });
  it("tạo users mà không có lời mời hoặc không kèm lô bị chặn", async () => {
    await assertFails(
      acceptBatch({
        uid: "nu2",
        email: "khong@example.test",
        key: "khong@example.test",
      }),
    );
    await assertFails(acceptBatch({ inviteUpdate: null, audit: null }));
  });
  it("người dùng không tạo được users cho uid khác", async () => {
    const db = env
      .authenticatedContext("nu", {
        email: "new1@example.test",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      })
      .firestore();
    await assertFails(
      setDoc(
        doc(db, "users", "nguoi-khac"),
        baseUser({ email: "new1@example.test" }),
      ),
    );
  });
  it("nhận cùng lời mời lần hai (cùng uid hoặc uid khác) thất bại", async () => {
    await assertSucceeds(acceptBatch());
    await assertFails(acceptBatch());
    await assertFails(acceptBatch({ uid: "nu2" }));
  });
  it("hai lô nhận cùng lời mời từ hai uid: chỉ một lô thành công", async () => {
    // Mô phỏng tuần tự; tranh chấp commit đồng thời thật không thể giả lập trong emulator.
    await assertSucceeds(acceptBatch({ uid: "nu1" }));
    await assertFails(acceptBatch({ uid: "nu2" }));
  });
  it("người phát hành đã bị hạ hoặc tắt thì lời mời không dùng được", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "users", "a1"),
        baseUser({ canManageMembership: false }),
      );
    });
    await assertFails(acceptBatch());
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "users", "a1"),
        baseUser({ canManageMembership: true, enabled: false }),
      );
    });
    await assertFails(acceptBatch());
  });
  it("R9: người phát hành bị gỡ khỏi sổ nhưng users vẫn là admin thì lời mời không dùng được", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "accessControl", "admins"),
        ledger(["a2"]),
      );
    });
    await assertFails(acceptBatch());
    // Chỉ khác: a1 trở lại sổ thì nhận được.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "accessControl", "admins"),
        ledger(["a1", "a2"]),
      );
    });
    await assertSucceeds(acceptBatch());
  });
  it("tài khoản đã có users (kể cả đã tắt) không nhận được lời mời", async () => {
    await assertFails(acceptBatch({ uid: "off" }));
    await assertFails(acceptBatch({ uid: "m1" }));
  });
});

describe("ép ASCII và định dạng hex (review lần hai: L-a, L-b)", () => {
  it("nhật ký lời mời: inviteKey phải là hex thường 64 ký tự (biến thể hợp lệ trước)", async () => {
    await assertSucceeds(createInvite("a1", "hex-ok@example.test"));
    await assertFails(
      createInvite(
        "a1",
        "hex-bad@example.test",
        {},
        { inviteKey: "z".repeat(64) },
      ),
    );
    await assertFails(
      createInvite(
        "a1",
        "hex-up@example.test",
        {},
        { inviteKey: sha("hex-up@example.test").toUpperCase() },
      ),
    );
  });
  it("khóa email của lời mời phải là ASCII (ký hiệu Kelvin bị chặn)", async () => {
    await assertSucceeds(createInvite("a1", "kim@example.test"));
    await assertFails(createInvite("a1", "Kim2@example.test"));
    await assertFails(createInvite("a1", "kim3@exämple.test"));
  });
  it("nhận lời mời: email trong token phải là ASCII", async () => {
    await assertSucceeds(acceptBatch({ uid: "nu-ascii" }));
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "accountInvites", "kim@example.test"), {
        email: "kim@example.test",
        role: "VIEWER",
        displayName: "Người được mời giả",
        status: "PENDING",
        nonce: NONCE1,
        createdBy: "a1",
        createdAt: Timestamp.now(),
        expiresAt: futureTs(3),
        schemaVersion: 1,
      });
    });
    await assertFails(
      acceptBatch({
        uid: "nu-kelvin",
        email: "Kim@example.test",
        key: "kim@example.test",
        user: { email: "kim@example.test" },
      }),
    );
  });
});
