// Đối soát treeSnapshots/main ↔ persons/memberProfiles/relations/unions/nhật ký (CHỈ ĐỌC, không ghi gì).
// Chạy: npm run gia-pha:reconcile -- [--project <id>]   (emulator: đặt FIRESTORE_EMULATOR_HOST)
// Kết quả chỉ in mã lỗi và mã tài liệu, không in tên hay ghi chú. Thoát 1 nếu có sai lệch (cảnh báo riêng, không đổi mã thoát).
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { decideTarget } from "./import-plan.ts";
import { reconcile, reconcileWarnings } from "./reconcile-core.ts";
import { EDIT_EVENTS } from "./replace-guard.ts";

const root = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const i = args.indexOf("--project");
const decision = decideTarget(process.env, i >= 0 ? args[i + 1] : undefined, {
  allowProd: true,
});
if (!decision.ok) {
  console.error(`Từ chối: ${decision.reason}`);
  process.exit(2);
}
const requireAdmin = createRequire(resolve(root, "functions", "package.json"));
const { initializeApp, applicationDefault } =
  requireAdmin("firebase-admin/app");
const { getFirestore } = requireAdmin("firebase-admin/firestore");
const app = initializeApp(
  decision.kind === "emulator"
    ? { projectId: decision.project }
    : { projectId: decision.project, credential: applicationDefault() },
);
const db = getFirestore(app);
console.log(`Đối soát (chỉ đọc): ${decision.kind} / ${decision.project}`);

type Snap = { id: string; data: () => Record<string, unknown> };
const map = async (name: string) =>
  new Map<string, Record<string, unknown>>(
    (await db.collection(name).get()).docs.map((d: Snap) => [d.id, d.data()]),
  );
const snap = await db.doc("treeSnapshots/main").get();
const edits = await db
  .collection("auditLogs")
  .where("event", "in", EDIT_EVENTS)
  .select("editVersion", "event")
  .get();
const input = {
  snapshot: snap.exists ? snap.data() : null,
  persons: await map("persons"),
  memberProfiles: await map("memberProfiles"),
  relations: await map("relations"),
  unions: await map("unions"),
  edits: edits.docs.map((d: Snap) => ({
    id: d.id,
    editVersion: d.data().editVersion,
    event: d.data().event,
  })),
};
const issues = reconcile(input);
// Cảnh báo chỉ-đọc, tách khỏi lỗi: không ảnh hưởng mã thoát.
const warnings = reconcileWarnings(input);
if (warnings.length) {
  console.warn(`CẢNH BÁO ${warnings.length} (không làm đối soát thất bại):`);
  for (const x of warnings.slice(0, 200))
    console.warn(` ~ ${x.code}: ${x.ref}`);
}
if (!issues.length) {
  console.log("ĐẠT: không có sai lệch.");
  process.exit(0);
}
console.error(`PHÁT HIỆN ${issues.length} sai lệch:`);
for (const x of issues.slice(0, 200)) console.error(` - ${x.code}: ${x.ref}`);
process.exit(1);
