// firestore.rules cho quyền chỉ đăng nhập Gmail: emailGrants (quản trị viên ghi sẵn) và nhận quyền một lần.
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { buildClaimWrite, buildGrant } from "../src/gmailGrant";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha-gmail-grant",
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
  email: "x@example.test",
  ...extra,
});
const GMAIL = "thanhvien@gmail.com";
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "users", "a1"), user({ canManageMembership: true }));
    await setDoc(doc(db, "users", "m1"), user());
    // quản trị viên "nửa vời": có cờ nhưng không có trong sổ
    await setDoc(doc(db, "users", "half"), user({ canManageMembership: true }));
    await setDoc(doc(db, "accessControl", "admins"), {
      adminUids: ["a1"],
      version: 1,
      lastTargetUid: "",
      schemaVersion: 1,
    });
  });
});
const as = (uid: string) =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;
/** Người đăng nhập Google với email cho trước (token có email_verified và nhà cung cấp google.com). */
const google = (
  uid: string,
  email: string,
  over: { verified?: boolean; provider?: "google.com" | "password" } = {},
) =>
  env
    .authenticatedContext(uid, {
      email,
      email_verified: over.verified ?? true,
      firebase: { sign_in_provider: over.provider ?? "google.com" },
    })
    .firestore() as unknown as Firestore;

async function grant(actor: string, email = GMAIL, name = "") {
  const db = as(actor);
  const g = buildGrant({ actorUid: actor, email, displayName: name });
  return setDoc(doc(db, "emailGrants", g.id), {
    ...g.data,
    createdAt: serverTimestamp(),
  });
}
async function seedGrant(email = GMAIL, createdBy = "a1", name = "Tên giả") {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "emailGrants", email), {
      email,
      displayName: name,
      createdBy,
      createdAt: new Date(),
      schemaVersion: 1,
    });
  });
}
async function claim(
  db: Firestore,
  uid = "g1",
  email = GMAIL,
  tweakUser: (u: Record<string, unknown>) => Record<string, unknown> = (u) => u,
  withDelete = true,
) {
  const w = buildClaimWrite({
    uid,
    email,
    grant: { displayName: "Tên giả", createdBy: "a1" },
  });
  const batch = writeBatch(db);
  batch.set(doc(db, "users", uid), {
    ...tweakUser(w.user),
    approvedAt: serverTimestamp(),
  });
  batch.set(doc(db, "auditLogs", w.auditId), {
    ...w.audit,
    timestamp: serverTimestamp(),
  });
  if (withDelete) batch.delete(doc(db, "emailGrants", email));
  return batch.commit();
}
async function read(path: string, id: string) {
  let snap: Awaited<ReturnType<typeof getDoc>> | undefined;
  await env.withSecurityRulesDisabled(async (c) => {
    snap = await getDoc(doc(c.firestore(), path, id));
  });
  return snap!;
}

