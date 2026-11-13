// Công bố ghi chú (personPrivate.note, đã cắt 300 ký tự) và cờ "đã mất" (persons.deceased) vào treeSnapshots/main bằng
// Admin SDK (quyết định 2026-11-14: ghi chú hiển thị cho mọi thành viên; ghi chú cũ chỉ công bố qua lệnh này).
// Chạy: npm run gia-pha:snapshot-note -- [--project <id>] [--show] [--strip] [--apply --expect-version N [--confirm <project> [--ack "..."]]]
//   mặc định (dry-run): chỉ ĐỌC, in số đếm và editVersion hiện tại (không in tên, không in nội dung).
//   --show: (chỉ dry-run/ghi) in thêm từng dòng `mã | số ký tự | nội dung sẽ hiện cho mọi thành viên` để RÀ SOÁT trước
//           khi công bố. Nội dung chỉ ra màn hình của bạn, không ghi file/nhật ký.
//   --apply: ghi; bắt buộc --expect-version <editVersion đã thấy ở dry-run>, kiểm lại trong giao dịch.
//   --strip: hoàn tác, cắt mọi bộ về 9 phần tử (bỏ ghi chú khỏi ảnh chụp, giữ "đã mất").
// Điều kiện: ảnh chụp đã có giới tính (chạy gia-pha:snapshot-sex trước). Một giao dịch đọc ảnh chụp + persons +
// personPrivate, ghi data (KHÔNG tăng editVersion) và auditLogs/maint-snapshot-note-<ISO> (SNAPSHOT_NOTE_PUBLISHED, chỉ số
// đếm). Idempotent. Đích: emulator, project -dev, hoặc prod qua cổng (--confirm + --ack "CONG BO GHI CHU <project>").
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { decideTarget } from "./import-plan.ts";
import { evaluateProdGate } from "./prod-gate.ts";
import { planSnapshotNote } from "./snapshot-note-core.ts";

const root = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
function die(message: string, code = 2): never {
  console.error(`Từ chối: ${message}`);
  process.exit(code);
}

if (flag("--force"))
  die("--force không được hỗ trợ; xử lý nguyên nhân lỗi rồi chạy lại.");
const apply = flag("--apply");
const strip = flag("--strip");
const show = flag("--show");
let expectVersion: number | undefined;
if (apply) {
  const raw = option("--expect-version");
  if (raw === undefined || !/^\d+$/.test(raw))
    die(
      "--apply cần --expect-version <số editVersion đã thấy ở dry-run> (số nguyên không âm).",
    );
  expectVersion = Number(raw);
}

const decision = decideTarget(process.env, option("--project"), {
  allowProd: true,
});
if (!decision.ok) die(decision.reason);
if (
  decision.kind !== "emulator" &&
  apply &&
  option("--confirm") !== decision.project
)
  die(`ghi vào project thật cần --confirm ${decision.project}.`);
if (decision.kind === "prod" && apply) {
  const gate = evaluateProdGate({
    action: "CONG BO GHI CHU",
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
const { getFirestore, Timestamp } = requireAdmin("firebase-admin/firestore");
const app = initializeApp(
  decision.kind === "emulator"
    ? { projectId: decision.project }
    : { projectId: decision.project, credential: applicationDefault() },
);
const db = getFirestore(app);
console.log(
  `Công bố ghi chú${strip ? " (--strip)" : ""} ${apply ? "GHI" : "chạy thử (chỉ đọc)"}: ${decision.kind} / ${decision.project}`,
);

type Doc = Record<string, unknown>;
interface Tx {
  get(ref: unknown): Promise<{
    exists: boolean;
    data(): Doc;
    docs: Array<{ id: string; data(): Doc }>;
  }>;
  update(ref: unknown, data: unknown): void;
  create(ref: unknown, data: unknown): void;
}
const snapRef = db.doc("treeSnapshots/main");

// Đọc + lập kế hoạch trong giao dịch (apply) để không đua với lần sửa trong app; dry-run cũng dùng giao dịch chỉ đọc.
const outcome = await db.runTransaction(async (t: Tx) => {
  const snap = await t.get(snapRef);
  const people = await t.get(db.collection("persons"));
  const notes = await t.get(db.collection("personPrivate"));
  const plan = planSnapshotNote(
    snap.exists ? snap.data() : null,
    new Map<string, Doc>(people.docs.map((d) => [d.id, d.data()])),
    new Map<string, Doc>(notes.docs.map((d) => [d.id, d.data()])),
    { strip },
  );
  if ("errors" in plan) return { plan, wrote: false as const };
  if (!apply) return { plan, wrote: false as const };
  if (plan.editVersion !== expectVersion)
    return {
      plan,
      wrote: false as const,
      conflict: `editVersion hiện tại là ${plan.editVersion}, khác --expect-version ${expectVersion}. Chạy thử lại để lấy số mới.`,
    };
  if (plan.stats.changed === 0) return { plan, wrote: false as const };
  t.update(snapRef, { data: plan.json });
  const id = `maint-snapshot-note-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  t.create(db.collection("auditLogs").doc(id), {
    event: "SNAPSHOT_NOTE_PUBLISHED",
    actorUid: "maintenance-script",
    mode: strip ? "STRIP" : "PUBLISH",
    counts: plan.stats,
    editVersion: plan.editVersion,
    timestamp: Timestamp.now(),
    schemaVersion: 1,
  });
  return { plan, wrote: true as const };
});

if ("errors" in outcome.plan) {
  console.error(`DỪNG, ${outcome.plan.errors.length} lỗi (chỉ in mã):`);
  for (const e of outcome.plan.errors.slice(0, 200)) console.error(` - ${e}`);
  process.exit(1);
}
const { stats, editVersion, review } = outcome.plan;
console.log(`editVersion hiện tại: ${editVersion}`);
console.log(
  `Người trong ảnh chụp: ${stats.persons}; có ghi chú: ${stats.withNote} (bị cắt ${stats.clipped}); cần đổi: ${stats.changed} (công bố lần đầu ${stats.newlyPublished})`,
);
if (show) {
  console.log("Ghi chú sẽ hiện cho MỌI thành viên (mã | số ký tự | nội dung):");
  for (const r of review)
    console.log(
      ` - ${r.id} | ${r.chars} | ${r.published.replaceAll("\n", " ⏎ ")}`,
    );
}
if ("conflict" in outcome && outcome.conflict) die(outcome.conflict, 1);
if (!apply) {
  console.log(
    stats.changed
      ? `Chạy thử: chưa ghi gì. Thêm --apply --expect-version ${editVersion}${decision.kind === "emulator" ? "" : ` --confirm ${decision.project}`} để thực hiện.`
      : "Chạy thử: ảnh chụp đã đồng bộ, không cần ghi.",
  );
} else if (outcome.wrote) {
  console.log("ĐÃ ghi ảnh chụp (editVersion giữ nguyên) và nhật ký.");
} else {
  console.log("Không có gì cần đổi (idempotent); không ghi.");
}
