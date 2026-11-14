// firestore.rules cho quản trị viên tạo tài khoản (adminCreateOk, ACCOUNT_CREATED) và tự đổi mật khẩu lần đầu.
// Ghi bằng đúng dữ liệu buildCreateWrite dựng ra, cộng các ca bị từ chối.
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { buildCreateWrite } from "../src/accountCreate";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha-account-create",
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
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "users", "a1"), user({ canManageMembership: true }));
    await setDoc(doc(db, "users", "a2"), user({ canManageMembership: true }));
    await setDoc(doc(db, "users", "m1"), user());
    // quản trị viên "nửa vời": có cờ nhưng không có trong sổ
    await setDoc(doc(db, "users", "half"), user({ canManageMembership: true }));
    await setDoc(doc(db, "accessControl", "admins"), {
      adminUids: ["a1", "a2"],
      version: 1,
      lastTargetUid: "",
      schemaVersion: 1,
    });
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
const input = (over: Record<string, unknown> = {}) => ({
  actorUid: "a1",
  targetUid: "n1",
  email: "0914222987@gp.nguyenduc",
  kind: "phone" as const,
  displayName: "Nguyễn Văn A",
  ...over,
});
/** Ghi users + audit trong một batch; `tweakUser`/`tweakAudit` để dựng ca sai. */
async function create(
  actor: string,
  over: Record<string, unknown> = {},
  tweakUser: (u: Record<string, unknown>) => Record<string, unknown> = (u) => u,
  tweakAudit:
    ((a: Record<string, unknown>) => Record<string, unknown>) | null = (a) => a,
) {
  const w = buildCreateWrite(
    input(over) as Parameters<typeof buildCreateWrite>[0],
  );
  const db = as(actor);
  const batch = writeBatch(db);
  batch.set(doc(db, "users", w.userId), {
    ...tweakUser(w.user),
    approvedAt: serverTimestamp(),
  });
  if (tweakAudit)
    batch.set(doc(db, "auditLogs", w.auditId), {
      ...tweakAudit(w.audit),
      timestamp: serverTimestamp(),
    });
  return batch.commit();
}

