// Chuẩn hóa "Đã mất" hàng loạt theo đời bằng Admin SDK (dữ liệu thật, chạy trên máy quản trị).
// Quy tắc đã duyệt: mọi thành viên đời 1..4 (mặc định, --max-generation N) VÀ mọi vợ/chồng của họ đều đã mất
// ⇒ persons/{id}.deceased = true + phần tử "đã mất" (9) của bộ dữ liệu trong treeSnapshots/main.
// Chạy: npm run gia-pha:person-deceased -- [--project <id>] [--max-generation 4] [--show]
//         [--apply --expect-version N --expect-count M [--confirm <project> --ack "CHUAN HOA DA MAT <project>"]]
//       npm run gia-pha:person-deceased -- --undo <mã nhật ký maint-person-deceased-...> [--apply ...]
//   mặc định (dry-run): chỉ ĐỌC, in số đếm và editVersion hiện tại (không in tên).
//   --show: in thêm từng dòng `mã | đời | vai trò | tên` để RÀ SOÁT trước khi ghi (chỉ ra màn hình của bạn).
//   --apply: ghi trong MỘT giao dịch; bắt buộc --expect-version <editVersion đã thấy ở dry-run> VÀ --expect-count <số cần đổi
//           đã thấy ở dry-run> (chống gõ nhầm --max-generation: kế hoạch lệch với bản đã rà soát thì từ chối), kiểm lại trong giao dịch.
//   --undo: hoàn tác theo nhật ký của lần đánh dấu: khôi phục ĐÚNG trạng thái trước đó của từng người (không ép false); người đã
//           được sửa tay sau đó (profileVersion khác) bị bỏ qua và báo; mỗi nhật ký chỉ hoàn tác được một lần.
// Điều kiện: ảnh chụp đã có giới tính (chạy gia-pha:snapshot-sex trước) và gia-pha:reconcile sạch. Mỗi người đổi được nâng
// profileVersion + 1 (dùng để phát hiện sửa tay sau đó khi hoàn tác). editVersion KHÔNG đổi (dữ liệu phái sinh, giống
// snapshot-note). Nhật ký auditLogs/maint-person-deceased-<ISO> chỉ có số đếm, mã người và trạng thái trước (không tên). Idempotent.
// Đích: emulator, project -dev, hoặc prod qua cổng (--confirm + --ack "CHUAN HOA DA MAT <project>").
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { decideTarget } from "./import-plan.ts";
import { evaluateProdGate } from "./prod-gate.ts";
import {
  RECENT_BIRTH_YEAR,
  planPersonDeceased,
} from "./person-deceased-core.ts";

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
const show = flag("--show");
const undoId = option("--undo");
if (
  flag("--undo") &&
  (!undoId || !/^maint-person-deceased-[\w-]+$/.test(undoId))
)
  die("--undo cần mã nhật ký dạng maint-person-deceased-<thời điểm>.");
