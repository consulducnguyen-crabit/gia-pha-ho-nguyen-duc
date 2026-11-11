// Sao lưu, kiểm tra, khôi phục và đối chiếu Firestore bằng Admin SDK chạy cục bộ (gói Spark chưa có export tự động).
// Chạy: npm run gia-pha:backup -- <lệnh> [tùy chọn]
//   backup  [--out <thư mục>] [--project <id> --confirm <id>]     Sao lưu (chỉ đọc; cho phép cả prod)
//   verify  --dir <thư mục sao lưu>                               Kiểm tra checksum và số lượng (không kết nối)
//   compare --dir <thư mục sao lưu> [--project ... --confirm ...]  So Firestore hiện tại với bản sao lưu (chỉ đọc)
//   restore --dir <thư mục sao lưu> [--replace] --apply            Khôi phục (CHỈ emulator hoặc project -dev)
// Mã hóa tùy chọn: đặt biến GIA_PHA_BACKUP_PASSPHRASE (>= 12 ký tự); cần cùng biến này để verify/compare/restore.
// Nơi lưu: trong backups/ hoặc private-data/ của repo (bị .gitignore chặn), hoặc ngoài repo. Dữ liệu sao lưu là dữ liệu
// thật nên KHÔNG bao giờ để trong thư mục được commit và không đưa lên CI.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BACKUP_FORMAT,
  backupLocationAllowed,
  compareDocSets,
  countDocs,
  decodeValue,
  decryptBytes,
  docLine,
  encryptBytes,
  parseDocLine,
  sha256,
  verifyManifest,
  type Manifest,
  type ManifestFile,
} from "./backup-core.ts";
import { decideTarget } from "./import-plan.ts";

const root = resolve(import.meta.dirname, "..", "..");
const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
function die(message: string, code = 2): never {
  console.error(`Từ chối: ${message}`);
  process.exit(code);
}
if (!["backup", "verify", "compare", "restore"].includes(command ?? "")) {
  die("lệnh phải là backup, verify, compare hoặc restore.");
}
const passphrase = process.env.GIA_PHA_BACKUP_PASSPHRASE;
const readBytes = (path: string) => new Uint8Array(readFileSync(path));

function loadBackup(dirArg: string | undefined) {
  if (!dirArg) die("thiếu --dir.");
  const dir = resolve(root, dirArg);
  if (!backupLocationAllowed(dir, root))
    die(
      "thư mục sao lưu phải ngoài repo hoặc trong backups/ hoặc private-data/.",
    );
  const manifest = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const result = verifyManifest(manifest, (name) => {
    try {
      return readBytes(join(dir, name));
    } catch {
      return undefined;
    }
  });
  const problems = [...result.problems];
  const collections = new Map<string, Map<string, string>>();
  if (result.ok) {
    if (manifest.encrypted && !passphrase)
      die("bản sao lưu đã mã hóa; đặt GIA_PHA_BACKUP_PASSPHRASE.");
    for (const file of manifest.files) {
      if (!file.collection) continue;
      let text: string;
      try {
        const raw = readBytes(join(dir, file.name));
        text = Buffer.from(
          manifest.encrypted ? decryptBytes(raw, passphrase!) : raw,
        ).toString("utf8");
      } catch (error) {
        problems.push(`${file.name}: ${(error as Error).message}`);
        continue;
      }
      try {
        const { count } = countDocs(text);
        if (count !== file.documents)
          problems.push(
            `${file.name}: số tài liệu ${count} khác manifest ${file.documents}`,
          );
      } catch (error) {
        problems.push(`${file.name}: ${(error as Error).message}`);
        continue;
      }
      const map = new Map<string, string>();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const doc = parseDocLine(line);
        map.set(doc.id, line);
      }
      collections.set(file.collection, map);
    }
  }
  return { dir, manifest, problems, collections };
}