describe("quản trị viên ghi sẵn Gmail", () => {
  it("quản trị viên tạo được grant", async () => {
    await assertSucceeds(grant("a1"));
    await assertSucceeds(grant("a1", "khac@gmail.com", "Tên giả"));
  });
  it("không ghi đè grant đã có", async () => {
    await seedGrant();
    await assertFails(grant("a1"));
  });
  it("thành viên thường, quản trị viên nửa vời, người chưa đăng nhập không tạo được", async () => {
    await assertFails(grant("m1"));
    await assertFails(grant("half"));
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "emailGrants", GMAIL), {
        email: GMAIL,
        createdBy: "a1",
        createdAt: serverTimestamp(),
        schemaVersion: 1,
      }),
    );
  });
  it("không phải @gmail.com (hoặc viết hoa) thì từ chối", async () => {
    for (const e of [
      "a@example.com",
      "a@googlemail.com",
      "A@gmail.com",
      "a@gmail.com.vn",
    ]) {
      const g = {
        email: e,
        createdBy: "a1",
        createdAt: serverTimestamp(),
        schemaVersion: 1,
      };
      await assertFails(setDoc(doc(as("a1"), "emailGrants", e), g));
    }
  });
  it("email trong tài liệu phải khớp id, createdBy là chính mình, không trường lạ", async () => {
    const base = {
      email: GMAIL,
      createdBy: "a1",
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    };
    const d = as("a1");
    const ref = doc(d, "emailGrants", GMAIL);
    await assertFails(setDoc(ref, { ...base, email: "khac@gmail.com" }));
    await assertFails(setDoc(ref, { ...base, createdBy: "a2" }));
    await assertFails(setDoc(ref, { ...base, role: "admin" }));
    await assertFails(setDoc(ref, { ...base, createdAt: new Date() }));
  });
  it("chỉ quản trị viên đọc/thu hồi; thành viên thường không", async () => {
    await seedGrant();
    await assertSucceeds(getDoc(doc(as("a1"), "emailGrants", GMAIL)));
    await assertFails(getDoc(doc(as("m1"), "emailGrants", GMAIL)));
    await assertFails(deleteDoc(doc(as("m1"), "emailGrants", GMAIL)));
    await assertSucceeds(deleteDoc(doc(as("a1"), "emailGrants", GMAIL)));
  });
});

describe("nhận quyền khi đăng nhập Google", () => {
  it("nhận được: tạo users (Chỉ xem) + audit, grant bị xóa", async () => {
    await seedGrant();
    await assertSucceeds(claim(google("g1", GMAIL)));
    const u = (await read("users", "g1")).data();
    expect(u).toMatchObject({
      enabled: true,
      canManageMembership: false,
      createdVia: "google",
      approvedBy: "a1",
      email: GMAIL,
      displayName: "Tên giả",
    });
    expect(u).not.toHaveProperty("mustChangePassword");
    expect((await read("emailGrants", GMAIL)).exists()).toBe(false);
    expect(
      ((await read("auditLogs", "account-g1-1")).data() as { event?: string })
        .event,
    ).toBe("ACCOUNT_CLAIMED");
  });
  it("nhận rồi không nhận lại được (grant đã hết)", async () => {
    await seedGrant();
    await claim(google("g1", GMAIL));
    await assertFails(claim(google("g1", GMAIL)));
  });
  it("không có grant thì không tự tạo hồ sơ", async () => {
    await assertFails(claim(google("g1", GMAIL)));
  });
  it("Gmail khác không nhận được grant của người khác", async () => {
    await seedGrant();
    const o = "ngoai@gmail.com";
    await assertFails(claim(google("g2", o), "g2", o));
    await assertFails(claim(google("g2", o), "g2", GMAIL));
  });
  it("token không xác minh email, hoặc không phải đăng nhập Google, bị từ chối", async () => {
    await seedGrant();
    await assertFails(claim(google("g1", GMAIL, { verified: false })));
    await assertFails(claim(google("g1", GMAIL, { provider: "password" })));
  });
  it("không tạo hồ sơ cho uid khác", async () => {
    await seedGrant();
    await assertFails(claim(google("g1", GMAIL), "g9"));
  });
  it("không tự nâng quyền hoặc thêm trường", async () => {
    await seedGrant();
    const g = google("g1", GMAIL);
    const bad: Array<Record<string, unknown>> = [
      { canManageMembership: true },
      { canReviewChanges: true },
      { roleIds: ["admin"] },
      { approvedBy: "g1" },
      { displayName: "Tên khác" },
      { mustChangePassword: false },
      { createdVia: "email" },
    ];
    for (const over of bad)
      await assertFails(claim(g, "g1", GMAIL, (u) => ({ ...u, ...over })));
  });
  it("phải xóa grant trong cùng batch", async () => {
    await seedGrant();
    await assertFails(claim(google("g1", GMAIL), "g1", GMAIL, (u) => u, false));
  });
  it("grant của quản trị viên đã mất quyền không còn hiệu lực", async () => {
    await seedGrant(GMAIL, "half");
    await assertFails(claim(google("g1", GMAIL)));
  });
  it("tài khoản đã có hồ sơ (kể cả bị vô hiệu hóa) không nhận lại để bật quyền", async () => {
    await seedGrant();
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users", "g1"), user({ enabled: false }));
    });
    await assertFails(claim(google("g1", GMAIL)));
  });
  it("người nhận đọc được grant của mình, không đọc của người khác", async () => {
    await seedGrant();
    await assertSucceeds(
      getDoc(doc(google("g1", GMAIL), "emailGrants", GMAIL)),
    );
    await assertFails(
      getDoc(doc(google("g2", "ngoai@gmail.com"), "emailGrants", GMAIL)),
    );
  });
  it("người nhận không xóa grant một mình (không kèm tạo hồ sơ)", async () => {
    await seedGrant();
    await assertFails(
      deleteDoc(doc(google("g1", GMAIL), "emailGrants", GMAIL)),
    );
  });
  it("không dựng audit ACCOUNT_CLAIMED khi không có hồ sơ", async () => {
    await seedGrant();
    await assertFails(
      setDoc(doc(google("g1", GMAIL), "auditLogs", "account-g1-1"), {
        event: "ACCOUNT_CLAIMED",
        actorUid: "g1",
        targetUid: "g1",
        accessVersion: 1,
        schemaVersion: 1,
        timestamp: serverTimestamp(),
      }),
    );
  });
});