const rawGen = option("--max-generation") ?? "4";
if (!/^[1-9]\d?$/.test(rawGen)) die("--max-generation phải là số nguyên từ 1.");
const maxGeneration = Number(rawGen);
let expectVersion: number | undefined;
let expectCount: number | undefined;
if (apply) {
  const rawCount = option("--expect-count");
  if (rawCount === undefined || !/^\d+$/.test(rawCount))
    die(
      "--apply cần --expect-count <số người cần đổi đã thấy ở dry-run> (số nguyên không âm).",
    );
  expectCount = Number(rawCount);
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
    action: "CHUAN HOA DA MAT",
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
  `Chuẩn hóa "Đã mất" ${undoId ? `(hoàn tác ${undoId})` : `(đời 1..${maxGeneration} và vợ/chồng)`} ${apply ? "GHI" : "chạy thử (chỉ đọc)"}: ${decision.kind} / ${decision.project}`,
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

// Dry-run dùng giao dịch CHỈ ĐỌC để không khóa tài liệu của người đang sửa trong app.
const outcome = await db.runTransaction(
  async (t: Tx) => {
    const snap = await t.get(snapRef);
    const people = await t.get(db.collection("persons"));
    let undo: Array<{
      id: string;
      deceased: boolean;
      tuple: boolean | null;
      afterVersion: number;
    }> = [];
    if (undoId) {
      const a = await t.get(db.doc(`auditLogs/${undoId}`));
      const recs = a.exists ? a.data().records : undefined;
      const valid =
        a.exists &&
        a.data().event === "PERSON_DECEASED_BULK" &&
        a.data().mode === "MARK" &&
        Array.isArray(recs) &&
        recs.every(
          (r: Doc) =>
            typeof r.id === "string" &&
            typeof r.deceased === "boolean" &&
            (r.tuple === null || typeof r.tuple === "boolean") &&
            Number.isInteger(r.afterVersion),
        );
      if (!valid)
        return {
          plan: { errors: [`Nhật ký ${undoId} không hợp lệ để hoàn tác.`] },
          wrote: false as const,
        };
      // Mỗi nhật ký chỉ hoàn tác một lần (tránh hủy nhầm lần đánh dấu sau đó của cùng những người này).
      const done = await t.get(
        db.collection("auditLogs").where("undoes", "==", undoId).limit(1),
      );
      if (done.docs.length > 0)
        return {
          plan: {
            errors: [
              `Nhật ký ${undoId} đã được hoàn tác (${done.docs[0].id}).`,
            ],
          },
          wrote: false as const,
        };
      undo = recs as typeof undo;
    }
    const plan = planPersonDeceased(
      snap.exists ? snap.data() : null,
      new Map<string, Doc>(people.docs.map((d) => [d.id, d.data()])),
      undoId ? { mode: "undo", undo } : { mode: "mark", maxGeneration },
    );
    if ("errors" in plan) return { plan, wrote: false as const };
    if (!apply) return { plan, wrote: false as const };
    if (plan.editVersion !== expectVersion)
      return {
        plan,
        wrote: false as const,
        conflict: `editVersion hiện tại là ${plan.editVersion}, khác --expect-version ${expectVersion}. Chạy thử lại để lấy số mới.`,
      };
    if (plan.stats.toChange !== expectCount)
      return {
        plan,
        wrote: false as const,
        conflict: `Kế hoạch hiện tại đổi ${plan.stats.toChange} người, khác --expect-count ${expectCount} (đã rà soát ở dry-run). Kiểm tra --max-generation và chạy thử lại.`,
      };
    if (plan.stats.toChange === 0) return { plan, wrote: false as const };
    for (const c of plan.changes)
      t.update(db.doc(`persons/${c.id}`), {
        deceased: c.to,
        profileVersion: c.nextVersion,
        updatedAt: Timestamp.now(),
        updatedBy: "maintenance-script",
      });
    t.update(snapRef, { data: plan.json });
    const id = `maint-person-deceased-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    t.create(db.collection("auditLogs").doc(id), {
      event: "PERSON_DECEASED_BULK",
      actorUid: "maintenance-script",
      mode: undoId ? "UNDO" : "MARK",
      ...(undoId ? { undoes: undoId } : { maxGeneration }),
      counts: plan.stats,
      // Trạng thái trước của từng người (chỉ mã, không tên) để hoàn tác đúng.
      ...(undoId
        ? { personIds: plan.changes.map((c) => c.id) }
        : {
            records: plan.changes.map((c) => ({
              id: c.id,
              deceased: c.before!.deceased,
              tuple: c.before!.tuple,
              afterVersion: c.before!.afterVersion,
            })),
          }),
      editVersion: plan.editVersion,
      timestamp: Timestamp.now(),
      schemaVersion: 1,
    });
    return { plan, wrote: true as const, auditId: id };
  },
  apply ? {} : { readOnly: true },
);

if ("errors" in outcome.plan) {
  console.error(`DỪNG, ${outcome.plan.errors.length} lỗi (chỉ in mã):`);
  for (const e of outcome.plan.errors.slice(0, 200)) console.error(` - ${e}`);
  process.exit(1);
}
const { stats, editVersion, changes, review, recentBirth, skippedEdited } =
  outcome.plan;
console.log(`editVersion hiện tại: ${editVersion}`);
console.log(
  `Người trong ảnh chụp: ${stats.persons}; đời 1..${maxGeneration}: ${stats.ancestors}; vợ/chồng: ${stats.spouses}; đã đánh dấu từ trước: ${stats.alreadyDeceased}; cần đổi: ${stats.toChange}`,
);
if (review.length)
  console.log(
    `CẦN XEM LẠI (không tự đổi): ${review.length} vợ/chồng thuộc dòng họ (đời > ${maxGeneration} hoặc chưa rõ) hoặc loại EXTERNAL: ${review.join(", ")}`,
  );
if (recentBirth.length)
  console.log(
    `LƯU Ý: ${recentBirth.length} người sẽ đổi có năm sinh từ ${RECENT_BIRTH_YEAR} (có thể còn sống; dùng --show để xem tên): ${recentBirth.join(", ")}`,
  );
if (skippedEdited.length)
  console.log(
    `BỎ QUA ${skippedEdited.length} người đã được sửa tay sau lần đánh dấu: ${skippedEdited.join(", ")}`,
  );
if (show) {
  const snapData = (await snapRef.get()).data() as Doc | undefined;
  const tuples = JSON.parse(String(snapData?.data ?? "{}")).persons ?? {};
  console.log("Sẽ đổi (mã | đời | sinh | vai trò | tên):");
  for (const c of changes) {
    const tp = tuples[c.id] as unknown[] | undefined;
    console.log(
      ` - ${c.id} | ${tp?.[3] ?? "-"} | ${tp?.[1] ?? "-"} | ${c.role === "ANCESTOR" ? "đời trên" : "vợ/chồng"} | ${tp?.[0] ?? "?"} -> ${c.to ? "ĐÃ MẤT" : "bỏ đã mất"}`,
    );
  }
  if (review.length) {
    console.log("CẦN XEM LẠI (mã | đời | sinh | loại | tên):");
    for (const id of review) {
      const tp = tuples[id] as unknown[] | undefined;
      console.log(
        ` - ${id} | ${tp?.[3] ?? "-"} | ${tp?.[1] ?? "-"} | ${tp?.[4] ?? "?"} | ${tp?.[0] ?? "?"}`,
      );
    }
  }
}
if ("conflict" in outcome && outcome.conflict) die(outcome.conflict, 1);
if (!apply) {
  console.log(
    stats.toChange
      ? `Chạy thử: chưa ghi gì. Để thực hiện thêm: --apply --expect-version ${editVersion} --expect-count ${stats.toChange}${undoId ? "" : ` --max-generation ${maxGeneration}`}${decision.kind === "emulator" ? "" : ` --confirm ${decision.project} --ack "CHUAN HOA DA MAT ${decision.project}"`}`
      : "Chạy thử: không có gì cần đổi.",
  );
} else if (outcome.wrote) {
  console.log(
    `ĐÃ ghi ${stats.toChange} người, ảnh chụp (editVersion giữ nguyên) và nhật ký ${"auditId" in outcome ? outcome.auditId : ""}. Hoàn tác: --undo <mã nhật ký này>.`,
  );
} else {
  console.log("Không có gì cần đổi (idempotent); không ghi.");
}