if (command === "verify") {
  const { manifest, problems } = loadBackup(option("--dir"));
  const total = manifest.files.reduce((n, f) => n + f.documents, 0);
  console.log(
    `Sao lưu ${manifest.project} lúc ${manifest.createdAt}: ${manifest.files.length} tệp, ${total} tài liệu, ${manifest.encrypted ? "đã mã hóa" : "không mã hóa"}.`,
  );
  if (problems.length) {
    for (const p of problems) console.error(`LỖI: ${p}`);
    process.exit(1);
  }
  console.log("Kiểm tra đạt: checksum và số lượng khớp manifest.");
  process.exit(0);
}

// ---- Các lệnh cần kết nối Firestore ----
const writing = command === "restore";
if (writing && !flag("--apply")) {
  const { manifest, problems } = loadBackup(option("--dir"));
  if (problems.length) die(`bản sao lưu không hợp lệ: ${problems[0]}`, 1);
  const rows = manifest.files
    .filter((f) => f.collection)
    .map((f) => `${f.collection}: ${f.documents}`);
  console.log(`Chạy thử (dry-run) khôi phục: ${rows.join(", ")}`);
  console.log(
    "Chưa kết nối và chưa ghi gì. Thêm --apply để ghi (chỉ emulator hoặc project -dev).",
  );
  process.exit(0);
}
const project = option("--project");
let target: { kind: "emulator" | "dev" | "real"; project: string };
if (writing) {
  const d = decideTarget(process.env, project);
  if (!d.ok) die(d.reason);
  if (d.kind === "dev" && option("--confirm") !== d.project)
    die(`ghi vào project thật cần --confirm ${d.project}.`);
  target = { kind: d.kind, project: d.project };
} else if (process.env.FIRESTORE_EMULATOR_HOST) {
  if (
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)
  )
    die("FIRESTORE_EMULATOR_HOST phải là loopback.");
  target = { kind: "emulator", project: project ?? "demo-gia-pha" };
} else {
  if (!project) die("thiếu --project (hoặc đặt emulator).");
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS)
    die("thiếu GOOGLE_APPLICATION_CREDENTIALS (khóa để ngoài repo).");
  if (option("--confirm") !== project) die(`cần --confirm ${project}.`);
  target = { kind: "real", project }; // lệnh chỉ đọc nên cho phép cả production
}

const requireAdmin = createRequire(resolve(root, "functions", "package.json"));
const { initializeApp, applicationDefault } =
  requireAdmin("firebase-admin/app");
const { getAuth } = requireAdmin("firebase-admin/auth");
const { getFirestore, Timestamp } = requireAdmin("firebase-admin/firestore");
const app = initializeApp(
  target.kind === "emulator"
    ? { projectId: target.project }
    : { projectId: target.project, credential: applicationDefault() },
);
const db = getFirestore(app);
console.log(`Đích: ${target.kind} / ${target.project}`);

async function liveCollections(): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  for (const col of await db.listCollections()) {
    const map = new Map<string, string>();
    for (const d of (await col.get()).docs)
      map.set(d.id, docLine({ id: d.id, data: d.data() }));
    out.set(col.id, map);
  }
  return out;
}
const SAFE_COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;

