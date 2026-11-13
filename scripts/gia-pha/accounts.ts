// Quản lý tài khoản bằng Admin SDK chạy cục bộ trên máy quản trị (gói Spark chưa có Cloud Functions).
// Chạy: npm run gia-pha:accounts -- <lệnh> [tùy chọn]
//   list
//   grant          --email <email> [--name "Họ tên"] [--admin] [--reviewer] --apply
//   create         --email <email> [--name "Họ tên"] [--admin] [--reviewer] --apply   (tạo tài khoản mật khẩu cho người không có Gmail)
//   revoke         --email <email> [--disable-auth] --apply
//   role           --email <email> [--admin on|off] [--reviewer on|off] --apply
//   reset-password --email <email> --apply
//   registry [--verify]            chỉ đọc: so sổ accessControl/admins với users, thoát mã 1 nếu lệch
//   registry --rebuild [--apply]   dựng lại sổ từ users + chuẩn hóa users lệch (mặc định chỉ in kế hoạch)
// Sổ accessControl/admins phải khớp bất biến của firestore.rules: uid ∈ adminUids ⇔ users.enabled == true &&
// canManageMembership == true. Mọi lệnh ghi users đổi trạng thái quản trị viên cũng ghi sổ trong CÙNG giao dịch.
// Không bao giờ làm số quản trị viên về 0 (kể cả khi có --force; --force không còn được hỗ trợ).
// Mặc định các lệnh ghi chỉ in kế hoạch (không kết nối). Đích: emulator loopback (cả Firestore và Auth) hoặc
// project -dev (cần GOOGLE_APPLICATION_CREDENTIALS ngoài repo và --confirm <project>). Production bị từ chối.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  ACTOR,
  COMMANDS,
  buildGrant,
  buildRevoke,
  buildRole,
  generatePassword,
  validateEmail,
  validateName,
  wouldRemoveLastAdmin,
  assessExistingUser,
  diffRegistry,
  grantRestoresAdmin,
  planAdminWrite,
  planRebuild,
  LEDGER_PATH,
  type Command,
  type AdminWritePlan,
  type Ledger,
} from "./accounts-core.ts";
import { decideTarget } from "./import-plan.ts";
import { evaluateProdGate } from "./prod-gate.ts";

const root = resolve(import.meta.dirname, "..", "..");
const [command, ...args] = process.argv.slice(2) as [
  Command | undefined,
  ...string[],
];
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
function onOff(name: string): boolean | undefined {
  const v = option(name);
  if (v === undefined) return undefined;
  if (v !== "on" && v !== "off")
    throw new Error(`${name} chỉ nhận on hoặc off.`);
  return v === "on";
}
function die(message: string, code = 2): never {
  console.error(`Từ chối: ${message}`);
  process.exit(code);
}

if (!command || !COMMANDS.includes(command)) {
  die(`lệnh phải là một trong: ${COMMANDS.join(", ")}.`);
}
const apply = flag("--apply");
if (flag("--force"))
  die(
    "--force không còn được hỗ trợ: không thể làm số quản trị viên về 0; thêm quản trị viên khác trước.",
  );
const isRegistry = command === "registry";
if (isRegistry && flag("--verify") && flag("--rebuild"))
  die("chỉ chọn một trong --verify hoặc --rebuild.");
const rebuild = isRegistry && flag("--rebuild");
// registry (verify) và list chỉ đọc; registry --rebuild chỉ ghi khi có --apply.
const mutating = command === "list" || isRegistry ? rebuild && apply : true;

let email = "";
let name: string | undefined;
try {
  if (command !== "list" && !isRegistry)
    email = validateEmail(option("--email"));
  name = validateName(option("--name"));
} catch (error) {
  die((error as Error).message);
}