describe("quản trị viên tạo tài khoản", () => {
  it("tạo được users + audit ACCOUNT_CREATED; sổ quản trị không đổi", async () => {
    await assertSucceeds(create("a1"));
    const u = await read("users", "n1");
    expect(u).toMatchObject({
      enabled: true,
      canManageMembership: false,
      mustChangePassword: true,
      createdVia: "phone",
      email: "0914222987@gp.nguyenduc",
      approvedBy: "a1",
    });
    expect((await read("auditLogs", "account-n1-1"))?.event).toBe(
      "ACCOUNT_CREATED",
    );
    expect((await read("accessControl", "admins"))?.version).toBe(1);
  });
  it("tạo bằng email thật cũng được (createdVia email)", async () => {
    await assertSucceeds(
      create("a1", { email: "a.b@example.test", kind: "email" }),
    );
  });
  it("không có tên hiển thị vẫn được", async () => {
    await assertSucceeds(create("a1", { displayName: "" }));
  });

  it("thành viên thường không tạo được", async () => {
    await assertFails(create("m1"));
  });
  it("người chưa đăng nhập không tạo được", async () => {
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
    const w = buildCreateWrite(
      input() as Parameters<typeof buildCreateWrite>[0],
    );
    await assertFails(
      setDoc(doc(db, "users", "n1"), {
        ...w.user,
        approvedAt: serverTimestamp(),
      }),
    );
  });
  it("quản trị viên không có trong sổ không tạo được", async () => {
    await assertFails(create("half", { actorUid: "half" }));
  });
  it("không tạo cho chính mình, không ghi đè hồ sơ đã có", async () => {
    await assertFails(create("a1", { targetUid: "a1" }));
    await assertFails(create("a1", { targetUid: "m1" }));
  });
  it("không thể tạo tài khoản quản trị, duyệt thay đổi hoặc bị vô hiệu", async () => {
    await assertFails(
      create("a1", {}, (u) => ({ ...u, canManageMembership: true })),
    );
    await assertFails(
      create("a1", {}, (u) => ({ ...u, canReviewChanges: true })),
    );
    await assertFails(create("a1", {}, (u) => ({ ...u, enabled: false })));
    await assertFails(
      create("a1", {}, (u) => ({ ...u, roleIds: ["member", "admin"] })),
    );
  });
  it("bắt buộc mustChangePassword = true và createdVia hợp lệ", async () => {
    await assertFails(
      create("a1", {}, (u) => ({ ...u, mustChangePassword: false })),
    );
    await assertFails(
      create("a1", {}, (u) => {
        const { mustChangePassword: _m, ...rest } = u;
        void _m;
        return rest;
      }),
    );
    await assertFails(
      create("a1", {}, (u) => ({ ...u, createdVia: "google" })),
    );
  });
  it("từ chối trường lạ, email viết hoa, approvedBy giả mạo", async () => {
    await assertFails(create("a1", {}, (u) => ({ ...u, extra: 1 })));
    await assertFails(
      create("a1", {}, (u) => ({ ...u, email: "A@Example.test" })),
    );
    await assertFails(create("a1", {}, (u) => ({ ...u, approvedBy: "a2" })));
    await assertFails(create("a1", {}, (u) => ({ ...u, accessVersion: 2 })));
  });
  it("thiếu audit, hoặc audit sai sự kiện/đối tượng thì từ chối", async () => {
    await assertFails(create("a1", {}, (u) => u, null));
    await assertFails(
      create(
        "a1",
        {},
        (u) => u,
        (a) => ({ ...a, event: "ACCOUNT_UPDATED" }),
      ),
    );
    await assertFails(
      create(
        "a1",
        {},
        (u) => u,
        (a) => ({ ...a, targetUid: "other" }),
      ),
    );
    await assertFails(
      create(
        "a1",
        {},
        (u) => u,
        (a) => ({ ...a, actorUid: "a2" }),
      ),
    );
  });
  it("audit ACCOUNT_CREATED đứng riêng (không kèm users) bị từ chối", async () => {
    const db = as("a1");
    await assertFails(
      setDoc(doc(db, "auditLogs", "account-zz-1"), {
        event: "ACCOUNT_CREATED",
        actorUid: "a1",
        targetUid: "zz",
        accessVersion: 1,
        schemaVersion: 1,
        timestamp: serverTimestamp(),
      }),
    );
  });
  it("tạo trùng lần hai bị từ chối (đã có hồ sơ)", async () => {
    await assertSucceeds(create("a1"));
    await assertFails(create("a2"));
  });
});

describe("tự đổi mật khẩu lần đầu", () => {
  beforeEach(async () => {
    await assertSucceeds(create("a1"));
  });
  it("người dùng hạ cờ mustChangePassword của chính mình", async () => {
    const db = as("n1");
    await assertSucceeds(
      updateDoc(doc(db, "users", "n1"), {
        mustChangePassword: false,
        passwordChangedAt: serverTimestamp(),
      }),
    );
    expect((await read("users", "n1"))?.mustChangePassword).toBe(false);
  });
  it("không hạ cờ của người khác, không sửa trường khác, không bật lại cờ", async () => {
    await assertFails(
      updateDoc(doc(as("m1"), "users", "n1"), {
        mustChangePassword: false,
        passwordChangedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as("n1"), "users", "n1"), {
        mustChangePassword: false,
        passwordChangedAt: serverTimestamp(),
        canManageMembership: true,
      }),
    );
    await assertFails(
      updateDoc(doc(as("n1"), "users", "n1"), {
        mustChangePassword: true,
        passwordChangedAt: serverTimestamp(),
      }),
    );
  });
  it("tài khoản không có cờ thì không tự đặt cờ/trường này", async () => {
    await assertFails(
      updateDoc(doc(as("m1"), "users", "m1"), {
        mustChangePassword: false,
        passwordChangedAt: serverTimestamp(),
      }),
    );
  });
});
