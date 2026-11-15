// Kiểm tra end-to-end lệnh gia-pha:person-deceased trên emulator Firestore (DỮ LIỆU GIẢ, chỉ loopback).
// Chạy: npm run test:person-deceased:e2e   (firebase emulators:exec --project demo-gia-pha --only firestore ...)
// Luồng: chạy thử (không ghi) → các cách --apply sai bị từ chối → --apply đúng → kiểm persons/ảnh chụp/nhật ký →
// chạy lại (idempotent) → công bố ghi chú rồi vẫn khớp → hoàn tác (bỏ qua người sửa tay, giữ người vốn đã mất, không hoàn tác hai lần).
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (
  !/^(127\.0\.0\.1|localhost):\d+$/.test(
    process.env.FIRESTORE_EMULATOR_HOST ?? "",
  )
) {
  console.error(
    "Từ chối: cần FIRESTORE_EMULATOR_HOST loopback (chạy qua emulators:exec).",
  );
  process.exit(2);
}
const PROJECT = "demo-gia-pha";
const req = createRequire(resolve(root, "functions", "package.json"));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: PROJECT }));

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const run = (script, ...a) => {
  const r = spawnSync(
    "node",
    [`scripts/gia-pha/${script}.ts`, ...a, "--project", PROJECT],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  return { status: r.status, out: r.stdout + r.stderr };
};

// [tên, năm sinh, năm mất, đời, loại, nhánh, cờ, giới tính]
const tuples = {
  g1: ["Giả đời 1", 1800, null, 1, "C", "c1", [], "M"],
  w1: ["Vợ đời 1", null, null, null, "S", null, [], "F"],
  g3: ["Giả đời 3", null, null, 3, "C", "c1", [], "M"],
  g4: ["Giả đời 4", null, null, 4, "C", "c1", [], "F"],
  h4: ["Chồng đời 4", null, null, null, "S", null, [], "M"],
  g5: ["Giả đời 5", null, null, 5, "C", "c1", [], "M"],
  w5: ["Vợ đời 5", null, null, null, "S", null, [], "F"],
  ex: ["Người EXTERNAL", null, null, null, "E", null, [], "M"],
};
const gen = { g1: 1, g3: 3, g4: 4, g5: 5 };
const category = { C: "CLAN", S: "SPOUSE", E: "EXTERNAL" };
await db.doc("treeSnapshots/main").set({
  schemaVersion: 1,
  dataVersion: "x",
  editVersion: 5,
  data: JSON.stringify({
    v: 1,
    persons: tuples,
    relations: [],
    unions: [
      ["g1", "w1", null],
      ["g1", "ex", null], // vợ/chồng loại EXTERNAL: chỉ báo xem lại
      ["g4", "h4", null],
      ["g5", "w5", null],
    ],
    branches: {},
  }),
});
for (const id of Object.keys(tuples))
  await db.doc(`persons/${id}`).set({
    displayName: tuples[id][0],
    category: category[tuples[id][4]],
    ...(gen[id] ? { generation: gen[id] } : {}),
    profileVersion: 2,
    schemaVersion: 1,
    // g3 đã được đánh dấu đã mất từ trước (persons), nhưng ảnh chụp chưa có: hoàn tác phải giữ nguyên trạng thái này.
    ...(id === "g3" ? { deceased: true } : {}),
  });
await db
  .doc("personPrivate/g1")
  .set({ note: "Ghi chú giả cho đời 1", schemaVersion: 1 });

const persons = async () =>
  Object.fromEntries(
    (await db.collection("persons").get()).docs.map((d) => [d.id, d.data()]),
  );
const snapTuples = async () =>
  JSON.parse((await db.doc("treeSnapshots/main").get()).data().data).persons;
const APPLY = ["--apply", "--expect-version", "5", "--expect-count", "5"];

let r = run("person-deceased");
check(
  "chạy thử thành công, in editVersion và số cần đổi",
  r.status === 0 &&
    r.out.includes("editVersion hiện tại: 5") &&
    r.out.includes("cần đổi: 5"),
  r.out,
);
check(
  "chạy thử báo người EXTERNAL cần xem lại, không tự đổi",
  r.out.includes("CẦN XEM LẠI") && r.out.includes("ex"),
  r.out,
);
check(
  "chạy thử gợi ý lệnh ghi đủ expect-version, expect-count, max-generation",
  r.out.includes("--expect-version 5 --expect-count 5 --max-generation 4"),
  r.out,
);
check(
  "chạy thử không in tên",
  !/Giả đời|Vợ đời|Chồng đời|EXTERNAL\b.*Người/.test(r.out),
);
let p = await persons();
check(
  "chạy thử không ghi gì",
  p.g1.deceased === undefined &&
    p.g1.profileVersion === 2 &&
    p.g3.profileVersion === 2,
);

r = run("person-deceased", "--show");
check(
  "--show in tên và năm sinh để rà soát",
  r.out.includes("Giả đời 3") &&
    r.out.includes("Chồng đời 4") &&
    r.out.includes("1800") &&
    !r.out.includes("| Giả đời 5"),
  r.out,
);

r = run(
  "person-deceased",
  "--apply",
  "--expect-version",
  "4",
  "--expect-count",
  "5",
);
check(
  "--apply sai expect-version bị từ chối, không ghi",
  r.status !== 0 && (await persons()).g1.deceased === undefined,
  r.out,
);
r = run("person-deceased", "--apply");
check("--apply thiếu expect-version bị từ chối", r.status !== 0);
r = run("person-deceased", "--apply", "--expect-version", "5");
check(
  "--apply thiếu expect-count bị từ chối",
  r.status !== 0 && r.out.includes("--expect-count"),
  r.out,
);
r = run("person-deceased", ...APPLY, "--max-generation", "14");
check(
  "gõ nhầm --max-generation 14: kế hoạch lệch expect-count nên bị từ chối, không ghi",
  r.status !== 0 && (await persons()).g5.deceased === undefined,
  r.out,
);
r = run(
  "person-deceased",
  "--apply",
  "--expect-version",
  "5",
  "--expect-count",
  "4",
);
check(
  "--expect-count sai bị từ chối, không ghi",
  r.status !== 0 && (await persons()).g1.deceased === undefined,
  r.out,
);

r = run("person-deceased", ...APPLY);
check(
  "--apply đúng thành công",
  r.status === 0 && r.out.includes("ĐÃ ghi 5 người"),
  r.out,
);
p = await persons();
for (const id of ["g1", "w1", "g3", "g4", "h4"])
  check(
    `persons/${id} đã mất, profileVersion +1`,
    p[id].deceased === true &&
      p[id].profileVersion === 3 &&
      p[id].updatedBy === "maintenance-script",
    JSON.stringify(p[id]),
  );
for (const id of ["g5", "w5", "ex"])
  check(
    `persons/${id} không đổi`,
    p[id].deceased === undefined && p[id].profileVersion === 2,
  );
let t = await snapTuples();
check(
  "ảnh chụp: bộ 9 phần tử, đã mất đúng; đời 5 và EXTERNAL không đổi",
  ["g1", "w1", "g3", "g4", "h4"].every(
    (id) => t[id].length === 9 && t[id][8] === true,
  ) &&
    t.g5.length === 8 &&
    t.w5.length === 8 &&
    t.ex.length === 8,
);
const snap = (await db.doc("treeSnapshots/main").get()).data();
check("editVersion giữ nguyên", snap.editVersion === 5);
const audits = (await db.collection("auditLogs").get()).docs.filter((d) =>
  d.id.startsWith("maint-person-deceased-"),
);
const a0 = audits[0]?.data();
check(
  "có đúng 1 nhật ký MARK: số đếm, mã và trạng thái trước, không tên",
  audits.length === 1 &&
    a0.event === "PERSON_DECEASED_BULK" &&
    a0.mode === "MARK" &&
    a0.records.length === 5 &&
    a0.records.find((x) => x.id === "g3").deceased === true &&
    a0.records.find((x) => x.id === "g1").deceased === false &&
    !JSON.stringify(a0).includes("Giả"),
  JSON.stringify(a0),
);
const auditId = audits[0].id;

r = run(
  "person-deceased",
  "--apply",
  "--expect-version",
  "5",
  "--expect-count",
  "0",
);
check(
  "chạy lại: idempotent, không ghi thêm",
  r.status === 0 &&
    r.out.includes("Không có gì cần đổi") &&
    (await persons()).g1.profileVersion === 3,
  r.out,
);

r = run("snapshot-note", "--apply", "--expect-version", "5");
check(
  "snapshot-note vẫn chạy được sau đó và giữ cờ đã mất",
  r.status === 0,
  r.out,
);
t = await snapTuples();
check(
  "sau snapshot-note: bộ 10 phần tử, đã mất giữ nguyên, ghi chú đời 1 được công bố",
  t.g1.length === 10 &&
    t.g1[8] === true &&
    t.g1[9] === "Ghi chú giả cho đời 1" &&
    t.g5[8] === false,
  JSON.stringify(t.g1),
);

// Sửa tay một người sau lần đánh dấu (profileVersion đổi) → hoàn tác phải bỏ qua người đó.
await db.doc("persons/g4").update({ profileVersion: 9 });
r = run("person-deceased", "--undo", auditId);
check(
  "hoàn tác chạy thử: bỏ qua người đã sửa tay, đổi 4 người",
  r.status === 0 && r.out.includes("cần đổi: 4") && r.out.includes("BỎ QUA 1"),
  r.out,
);
r = run(
  "person-deceased",
  "--undo",
  auditId,
  "--apply",
  "--expect-version",
  "5",
  "--expect-count",
  "4",
);
check("hoàn tác ghi thành công", r.status === 0, r.out);
p = await persons();
check(
  "sau hoàn tác: g1,w1,h4 về false (+1 phiên bản); g3 vốn đã mất vẫn true; g4 đã sửa tay giữ nguyên",
  ["g1", "w1", "h4"].every(
    (id) => p[id].deceased === false && p[id].profileVersion === 4,
  ) &&
    p.g3.deceased === true &&
    p.g4.deceased === true &&
    p.g4.profileVersion === 9,
  JSON.stringify([p.g3, p.g4]),
);
t = await snapTuples();
check(
  "sau hoàn tác: ảnh chụp khôi phục (g3 vẫn đã mất, g4 giữ nguyên), ghi chú giữ nguyên",
  t.g1[8] === false &&
    t.g3[8] === true &&
    t.g4[8] === true &&
    t.g1[9] === "Ghi chú giả cho đời 1",
  JSON.stringify([t.g1, t.g3, t.g4]),
);
r = run("person-deceased", "--undo", auditId);
check(
  "hoàn tác lần hai cùng nhật ký bị từ chối",
  r.status !== 0 && r.out.includes("đã được hoàn tác"),
  r.out,
);
r = run(
  "person-deceased",
  "--undo",
  "maint-person-deceased-khong-co",
  "--apply",
  "--expect-version",
  "5",
  "--expect-count",
  "0",
);
check("hoàn tác với nhật ký không tồn tại bị từ chối", r.status !== 0);

r = run("person-deceased", "--max-generation", "0");
check("max-generation sai bị từ chối", r.status !== 0);

console.log(
  failed
    ? `${failed} kiểm tra THẤT BẠI`
    : "Kiểm tra person-deceased trên emulator: ĐẠT",
);
process.exit(failed ? 1 : 0);