if (mutating && !apply && !isRegistry) {
  console.log(`Chạy thử (dry-run): ${command} ${email}`);
  const extras = [
    flag("--admin") || option("--admin")
      ? `quản trị: ${option("--admin") ?? "bật"}`
      : "",
    flag("--reviewer") || option("--reviewer")
      ? `duyệt: ${option("--reviewer") ?? "bật"}`
      : "",
    name ? "có họ tên" : "",
  ].filter(Boolean);
  if (extras.length) console.log(`Tùy chọn: ${extras.join(", ")}`);
  console.log("Chưa kết nối và chưa ghi gì. Thêm --apply để thực hiện.");
  process.exit(0);
}

const decision = decideTarget(process.env, option("--project"), {
  allowProd: true,
});
if (!decision.ok) die(decision.reason);
if (
  decision.kind === "emulator" &&
  !/^(127\.0\.0\.1|localhost):\d+$/.test(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "",
  )
)
  die("cần cả FIREBASE_AUTH_EMULATOR_HOST loopback khi dùng emulator.");
if (
  decision.kind !== "emulator" &&
  mutating &&
  option("--confirm") !== decision.project
)
  die(`ghi vào project thật cần --confirm ${decision.project}.`);
if (decision.kind === "prod" && mutating) {
  const gate = evaluateProdGate({
    action: "QUAN LY TAI KHOAN",
    project: decision.project,
    confirm: option("--confirm"),
    ack: option("--ack"),
    needsBackup: false,
    now: new Date(),
  });
  if (!gate.ok) {
    console.error("Cổng production KHÔNG ĐẠT:");
    for (const reason of gate.reasons) console.error(` - ${reason}`);
    process.exit(2);
  }
}

const requireAdmin = createRequire(resolve(root, "functions", "package.json"));
const { initializeApp, applicationDefault } =
  requireAdmin("firebase-admin/app");
const { getAuth } = requireAdmin("firebase-admin/auth");
const { getFirestore, Timestamp } = requireAdmin("firebase-admin/firestore");
const app = initializeApp(
  decision.kind === "emulator"
    ? { projectId: decision.project }
    : { projectId: decision.project, credential: applicationDefault() },
);
const auth = getAuth(app);
const db = getFirestore(app);
console.log(`Đích: ${decision.kind} / ${decision.project}`);

async function findUser(address: string) {
  try {
    return await auth.getUserByEmail(address);
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found")
      return null;
    throw error;
  }
}
type Doc = Record<string, unknown>;
// Giao dịch Admin SDK được nạp động (requireAdmin) nên khai báo hình dạng tối thiểu đang dùng.
interface Tx {
  get(ref: unknown): Promise<{
    exists: boolean;
    data(): Doc;
    docs: Array<{ id: string; data(): Doc }>;
  }>;
  set(ref: unknown, data: unknown): void;
  create(ref: unknown, data: unknown): void;
  update(ref: unknown, data: unknown): void;
}
const ledgerRef = db.doc(LEDGER_PATH);
const toMap = (snap: { docs: Array<{ id: string; data(): Doc }> }) =>
  new Map<string, Doc>(snap.docs.map((d) => [d.id, d.data()]));

/**
 * Ghi users/{uid} + sổ (nếu trạng thái quản trị viên đổi) + nhật ký trong MỘT giao dịch. Đọc lại users/sổ trong
 * giao dịch nên không đua với lần chạy khác. Không bao giờ để số quản trị viên về 0 (kể cả sau khi ghi).
 * Đổi trạng thái quản trị viên bị TỪ CHỐI nếu sổ chưa có hoặc đang lệch với users (planAdminWrite): phải chạy
 * `registry --rebuild` trước. Lệnh không đổi quyền quản trị vẫn ghi được, kèm cảnh báo.
 */
