// Kiểm tra rules cấp quyền trong app (sổ quản trị viên, cập nhật tài khoản) trên emulator Firestore.
// Dữ liệu hoàn toàn giả; không chạm Firebase thật.
import { readFileSync } from "node:fs";
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
  });
});

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