describe("ca bổ sung sau phản biện", () => {
  it("email trong token viết hoa vẫn nhận được grant viết thường", async () => {
    await seedGrant();
    await assertSucceeds(claim(google("g1", "ThanhVien@Gmail.com")));
  });
  it("người chưa đăng nhập không đọc được grant", async () => {
    await seedGrant();
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(db, "emailGrants", GMAIL)));
  });
  it("không đổi audit thành ACCOUNT_CREATED để qua mặt", async () => {
    await seedGrant();
    const db = google("g1", GMAIL);
    const w = buildClaimWrite({
      uid: "g1",
      email: GMAIL,
      grant: { displayName: "Tên giả", createdBy: "a1" },
    });
    const batch = writeBatch(db);
    batch.set(doc(db, "users", "g1"), {
      ...w.user,
      approvedAt: serverTimestamp(),
    });
    batch.set(doc(db, "auditLogs", w.auditId), {
      ...w.audit,
      event: "ACCOUNT_CREATED",
      timestamp: serverTimestamp(),
    });
    batch.delete(doc(db, "emailGrants", GMAIL));
    await assertFails(batch.commit());
  });
  it("quản trị viên bị gỡ khỏi sổ sau khi ghi grant: grant hết hiệu lực", async () => {
    await seedGrant(GMAIL, "a2");
    await env.withSecurityRulesDisabled(async (c) => {
      const d = c.firestore();
      await setDoc(doc(d, "users", "a2"), user({ canManageMembership: true }));
      await setDoc(doc(d, "accessControl", "admins"), {
        adminUids: ["a1", "a2"],
        version: 2,
        lastTargetUid: "a2",
        schemaVersion: 1,
      });
    });
    await assertSucceeds(
      claim(google("g1", GMAIL), "g1", GMAIL, (u) => ({
        ...u,
        approvedBy: "a2",
      })),
    );
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const d = c.firestore();
      await setDoc(doc(d, "users", "a1"), user({ canManageMembership: true }));
      await setDoc(doc(d, "accessControl", "admins"), {
        adminUids: ["a1"],
        version: 3,
        lastTargetUid: "a2",
        schemaVersion: 1,
      });
    });
    await seedGrant(GMAIL, "a2");
    await assertFails(
      claim(google("g3", GMAIL), "g3", GMAIL, (u) => ({
        ...u,
        approvedBy: "a2",
      })),
    );
  });
});