async function writeUser(
  uid: string,
  build: (existing: Doc | undefined) => Doc,
  event: string,
) {
  // Lỗi kiểm tra được TRẢ VỀ (giao dịch chỉ đọc, kết thúc sạch) thay vì ném: ném giữa giao dịch có thể để lại khóa
  // trên emulator/Firestore cho đến khi hết thời gian chờ khi tiến trình thoát ngay.
  const failure = await db.runTransaction(async (t: Tx) => {
    const all = toMap(await t.get(db.collection("users")));
    const ledgerSnap = await t.get(ledgerRef);
    const existing = all.get(uid);
    let data: Doc;
    let plan: AdminWritePlan;
    try {
      data = build(existing);
      if (wouldRemoveLastAdmin(existing, [...all.values()], data))
        throw new Error(
          "đây là quản trị viên cuối cùng; thêm quản trị viên khác trước (--force không còn được hỗ trợ).",
        );
      plan = planAdminWrite(
        ledgerSnap.exists
          ? (ledgerSnap.data() as unknown as Ledger)
          : undefined,
        all,
        uid,
        data,
      );
    } catch (error) {
      return error as Error;
    }
    if (plan.error) return new Error(plan.error);
    for (const w of plan.warnings) console.warn(`CẢNH BÁO: ${w}`);
    t.set(db.doc(`users/${uid}`), data);
    if (plan.ledgerWrite) t.set(ledgerRef, plan.ledgerWrite);
    t.set(db.collection("auditLogs").doc(), {
      event,
      actorUid: ACTOR,
      targetUid: uid,
      accessVersion: data.accessVersion,
      timestamp: Timestamp.now(),
      schemaVersion: 1,
    });
    return null;
  });
  if (failure) throw failure;
}
/** Kiểm tra trước mọi thao tác Auth (tạo tài khoản, xác minh email) để bị từ chối thì không để lại tác dụng phụ. */
async function precheckAdminWrite(
  uid: string | undefined,
  build: (existing: Doc | undefined) => Doc,
) {
  const all = toMap(await db.collection("users").get());
  const ledgerSnap = await ledgerRef.get();
  const plan = planAdminWrite(
    ledgerSnap.exists ? (ledgerSnap.data() as unknown as Ledger) : undefined,
    all,
    uid ?? "(tài khoản mới)",
    build(uid ? all.get(uid) : undefined),
  );
  if (plan.error) throw new Error(plan.error);
}
if (isRegistry) {
  const all = toMap(await db.collection("users").get());
  const ledgerSnap = await ledgerRef.get();
  const ledger = ledgerSnap.exists
    ? (ledgerSnap.data() as unknown as Ledger)
    : undefined;
  const diff = diffRegistry(ledger, all);
  if (!rebuild) {
    console.log(
      ledger
        ? `Sổ: version ${String(ledger.version)}, ${Array.isArray(ledger.adminUids) ? ledger.adminUids.length : "?"} quản trị viên.`
        : "Chưa có sổ accessControl/admins.",
    );
    console.log(`Thiếu trong sổ: ${diff.missingFromLedger.join(", ") || "-"}`);
    console.log(`Thừa trong sổ: ${diff.extraInLedger.join(", ") || "-"}`);
    for (const b of diff.badUsers)
      console.log(`users lệch: ${b.uid} (${b.reason})`);
    console.log(diff.clean ? "KHỚP." : "LỆCH.");
    process.exit(diff.clean ? 0 : 1);
  }
  try {
    const plan = planRebuild(ledger, all);
    if (plan.error || !plan.next) die(plan.error ?? "không dựng được sổ.", 1);
    console.log(
      `Kế hoạch: sổ version ${plan.next.version} với ${plan.next.adminUids.length} quản trị viên; chuẩn hóa ${plan.fixes.length} users (mỗi users tăng accessVersion +1; có thể làm mất hiệu lực phiếu duyệt đang treo).`,
    );
    console.log(`Thiếu trong sổ: ${diff.missingFromLedger.join(", ") || "-"}`);
    console.log(`Thừa trong sổ: ${diff.extraInLedger.join(", ") || "-"}`);
    for (const b of diff.badUsers)
      console.log(`sửa users: ${b.uid} (${b.reason})`);
    if (plan.fixes.length > 400)
      die("quá nhiều users cần chuẩn hóa cho một giao dịch (>400).", 1);
    if (!apply) {
      console.log("Chạy thử: chưa ghi gì. Thêm --apply để thực hiện.");
      process.exit(0);
    }
    // Đọc lại và ghi trong một giao dịch để không đua với lần chạy khác; lỗi được trả về, không ném giữa giao dịch.
    const failure = await db.runTransaction(async (t: Tx) => {
      const cur = toMap(await t.get(db.collection("users")));
      const curLedgerSnap = await t.get(ledgerRef);
      const now2 = planRebuild(
        curLedgerSnap.exists
          ? (curLedgerSnap.data() as unknown as Ledger)
          : undefined,
        cur,
      );
      if (now2.error || !now2.next) return new Error(now2.error ?? "lỗi");
      if (now2.fixes.length > 400)
        return new Error(
          "quá nhiều users cần chuẩn hóa cho một giao dịch (>400).",
        );
      // Mã duy nhất theo thời điểm: rebuild lại sau khi sổ bị xóa (version về 1) không bị kẹt; vẫn chỉ create, không PII.
      const auditRef = db
        .collection("auditLogs")
        .doc(`ledger-rebuild-${now2.next.version}-${Date.now()}`);
      for (const [uid, fix] of now2.fixes)
        t.update(db.doc(`users/${uid}`), fix);
      t.set(ledgerRef, now2.next);
      // Nhật ký chung một mã, chỉ tạo mới (không ghi đè); chỉ uid, không email.
      t.create(auditRef, {
        event: "ACCOUNT_LEDGER_REBUILT",
        actorUid: ACTOR,
        ledgerVersion: now2.next.version,
        adminCount: now2.next.adminUids.length,
        normalizedUids: now2.fixes.map(([uid]) => uid),
        timestamp: Timestamp.now(),
        schemaVersion: 1,
      });
      return null;
    });
    if (failure) die(failure.message, 1);
    console.log("Đã dựng lại sổ quản trị viên.");
  } catch (error) {
    die((error as Error).message, 1);
  }
  process.exit(0);
}

