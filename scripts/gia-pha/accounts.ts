// Quản lý tài khoản bằng Admin SDK chạy cục bộ trên máy quản trị (gói Spark chưa có Cloud Functions).
// Chạy: npm run gia-pha:accounts -- <lệnh> [tùy chọn]
//   list
//   grant          --email <email> [--name "Họ tên"] [--admin] [--reviewer] --apply
//   create         --email <email> [--name "Họ tên"] [--admin] [--reviewer] --apply   (tạo tài khoản mật khẩu cho người không có Gmail)
//   revoke         --email <email> [--disable-auth] [--force] --apply
//   role           --email <email> [--admin on|off] [--reviewer on|off] [--force] --apply
//   reset-password --email <email> --apply
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
  type Command,
} from "./accounts-core.ts";
import { decideTarget } from "./import-plan.ts";

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
const mutating = command !== "list";
const apply = flag("--apply");

let email = "";
let name: string | undefined;
try {
  if (command !== "list") email = validateEmail(option("--email"));
  name = validateName(option("--name"));
} catch (error) {
  die((error as Error).message);
}

if (mutating && !apply) {
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

const decision = decideTarget(process.env, option("--project"));
if (!decision.ok) die(decision.reason);
if (
  decision.kind === "emulator" &&
  !/^(127\.0\.0\.1|localhost):\d+$/.test(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "",
  )
)
  die("cần cả FIREBASE_AUTH_EMULATOR_HOST loopback khi dùng emulator.");
if (
  decision.kind === "dev" &&
  mutating &&
  option("--confirm") !== decision.project
)
  die(`ghi vào project thật cần --confirm ${decision.project}.`);

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
async function allUserDocs(): Promise<Array<Record<string, unknown>>> {
  return (await db.collection("users").get()).docs.map(
    (d: { data(): Record<string, unknown> }) => d.data(),
  );
}
async function writeUser(
  uid: string,
  data: Record<string, unknown>,
  event: string,
) {
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), data);
  batch.set(db.collection("auditLogs").doc(), {
    event,
    actorUid: ACTOR,
    targetUid: uid,
    accessVersion: data.accessVersion,
    timestamp: Timestamp.now(),
    schemaVersion: 1,
  });
  await batch.commit();
}
async function doc(uid: string) {
  return (await db.doc(`users/${uid}`).get()).data() as
    Record<string, unknown> | undefined;
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
    const password = generatePassword();
    const created = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: name,
    });
    await writeUser(
      created.uid,
      buildGrant(
        undefined,
        { email, name, admin: flag("--admin"), reviewer: flag("--reviewer") },
        now,
      ),
      "ACCOUNT_CREATED",
    );
    console.log(
      `Đã tạo tài khoản và cấp quyền. Mật khẩu (chỉ hiển thị một lần, hãy gửi riêng cho người dùng): ${password}`,
    );
  } else if (command === "grant") {
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
      buildGrant(
        await doc(target.uid),
        { email, name, admin: flag("--admin"), reviewer: flag("--reviewer") },
        now,
      ),
      "ACCOUNT_GRANTED",
    );
    console.log("Đã cấp quyền truy cập.");
  } else if (command === "revoke") {
    if (!user) die("không tìm thấy tài khoản.", 1);
    const existing = await doc(user.uid);
    const after = buildRevoke(existing, now);
    if (
      !flag("--force") &&
      wouldRemoveLastAdmin(existing, await allUserDocs(), after)
    )
      die(
        "đây là quản trị viên cuối cùng; thêm quản trị viên khác trước hoặc dùng --force.",
        1,
      );
    await writeUser(user.uid, after, "ACCOUNT_REVOKED");
    await auth.revokeRefreshTokens(user.uid);
    if (flag("--disable-auth"))
      await auth.updateUser(user.uid, { disabled: true });
    console.log("Đã thu hồi quyền và vô hiệu hóa phiên đăng nhập hiện có.");
  } else if (command === "role") {
    if (!user) die("không tìm thấy tài khoản.", 1);
    const existing = await doc(user.uid);
    const after = buildRole(existing, {
      admin: onOff("--admin"),
      reviewer: onOff("--reviewer"),
    });
    if (
      !flag("--force") &&
      wouldRemoveLastAdmin(existing, await allUserDocs(), after)
    )
      die(
        "không thể hạ quyền quản trị viên cuối cùng; dùng --force nếu thật sự muốn.",
        1,
      );
    await writeUser(user.uid, after, "ACCOUNT_ROLE_CHANGED");
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