if (command === "backup") {
  const base = resolve(root, option("--out") ?? "backups");
  if (!backupLocationAllowed(base, root))
    die("--out phải ngoài repo hoặc trong backups/ hoặc private-data/.");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..*/, "")
    .replace("T", "-");
  const dir = join(base, `${target.project}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const encrypted = Boolean(passphrase);
  const files: ManifestFile[] = [];
  const write = (
    name: string,
    text: string,
    collection: string | null,
    documents: number,
  ) => {
    const bytes = encrypted
      ? encryptBytes(Buffer.from(text, "utf8"), passphrase!)
      : Buffer.from(text, "utf8");
    const fileName = encrypted ? `${name}.enc` : name;
    writeFileSync(join(dir, fileName), bytes);
    files.push({
      name: fileName,
      collection,
      documents,
      sha256: sha256(bytes),
    });
  };
  for (const [name, docs] of await liveCollections()) {
    if (!SAFE_COLLECTION.test(name))
      die(`tên collection không an toàn: ${name}`, 1);
    write(
      `${name}.jsonl`,
      [...docs.values()].join("\n") + (docs.size ? "\n" : ""),
      name,
      docs.size,
    );
  }
  // Danh sách tài khoản Auth (không có mật khẩu/băm mật khẩu). Khôi phục tài khoản mật khẩu = chạy lại grant/create.
  if (target.kind !== "emulator" || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    const auth = getAuth(app);
    const users: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const u of page.users)
        users.push({
          uid: u.uid,
          email: u.email ?? null,
          displayName: u.displayName ?? null,
          emailVerified: u.emailVerified,
          disabled: u.disabled,
          providers: u.providerData.map(
            (p: { providerId: string }) => p.providerId,
          ),
        });
      pageToken = page.pageToken;
    } while (pageToken);
    write(
      "auth-users.json",
      JSON.stringify(users, null, 1),
      null,
      users.length,
    );
  }
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    project: target.project,
    encrypted,
    files,
    note: "Gồm Firestore (mọi collection gốc) và danh sách Auth không mật khẩu. Không gồm Storage. Không đưa thư mục này lên Git/CI.",
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
  const total = files
    .filter((f) => f.collection)
    .reduce((n, f) => n + f.documents, 0);
  console.log(
    `Đã sao lưu ${total} tài liệu / ${files.filter((f) => f.collection).length} collection vào ${dir} (${encrypted ? "đã mã hóa" : "KHÔNG mã hóa"}).`,
  );
  if (!encrypted)
    console.log(
      "Gợi ý: đặt GIA_PHA_BACKUP_PASSPHRASE để mã hóa trước khi lưu vào ổ ngoài/đám mây.",
    );
  process.exit(0);
}

const { problems, collections } = loadBackup(option("--dir"));
if (problems.length) {
  for (const p of problems) console.error(`LỖI: ${p}`);
  die("bản sao lưu không hợp lệ.", 1);
}

if (command === "compare") {
  const live = await liveCollections();
  let bad = 0;
  const names = new Set([...collections.keys(), ...live.keys()]);
  for (const name of [...names].sort()) {
    const c = compareDocSets(
      collections.get(name) ?? new Map(),
      live.get(name) ?? new Map(),
    );
    const diff = c.missing.length + c.extra.length + c.different.length;
    console.log(
      `${name}: sao lưu ${collections.get(name)?.size ?? 0}, hiện tại ${live.get(name)?.size ?? 0}, thiếu ${c.missing.length}, thừa ${c.extra.length}, khác ${c.different.length}`,
    );
    bad += diff;
  }
  if (bad) {
    console.error(
      `KHÔNG KHỚP: ${bad} khác biệt (chỉ in số lượng, không in nội dung).`,
    );
    process.exit(1);
  }
  console.log("KHỚP: Firestore hiện tại giống hệt bản sao lưu.");
  process.exit(0);
}

// restore
if (target.kind === "real")
  die("không khôi phục vào hệ thống thật ở bước này.");
const existing = new Map<string, number>();
for (const name of collections.keys())
  existing.set(name, (await db.collection(name).limit(1).get()).size);
const occupied = [...existing].filter(([, n]) => n > 0).map(([name]) => name);
if (occupied.length && !flag("--replace"))
  die(
    `các collection đã có dữ liệu: ${occupied.join(", ")}. Dùng --replace (chỉ emulator/dev).`,
    1,
  );
if (flag("--replace"))
  for (const name of collections.keys())
    await db.recursiveDelete(db.collection(name));
const makeTs = (s: number, n: number) => new Timestamp(s, n);
let written = 0;
for (const [name, docs] of collections) {
  if (!SAFE_COLLECTION.test(name))
    die(`tên collection không an toàn: ${name}`, 1);
  const entries = [...docs.values()].map(parseDocLine);
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    for (const d of entries.slice(i, i + 400))
      batch.set(db.collection(name).doc(d.id), decodeValue(d.data, makeTs));
    await batch.commit();
    written += Math.min(400, entries.length - i);
  }
}
console.log(
  `Đã khôi phục ${written} tài liệu. Chạy compare để kiểm chứng. (Tài khoản Auth: tạo lại bằng grant/create.)`,
);
process.exit(0);
