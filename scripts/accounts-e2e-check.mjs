// Kiểm tra end-to-end công cụ tài khoản + sổ quản trị viên trên emulator (Auth + Firestore). Dữ liệu giả, chỉ loopback.
// Chạy: npm run test:accounts:e2e   (firebase emulators:exec --project demo-gia-pha --only auth,firestore ...)
// Nội dung: accounts.ts (registry --verify/--rebuild, grant/role/revoke, từ chối khi sổ thiếu/lệch, admin cuối) rồi
// dùng CHÍNH dữ liệu do script dựng làm fixture cho firestore.rules (quản trị viên còn lại hạ/nâng người khác).
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const loop = /^(127\.0\.0\.1|localhost):\d+$/;
const fsHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (
  !loop.test(fsHost) ||
  !loop.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")
) {
  console.error(
    "Từ chối: cần FIRESTORE_EMULATOR_HOST và FIREBASE_AUTH_EMULATOR_HOST loopback (chạy qua emulators:exec).",
  );
  process.exit(2);
}
const PROJECT = "demo-gia-pha";
const req = createRequire(resolve(root, "functions", "package.json"));
const { initializeApp } = req("firebase-admin/app");
const { getAuth } = req("firebase-admin/auth");
const { getFirestore, Timestamp } = req("firebase-admin/firestore");
const app = initializeApp({ projectId: PROJECT });
const auth = getAuth(app);
const db = getFirestore(app);

