// Nạp dữ liệu gia phả đã rà soát vào Firestore (emulator hoặc project dev) bằng Admin SDK.
// Chạy: npm run gia-pha:import -- [--apply] [--replace] [--project <id>] [--confirm <id>]
// Mặc định là chạy thử (dry-run): chỉ in số lượng, không kết nối, không ghi.
// An toàn: chỉ đọc private-data/; từ chối production; khóa service account để ngoài repo.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";
import { parseDsl } from "./dsl.ts";
import { enforceProdGate } from "./prod-guard.ts";
import {
  IMPORT_COLLECTIONS,
  buildImportPlan,
  decideTarget,
} from "./import-plan.ts";

const root = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const input = resolve(root, option("--input") ?? "private-data/gia-pha.txt");
// Dữ liệu thật chỉ ở private-data/; bộ demo giả được phép ở scripts/gia-pha/demo/.
const allowedRoots = ["private-data", "scripts/gia-pha/demo"].map((dir) =>
  resolve(root, dir),
);
const allowed = allowedRoots.some((dir) => {
  const rel = relative(dir, input);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
});
if (!allowed) {
  console.error(
    "Từ chối: dữ liệu đầu vào phải nằm trong private-data/ hoặc scripts/gia-pha/demo/.",
  );
  process.exit(2);
}
const source = readFileSync(input, "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const batchId = `import-${checksum.slice(0, 16)}`;
const model = parseDsl(source);
const errors = model.issues.filter((i) => i.severity === "ERROR");
if (errors.length) {
  console.error(
    `Từ chối: còn ${errors.length} ERROR trong dữ liệu. Chạy npm run gia-pha:excel để xem chi tiết.`,
  );
  process.exit(1);
}
const plan = buildImportPlan(model, batchId);
console.log(
  `Lô nạp ${batchId} (sha256 ${checksum.slice(0, 12)}…): ${plan.docs.length} tài liệu`,
);
console.log(plan.counts);

const apply = flag("--apply");
if (!apply) {
  console.log(
    "Chạy thử (dry-run): chưa kết nối và chưa ghi gì. Thêm --apply để ghi.",
  );
  process.exit(0);
}

const decision = decideTarget(process.env, option("--project"), {
  allowProd: true,
});
if (!decision.ok) {
  console.error(`Từ chối: ${decision.reason}`);
  process.exit(2);
}
if (decision.kind !== "emulator" && option("--confirm") !== decision.project) {
  console.error(
    `Từ chối: nạp vào project thật cần --confirm ${decision.project}.`,
  );
  process.exit(2);
}
if (
  flag("--replace") &&
  decision.kind === "dev" &&
  option("--confirm") !== decision.project
) {
  console.error("Từ chối: --replace cần --confirm <project>.");
  process.exit(2);
}

const requireAdmin = createRequire(resolve(root, "functions", "package.json"));
const { initializeApp, applicationDefault } =
  requireAdmin("firebase-admin/app");
const { getFirestore, Timestamp } = requireAdmin("firebase-admin/firestore");
const app = initializeApp(
  decision.kind === "emulator"
    ? { projectId: decision.project }
    : { projectId: decision.project, credential: applicationDefault() },
);
const db = getFirestore(app);
console.log(`Đích: ${decision.kind} / ${decision.project}`);
if (decision.kind === "prod")
  await enforceProdGate({
    root,
    action: "NAP DU LIEU THAT",
    project: decision.project,
    confirm: option("--confirm"),
    ack: option("--ack"),
    needsBackup: true,
    backupDir: option("--backup-dir"),
    passphrase: process.env.GIA_PHA_BACKUP_PASSPHRASE,
    db,
  });

const done = await db.doc(`importBatches/${batchId}`).get();
if (done.exists) {
  console.log("Lô này đã được nạp trước đó. Không làm gì (idempotent).");
  process.exit(0);
}
if (flag("--replace")) {
  for (const name of IMPORT_COLLECTIONS)
    await db.recursiveDelete(db.collection(name));
  console.log("Đã xóa dữ liệu cũ của các collection nạp (--replace).");
} else {
  for (const name of IMPORT_COLLECTIONS) {
    const existing = await db.collection(name).limit(1).get();
    if (!existing.empty) {
      console.error(
        `Từ chối: collection ${name} đã có dữ liệu. Dùng --replace nếu muốn nạp lại (chỉ emulator/dev).`,
      );
      process.exit(1);
    }
  }
}

const CHUNK = 400;
for (let i = 0; i < plan.docs.length; i += CHUNK) {
  const batch = db.batch();
  for (const d of plan.docs.slice(i, i + CHUNK))
    batch.set(db.doc(d.path), d.data);
  await batch.commit();
}
// Ghi dấu hoàn tất và nhật ký sau cùng; lô dở dang sẽ không có importBatches.
const finish = db.batch();
finish.set(db.doc(`importBatches/${batchId}`), {
  state: "APPLIED",
  checksum,
  counts: plan.counts,
  actorUid: "admin-local-script",
  createdAt: Timestamp.now(),
  schemaVersion: 1,
});
finish.set(db.collection("auditLogs").doc(), {
  event: "IMPORT_APPLIED",
  actorUid: "admin-local-script",
  target: `importBatches/${batchId}`,
  summary: plan.counts,
  timestamp: Timestamp.now(),
  schemaVersion: 1,
});
await finish.commit();
console.log("Đã nạp xong.");
