// Xuất file Excel bản nháp từ file trung gian gia phả để quản trị viên rà soát.
// Chạy: node scripts/gia-pha/build-excel.ts [vào.txt] [ra.xlsx]
// Mặc định: private-data/gia-pha.txt -> private-data/gia-pha-ban-nhap.xlsx
// An toàn: từ chối đọc/ghi ngoài thư mục private-data/ (thư mục này bị .gitignore chặn).
import { readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import ExcelJS from "exceljs";
import { normalizeName, parseDsl } from "./dsl.ts";

const root = resolve(import.meta.dirname, "..", "..");
const privateDir = resolve(root, "private-data");
function inside(path: string) {
  const rel = relative(privateDir, path);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
}
const input = resolve(root, process.argv[2] ?? "private-data/gia-pha.txt");
const output = resolve(
  root,
  process.argv[3] ?? "private-data/gia-pha-ban-nhap.xlsx",
);
if (!inside(input) || !inside(output)) {
  console.error(
    "Từ chối: đầu vào và đầu ra phải nằm trong private-data/ (dữ liệu thật không được ra ngoài).",
  );
  process.exit(2);
}

const model = parseDsl(readFileSync(input, "utf8"));
const wb = new ExcelJS.Workbook();
wb.creator = "gia-pha build-excel";

function sheet(
  name: string,
  columns: Array<[string, number]>,
  rows: unknown[][],
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDCEBDD" },
  };
  for (const row of rows) ws.addRow(row);
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  return ws;
}

const instructions = wb.addWorksheet("HUONG_DAN");
instructions.columns = [{ width: 110 }];
[
  "BẢN NHÁP GIA PHẢ — CHỈ ĐỂ QUẢN TRỊ VIÊN RÀ SOÁT. Không đưa file này lên GitHub.",
  "1. Xem sheet ISSUES trước: ERROR phải sửa; WARN cần xác nhận (trùng tên, giới tính suy từ tên, đời lệch).",
  "2. PERSONS: mỗi người một dòng, 'ma' là mã ổn định (external_ref) dùng khi nạp lại; không đổi mã khi sửa tên.",
  "3. 'loai': CLAN = huyết thống dòng họ; SPOUSE = kết hôn vào; EXTERNAL = con của con gái (không thuộc dòng, chỉ ghi cơ bản).",
  "4. 'gioi_tinh_co_so': TEXT = văn bản nêu rõ; NAME = suy từ tên (độ tin cậy thấp).",
  "5. RELATIONS: truyền dòng chỉ khi cha thuộc dòng họ và con thuộc dòng họ (kể cả con gái, con nuôi). Mẹ không truyền dòng.",
  "6. 'loai_quan_he' ADOPTIVE = con nuôi: tính đời theo dòng, hiển thị bằng badge không phân biệt.",
  "7. Đời tính tự động từ thủy tổ theo quan hệ truyền dòng; cột 'doi_van_ban' là đời ghi trong gia phả để đối chiếu.",
  "8. Không tự gộp hai người trùng tên: mỗi người một mã riêng cho tới khi quản trị viên xác nhận.",
].forEach((line) => instructions.addRow([line]));
instructions.getRow(1).font = { bold: true, color: { argb: "FFB00020" } };

const byId = new Map(model.persons.map((p) => [p.id, p]));
sheet(
  "PERSONS",
  [
    ["ma", 16],
    ["ho_ten", 28],
    ["ho_ten_khong_dau", 28],
    ["gioi_tinh", 10],
    ["gioi_tinh_co_so", 14],
    ["doi_van_ban", 11],
    ["doi_tinh_tu_dong", 14],
    ["chi", 8],
    ["sinh", 12],
    ["mat", 12],
    ["ky_nhat_am_lich", 16],
    ["loai", 11],
    ["ghi_chu", 60],
  ],
  model.persons.map((p) => [
    p.id,
    p.name,
    normalizeName(p.name),
    p.sex,
    p.sexBasis,
    p.declaredGeneration ?? "",
    model.derivedGeneration.get(p.id) ?? "",
    p.branch,
    p.birth,
    p.death,
    p.kyNhat,
    p.category,
    p.note,
  ]),
);
sheet(
  "RELATIONS",
  [
    ["ma", 8],
    ["ma_cha_me", 16],
    ["ten_cha_me", 26],
    ["ma_con", 16],
    ["ten_con", 26],
    ["vai_tro", 10],
    ["loai_quan_he", 14],
    ["truyen_dong", 12],
  ],
  model.relations.map((r) => [
    r.id,
    r.parentId,
    byId.get(r.parentId)?.name ?? "",
    r.childId,
    byId.get(r.childId)?.name ?? "",
    r.parentRole,
    r.relationType,
    r.lineageTransmission ? "CO" : "KHONG",
  ]),
);
sheet(
  "UNIONS",
  [
    ["ma", 8],
    ["ma_a", 16],
    ["ten_a", 26],
    ["ma_b", 16],
    ["ten_b", 26],
    ["thu_tu", 8],
    ["tinh_trang", 14],
    ["ghi_chu", 40],
  ],
  model.unions.map((u) => [
    u.id,
    u.partnerA,
    byId.get(u.partnerA)?.name ?? "",
    u.partnerB,
    byId.get(u.partnerB)?.name ?? "",
    u.order,
    u.status,
    u.note,
  ]),
);
sheet(
  "BRANCHES",
  [
    ["ma_chi", 10],
    ["ten_chi", 24],
    ["nguoi_khai_chi", 18],
    ["hop_nhat_tu", 30],
    ["ghi_chu", 50],
  ],
  model.branches.map((b) => [
    b.code,
    b.name,
    b.founderId,
    b.mergedFrom,
    b.note,
  ]),
);
const order = { ERROR: 0, WARN: 1 } as const;
sheet(
  "ISSUES",
  [
    ["muc_do", 10],
    ["ma_loi", 18],
    ["doi_tuong", 30],
    ["noi_dung", 90],
  ],
  [...model.issues]
    .sort(
      (a, b) =>
        order[a.severity] - order[b.severity] || a.code.localeCompare(b.code),
    )
    .map((i) => [i.severity, i.code, i.ref, i.message]),
);

await wb.xlsx.writeFile(output);
const errors = model.issues.filter((i) => i.severity === "ERROR").length;
const warns = model.issues.length - errors;
console.log(
  `Đã ghi ${relative(root, output)}: ${model.persons.length} người, ${model.relations.length} quan hệ, ${model.unions.length} hôn nhân, ${errors} ERROR, ${warns} WARN.`,
);
process.exit(errors ? 1 : 0);