const run = (...a) => {
  const r = spawnSync(
    "node",
    ["scripts/gia-pha/accounts.ts", ...a, "--project", PROJECT],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    },
  );
  console.log(`$ accounts ${a.join(" ")} -> exit ${r.status}`);
  // Giữ đầu ra để in khi kiểm tra FAIL (đã lọc dòng có mật khẩu/email).
  lastOut = (r.stdout + r.stderr)
    .split("\n")
    .filter((l) => l.trim() && !/Mật khẩu|@/.test(l))
    .join("\n");
  return r.status;
};
let failed = 0;
let lastOut = "";
const check = (name, cond) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}`);
  if (!cond) {
    failed++;
    if (lastOut) console.log(lastOut.replace(/^/gm, "     | "));
  }
};
const ledger = async () => (await db.doc("accessControl/admins").get()).data();
const userDoc = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const mk = async (email, d) => {
  const u = await auth.createUser({ email, emailVerified: true });
  await db.doc(`users/${u.uid}`).set({
    roleIds: ["member"],
    schemaVersion: 1,
    accessVersion: 1,
    email,
    ...d,
  });
  return u.uid;
};

// users giả KHÔNG có sổ: 2 admin, 1 member thiếu bool, 1 đã tắt nhưng canManage true
const A = await mk("a@example.test", {
  enabled: true,
  canManageMembership: true,
});
const B = await mk("b@example.test", {
  enabled: true,
  canManageMembership: true,
});
const M = await mk("m@example.test", { enabled: true });
const D = await mk("d@example.test", {
  enabled: false,
  canManageMembership: true,
});
check(
  "verify báo lệch (mã 1) khi chưa có sổ",
  run("registry", "--verify") === 1,
);
check(
  "chưa có sổ: đổi quyền admin bị từ chối, users không đổi",
  run("grant", "--email", "m@example.test", "--admin", "--apply") === 1 &&
    (await userDoc(M)).canManageMembership === undefined,
);
// Từ chối TRƯỚC thao tác Auth: không tạo tài khoản mồ côi, không đánh dấu email đã xác minh.
const U = await auth.createUser({
  email: "u@example.test",
  emailVerified: false,
});
check(
  "chưa có sổ: grant --admin cho email mới bị từ chối, không tạo Auth",
  run("grant", "--email", "new@example.test", "--admin", "--apply") === 1 &&
    (await auth.getUserByEmail("new@example.test").then(
      () => false,
      () => true,
    )),
);
check(
  "chưa có sổ: grant --admin cho Auth chưa xác minh bị từ chối, email vẫn chưa xác minh",
  run("grant", "--email", "u@example.test", "--admin", "--apply") === 1 &&
    (await auth.getUser(U.uid)).emailVerified === false &&
    !(await db.doc(`users/${U.uid}`).get()).exists,
);
check(
  "rebuild dry-run mã 0 và chưa ghi",
  run("registry", "--rebuild") === 0 && !(await ledger()),
);
check("rebuild --apply", run("registry", "--rebuild", "--apply") === 0);
let l = await ledger();
check(
  "sổ = [A,B] version 1",
  JSON.stringify(l.adminUids) === JSON.stringify([A, B].sort()) &&
    l.version === 1,
);
check(
  "users M có bool false, D canManage false",
  (await userDoc(M)).canManageMembership === false &&
    (await userDoc(D)).canManageMembership === false,
);
const audit = (
  await db
    .collection("auditLogs")
    .where("event", "==", "ACCOUNT_LEDGER_REBUILT")
    .get()
).docs[0]?.data();
check(
  "nhật ký ACCOUNT_LEDGER_REBUILT không chứa email",
  !!audit && !JSON.stringify(audit).includes("@"),
);
check("verify sạch (mã 0)", run("registry", "--verify") === 0);
check(
  "rebuild lần hai không tạo lỗi và tăng version",
  run("registry", "--rebuild", "--apply") === 0 &&
    (await ledger()).version === 2,
);
// rebuild → xóa sổ → rebuild lại vẫn thành công (mã nhật ký duy nhất)
await db.doc("accessControl/admins").delete();
check(
  "xóa sổ rồi rebuild lại thành công (version về 1)",
  run("registry", "--rebuild", "--apply") === 0 &&
    (await ledger()).version === 1,
);
check(
  "grant --admin",
  run("grant", "--email", "m@example.test", "--admin", "--apply") === 0,
);
l = await ledger();
check(
  "sổ có M và lastTargetUid = M",
  l.adminUids.includes(M) && l.lastTargetUid === M,
);
check(
  "role --admin off",
  run("role", "--email", "m@example.test", "--admin", "off", "--apply") === 0 &&
    !(await ledger()).adminUids.includes(M),
);
check("verify sạch", run("registry", "--verify") === 0);
check(
  "revoke thành viên thường",
  run("revoke", "--email", "m@example.test", "--apply") === 0,
);
check(
  "revoke admin B (còn A)",
  run("revoke", "--email", "b@example.test", "--apply") === 0,
);
check(
  "sổ = [A], B canManage=false",
  JSON.stringify((await ledger()).adminUids) === JSON.stringify([A]) &&
    (await userDoc(B)).canManageMembership === false,
);
check("verify sạch", run("registry", "--verify") === 0);
check(
  "revoke admin cuối bị từ chối (mã 1)",
  run("revoke", "--email", "a@example.test", "--apply") === 1,
);
check(
  "revoke admin cuối + --force vẫn bị từ chối",
  run("revoke", "--email", "a@example.test", "--force", "--apply") !== 0,
);
check(
  "role --admin off admin cuối bị từ chối",
  run("role", "--email", "a@example.test", "--admin", "off", "--apply") === 1,
);
check(
  "sổ vẫn [A]",
  JSON.stringify((await ledger()).adminUids) === JSON.stringify([A]),
);
// sổ lệch: sửa tay users B thành admin (không qua sổ) -> đổi quyền admin bị từ chối, lệnh không đổi admin vẫn ghi
check(
  "grant --admin B",
  run("grant", "--email", "b@example.test", "--admin", "--apply") === 0,
);
await db.doc(`users/${B}`).update({ canManageMembership: false });
check("verify lệch sau khi sửa tay (mã 1)", run("registry") === 1);
check(
  "sổ lệch: lệnh không đổi admin (grant thường) vẫn ghi",
  run("grant", "--email", "c@example.test", "--apply") === 0,
);
check(
  "sổ lệch: role --admin on bị từ chối",
  run("role", "--email", "c@example.test", "--admin", "on", "--apply") === 1 &&
    (await userDoc((await auth.getUserByEmail("c@example.test")).uid))
      .canManageMembership === false,
);
check(
  "sổ lệch: grant --admin cho email mới/Auth chưa xác minh bị từ chối, không có tác dụng phụ Auth",
  run("grant", "--email", "new2@example.test", "--admin", "--apply") === 1 &&
    (await auth.getUserByEmail("new2@example.test").then(
      () => false,
      () => true,
    )) &&
    run("grant", "--email", "u@example.test", "--admin", "--apply") === 1 &&
    (await auth.getUser(U.uid)).emailVerified === false,
);
check(
  "create --admin khi sổ lệch không để lại tài khoản Auth mồ côi",
  run("create", "--email", "orphan@example.test", "--admin", "--apply") === 1 &&
    (await auth.getUserByEmail("orphan@example.test").then(
      () => false,
      () => true,
    )),
);
check("rebuild --apply sửa lại", run("registry", "--rebuild", "--apply") === 0);
check("verify sạch", run("registry", "--verify") === 0);

// --- Dữ liệu do script dựng thỏa rules: A (admin còn lại) hạ/nâng B bằng client SDK qua firestore.rules ---
check(
  "grant --admin B lại",
  run("grant", "--email", "b@example.test", "--admin", "--apply") === 0,
);
const rt = createRequire(resolve(root, "package.json"));
const { initializeTestEnvironment, assertSucceeds } = rt(
  "@firebase/rules-unit-testing",
);
const { doc, getDoc, writeBatch, serverTimestamp } = rt("firebase/firestore");
const [host, port] = fsHost.split(":");
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: {
    rules: readFileSync(resolve(root, "firestore.rules"), "utf8"),
    host,
    port: Number(port),
  },
});
const flip = async (me, target, toAdmin) => {
  const c = env.authenticatedContext(me).firestore();
  const cur = (await getDoc(doc(c, "users", target))).data();
  const led = (await getDoc(doc(c, "accessControl", "admins"))).data();
  const av = cur.accessVersion + 1;
  const b = writeBatch(c);
  b.update(doc(c, "users", target), {
    canManageMembership: toAdmin,
    accessVersion: av,
    updatedBy: me,
    updatedAt: serverTimestamp(),
  });
  b.update(doc(c, "accessControl", "admins"), {
    adminUids: toAdmin
      ? [...led.adminUids, target]
      : led.adminUids.filter((x) => x !== target),
    version: led.version + 1,
    lastTargetUid: target,
  });
  b.set(doc(c, "auditLogs", `account-${target}-${av}`), {
    event: "ACCOUNT_UPDATED",
    actorUid: me,
    targetUid: target,
    accessVersion: av,
    fields: ["admin"],
    before: { enabled: true, admin: !toAdmin },
    after: { enabled: true, admin: toAdmin },
    timestamp: serverTimestamp(),
    schemaVersion: 1,
  });
  return b.commit();
};
for (const [label, toAdmin] of [
  ["A hạ B", false],
  ["A nâng B lại", true],
]) {
  try {
    await assertSucceeds(flip(A, B, toAdmin));
    check(`rules: ${label} trên dữ liệu script dựng`, true);
  } catch (e) {
    check(`rules: ${label}: ${String(e.message).slice(0, 160)}`, false);
  }
}
await env.cleanup();
check("verify sạch sau thao tác qua rules", run("registry", "--verify") === 0);
// Chưa có sổ: lệnh không đổi admin ghi được (cảnh báo, không tự dựng sổ).
await db.doc("accessControl/admins").delete();
check(
  "chưa có sổ: grant thường ghi được nhưng KHÔNG tự dựng sổ",
  run("grant", "--email", "e@example.test", "--apply") === 0 &&
    !(await ledger()),
);

// --- Xóa hẳn tài khoản (delete): users + Firebase Auth, KHÔNG hoàn tác ---
check(
  "dựng lại sổ cho kịch bản delete",
  run("registry", "--rebuild", "--apply") === 0 &&
    run("registry", "--verify") === 0,
);
const DEL = "xoa@example.test";
const delUid = await mk(DEL, { enabled: true, canManageMembership: false });
const delArgs = ["delete", "--email", DEL];
const ledgerBefore = JSON.stringify(await ledger());
const userExists = async (uid) => (await db.doc(`users/${uid}`).get()).exists;
const authExists = async (email) =>
  auth.getUserByEmail(email).then(
    () => true,
    () => false,
  );
check(
  "delete (chạy thử) khi còn bật bị chặn, hướng dẫn vô hiệu hóa trước",
  run(...delArgs) === 1 &&
    /Vô hiệu hóa trước/.test(lastOut) &&
    (await userExists(delUid)),
);
check(
  "delete --apply khi còn bật bị từ chối",
  run(...delArgs, "--apply", "--confirm-delete", DEL) === 1 &&
    (await userExists(delUid)) &&
    (await authExists(DEL)),
);
check("revoke tài khoản đích", run("revoke", "--email", DEL, "--apply") === 0);
check(
  "delete --apply thiếu --confirm-delete bị từ chối",
  run(...delArgs, "--apply") === 2 && (await userExists(delUid)),
);
check(
  "delete --apply sai email xác nhận bị từ chối",
  run(...delArgs, "--apply", "--confirm-delete", "khac@example.test") === 2 &&
    (await userExists(delUid)),
);
check(
  "delete chạy thử đúng: in kế hoạch, chưa xóa gì",
  run(...delArgs) === 0 &&
    /KHÔNG hoàn tác/.test(lastOut) &&
    (await userExists(delUid)) &&
    (await authExists(DEL)),
);
const ledgerPre = JSON.stringify(await ledger());
check(
  "delete --apply --confirm-delete đúng: users và Auth mất, nhật ký không chứa email, sổ không đổi",
  run(...delArgs, "--apply", "--confirm-delete", DEL.toUpperCase()) === 0 &&
    !(await userExists(delUid)) &&
    !(await authExists(DEL)) &&
    JSON.stringify(await ledger()) === ledgerPre,
);
const deletedAudit = (
  await db.collection("auditLogs").where("event", "==", "ACCOUNT_DELETED").get()
).docs.map((d) => d.data());
check(
  "nhật ký ACCOUNT_DELETED: targetUid đúng, không email/tên",
  deletedAudit.length === 1 &&
    deletedAudit[0].targetUid === delUid &&
    deletedAudit[0].actorUid === "admin-local-script" &&
    !JSON.stringify(deletedAudit[0]).includes("@") &&
    !("displayName" in deletedAudit[0]),
);
check("verify sạch sau delete", run("registry", "--verify") === 0);
check(
  "delete lần hai: báo không tìm thấy",
  run(...delArgs, "--apply", "--confirm-delete", DEL) === 1 &&
    /Không tìm thấy/.test(lastOut),
);
check(
  "delete quản trị viên bị từ chối (dù đủ xác nhận)",
  run(
    "delete",
    "--email",
    "a@example.test",
    "--apply",
    "--confirm-delete",
    "a@example.test",
  ) === 1 &&
    (await userExists(A)) &&
    (await authExists("a@example.test")),
);
// quản trị viên đã vô hiệu hóa kiểu cũ (canManageMembership còn true) vẫn bị chặn
const OLD = "cu@example.test";
const oldUid = await mk(OLD, { enabled: false, canManageMembership: true });
check(
  "delete tài khoản đã tắt nhưng còn cờ quản trị (sổ lệch/quản trị) bị chặn",
  run("delete", "--email", OLD, "--apply", "--confirm-delete", OLD) === 1 &&
    (await userExists(oldUid)),
);
await db.doc(`users/${oldUid}`).delete();
await auth.deleteUser(oldUid);
// có Auth, không có users: xóa được Auth (cảnh báo); lời mời PENDING chỉ cảnh báo, không bị xóa
const ORPH = "mocoi@example.test";
await auth.createUser({ email: ORPH, emailVerified: true });
await db.doc(`accountInvites/${ORPH}`).set({
  email: ORPH,
  role: "VIEWER",
  status: "PENDING",
  nonce: "22222222-2222-4222-8222-222222222222",
  createdBy: A,
  createdAt: Timestamp.now(),
  expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
  schemaVersion: 1,
});
check(
  "delete (chạy thử) có Auth không users: cảnh báo, và lời mời đang chờ CHẶN xóa",
  run("delete", "--email", ORPH) === 1 &&
    /chỉ xóa tài khoản Firebase Auth/.test(lastOut) &&
    /Thu hồi lời mời trong #\/users trước/.test(lastOut),
);
check(
  "delete --apply bị chặn khi còn lời mời PENDING; Auth và lời mời giữ nguyên",
  run("delete", "--email", ORPH, "--apply", "--confirm-delete", ORPH) === 1 &&
    (await authExists(ORPH)) &&
    (await db.doc(`accountInvites/${ORPH}`).get()).data().status === "PENDING",
);
await db.doc(`accountInvites/${ORPH}`).update({ status: "REVOKED" }); // thu hồi bằng Admin SDK
check(
  "sau khi thu hồi lời mời: xóa Auth thành công, nhật ký authOnly, lời mời giữ nguyên",
  run("delete", "--email", ORPH, "--apply", "--confirm-delete", ORPH) === 0 &&
    !(await authExists(ORPH)) &&
    (await db.doc(`accountInvites/${ORPH}`).get()).exists &&
    (
      await db
        .collection("auditLogs")
        .where("event", "==", "ACCOUNT_DELETED")
        .where("authOnly", "==", true)
        .get()
    ).docs.length === 1,
);
await db.doc(`accountInvites/${ORPH}`).delete();
check(
  "verify sạch sau các kịch bản delete",
  run("registry", "--verify") === 0 &&
    JSON.stringify(await ledger()) === ledgerPre &&
    ledgerBefore.length > 0,
);

console.log(
  failed ? `\n${failed} kiểm tra THẤT BẠI` : "\nTất cả kiểm tra đạt.",
);
process.exit(failed ? 1 : 0);