if (command === "list") {
  const rows: string[][] = [];
  let pageToken: string | undefined;
  const docs = new Map<string, Record<string, unknown>>();
  for (const d of (await db.collection("users").get()).docs)
    docs.set(d.id, d.data());
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const d = docs.get(u.uid);
      rows.push([
        u.uid.slice(0, 8),
        u.email ?? "(không email)",
        u.displayName ?? "",
        u.providerData
          .map((p: { providerId: string }) => p.providerId)
          .join("+") || "-",
        u.disabled ? "KHÓA" : "mở",
        d?.enabled === true ? "ĐƯỢC CẤP" : d ? "ĐÃ THU HỒI" : "CHỜ DUYỆT",
        [
          d?.canManageMembership === true ? "quản trị" : "",
          d?.canReviewChanges === true ? "duyệt" : "",
        ]
          .filter(Boolean)
          .join(","),
      ]);
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(
    ["uid", "email", "họ tên", "đăng nhập", "Auth", "quyền", "vai trò"].join(
      " | ",
    ),
  );
  for (const row of rows) console.log(row.join(" | "));
  console.log(`Tổng ${rows.length} tài khoản.`);
  process.exit(0);
}

const user = await findUser(email);
const now = Timestamp.now();
try {
  if (command === "create") {
    if (user) die("email đã có tài khoản; dùng grant hoặc reset-password.", 1);
    await precheckAdminWrite(undefined, (existing) =>
      buildGrant(
        existing,
        { email, name, admin: flag("--admin"), reviewer: flag("--reviewer") },
        now,
      ),
    );
    const password = generatePassword();
    const created = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: name,
    });
    await writeUser(
      created.uid,
      (existing) =>
        buildGrant(
          existing,
          { email, name, admin: flag("--admin"), reviewer: flag("--reviewer") },
          now,
        ),
      "ACCOUNT_CREATED",
    );
    console.log(
      `Đã tạo tài khoản và cấp quyền. Mật khẩu (chỉ hiển thị một lần, hãy gửi riêng cho người dùng): ${password}`,
    );
  } else if (command === "grant") {
    // Kiểm tra sổ/quyền quản trị TRƯỚC khi tạo tài khoản Auth hoặc xác minh email.
    await precheckAdminWrite(user?.uid, (existing) =>
      buildGrant(
        existing,
        { email, name, admin: flag("--admin"), reviewer: flag("--reviewer") },
        now,
      ),
    );
    let target = user;
    if (!target) {
      // Tạo sẵn tài khoản không mật khẩu để khi người đó đăng nhập Google bằng đúng email này sẽ vào cùng một tài khoản.
      target = await auth.createUser({
        email,
        emailVerified: true,
        displayName: name,
      });
      console.log(
        "Chưa có tài khoản: đã tạo sẵn (không mật khẩu). Người dùng đăng nhập bằng Google với đúng email này.",
      );
    } else {
      // Chặn "đăng ký trước": không xác minh/cấp quyền cho tài khoản mật khẩu tự đăng ký chưa xác minh email.
      const problem = assessExistingUser({
        disabled: target.disabled,
        emailVerified: target.emailVerified,
        providerIds: target.providerData.map(
          (p: { providerId: string }) => p.providerId,
        ),
      });
      if (problem) die(problem, 1);
      if (!target.emailVerified)
        await auth.updateUser(target.uid, { emailVerified: true });
    }
    await writeUser(
      target.uid,
      (existing) => {
        if (grantRestoresAdmin(existing, flag("--admin")))
          console.warn(
            "CẢNH BÁO: tài khoản đã thu hồi còn canManageMembership=true cũ; cấp lại sẽ KHÔI PHỤC quyền quản trị cũ.",
          );
        return buildGrant(
          existing,
          { email, name, admin: flag("--admin"), reviewer: flag("--reviewer") },
          now,
        );
      },
      "ACCOUNT_GRANTED",
    );
    console.log("Đã cấp quyền truy cập.");
  } else if (command === "revoke") {
    if (!user) die("không tìm thấy tài khoản.", 1);
    await writeUser(
      user.uid,
      (existing) => buildRevoke(existing, now),
      "ACCOUNT_REVOKED",
    );
    await auth.revokeRefreshTokens(user.uid);
    if (flag("--disable-auth"))
      await auth.updateUser(user.uid, { disabled: true });
    console.log("Đã thu hồi quyền và vô hiệu hóa phiên đăng nhập hiện có.");
  } else if (command === "role") {
    if (!user) die("không tìm thấy tài khoản.", 1);
    await writeUser(
      user.uid,
      (existing) =>
        buildRole(existing, {
          admin: onOff("--admin"),
          reviewer: onOff("--reviewer"),
        }),
      "ACCOUNT_ROLE_CHANGED",
    );
    console.log("Đã cập nhật vai trò.");
  } else if (command === "reset-password") {
    if (!user) die("không tìm thấy tài khoản.", 1);
    if (
      !user.providerData.some(
        (p: { providerId: string }) => p.providerId === "password",
      )
    )
      die("tài khoản này không dùng mật khẩu (đăng nhập Google).", 1);
    const password = generatePassword();
    await auth.updateUser(user.uid, { password });
    await auth.revokeRefreshTokens(user.uid);
    await db.collection("auditLogs").add({
      event: "ACCOUNT_PASSWORD_RESET",
      actorUid: ACTOR,
      targetUid: user.uid,
      timestamp: now,
      schemaVersion: 1,
    });
    console.log(
      `Đã đặt lại mật khẩu (chỉ hiển thị một lần, gửi riêng cho người dùng): ${password}`,
    );
  }
} catch (error) {
  die((error as Error).message, 1);
}
process.exit(0);
