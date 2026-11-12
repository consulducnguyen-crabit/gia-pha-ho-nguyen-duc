// Logic thuần cho cây gia phả: đọc ảnh chụp cây (treeSnapshots/main) và dựng chỉ mục.
// Không phụ thuộc React hay Firebase để dễ kiểm thử.
import { normalizeName } from "./domain";

export type Category = "CLAN" | "SPOUSE" | "EXTERNAL";
export type FlagCode =
  "BIRTH_CONFLICT" | "UNCONNECTED" | "DUP_NAME" | "NAME_UNKNOWN" | "VERIFY";
// Phải khớp scripts/gia-pha/flags.ts (có test đối chiếu).
export const FLAG_ORDER: FlagCode[] = [
  "UNCONNECTED",
  "VERIFY",
  "BIRTH_CONFLICT",
  "DUP_NAME",
  "NAME_UNKNOWN",
];
export const FLAG_LABELS: Record<FlagCode, string> = {
  BIRTH_CONFLICT: "Năm sinh/mất trong tài liệu gốc mâu thuẫn",
  UNCONNECTED: "Chưa xác định vị trí trong cây",
  DUP_NAME: "Trùng họ tên cùng đời với người khác, cần phân biệt",
  NAME_UNKNOWN: "Chưa rõ tên",
  VERIFY: "Tài liệu gốc chưa rõ, cần xác minh",
};
export interface SnapPerson {
  id: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  generation: number | null;
  category: Category;
  branch: string | null;
  flags: FlagCode[];
  normalized: string;
}
export interface SnapRelation {
  parentId: string;
  childId: string;
  role: "FATHER" | "MOTHER";
  adoptive: boolean;
  lineage: boolean;
}
export interface SnapUnion {
  a: string;
  b: string;
  order: string | null;
}
export interface SnapBranch {
  code: string;
  name: string;
  founderId: string | null;
  mergedFrom: string | null;
  note: string | null;
}
export interface Snapshot {
  dataVersion: string;
  /** Phiên bản sửa trong app (thiếu = 0); dùng làm khóa chống ghi đè. */
  editVersion: number;
  persons: Map<string, SnapPerson>;
  relations: SnapRelation[];
  unions: SnapUnion[];
  branches: SnapBranch[];
}

const CATEGORY: Record<string, Category> = {
  C: "CLAN",
  S: "SPOUSE",
  E: "EXTERNAL",
};

function fail(): never {
  throw new Error("Ảnh chụp cây không hợp lệ.");
}
function str(value: unknown): string {
  return typeof value === "string" ? value : fail();
}
function numOrNull(value: unknown): number | null {
  return value === null ? null : typeof value === "number" ? value : fail();
}

export function parseSnapshot(doc: unknown): Snapshot {
  if (!doc || typeof doc !== "object") return fail();
  const raw = doc as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || typeof raw.data !== "string") return fail();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.data);
  } catch {
    return fail();
  }
  if (data.v !== 1 || !data.persons || typeof data.persons !== "object")
    return fail();
  const persons = new Map<string, SnapPerson>();
  for (const [id, value] of Object.entries(
    data.persons as Record<string, unknown>,
  )) {
    // Bản cũ có 6 phần tử (chưa có cờ); bản mới có 7.
    if (!Array.isArray(value) || (value.length !== 6 && value.length !== 7))
      return fail();
    const [name, birth, death, generation, category, branch, rawFlags] = value;
    const flags: FlagCode[] = [];
    if (rawFlags !== undefined) {
      if (!Array.isArray(rawFlags)) return fail();
      for (const f of rawFlags) {
        if (!(FLAG_ORDER as string[]).includes(f as string)) return fail();
        flags.push(f as FlagCode);
      }
    }
    const cat = CATEGORY[str(category)];
    if (!cat) return fail();
    persons.set(id, {
      id,
      name: str(name),
      birthYear: numOrNull(birth),
      deathYear: numOrNull(death),
      generation: numOrNull(generation),
      category: cat,
      branch: branch === null ? null : str(branch),
      flags,
      normalized: normalizeName(str(name)),
    });
  }
  const relations: SnapRelation[] = [];
  for (const row of Array.isArray(data.relations) ? data.relations : fail()) {
    if (!Array.isArray(row) || row.length !== 5) return fail();
    const parentId = str(row[0]),
      childId = str(row[1]);
    if (!persons.has(parentId) || !persons.has(childId)) return fail();
    relations.push({
      parentId,
      childId,
      role: row[2] === "F" ? "FATHER" : row[2] === "M" ? "MOTHER" : fail(),
      adoptive: row[3] === "A" ? true : row[3] === "B" ? false : fail(),
      lineage: row[4] === 1,
    });
  }
  const unions: SnapUnion[] = [];
  for (const row of Array.isArray(data.unions) ? data.unions : fail()) {
    if (!Array.isArray(row) || row.length !== 3) return fail();
    const a = str(row[0]),
      b = str(row[1]);
    if (!persons.has(a) || !persons.has(b)) return fail();
    unions.push({ a, b, order: row[2] === null ? null : str(row[2]) });
  }
  const branches: SnapBranch[] = [];
  for (const [code, value] of Object.entries(
    (data.branches ?? {}) as Record<string, unknown>,
  )) {
    if (!Array.isArray(value) || value.length !== 4) return fail();
    branches.push({
      code,
      name: str(value[0]),
      founderId: value[1] === null ? null : str(value[1]),
      mergedFrom: value[2] === null ? null : str(value[2]),
      note: value[3] === null ? null : str(value[3]),
    });
  }
  return {
    dataVersion: typeof raw.dataVersion === "string" ? raw.dataVersion : "",
    editVersion:
      typeof raw.editVersion === "number" && Number.isInteger(raw.editVersion)
        ? raw.editVersion
        : 0,
    persons,
    relations,
    unions,
    branches,
  };
}

export interface TreeIndex {
  snapshot: Snapshot;
  root: string | null;
  /** Con theo dòng (truyền dòng), theo thứ tự trong gia phả. */
  lineageChildren(id: string): string[];
  /** Mọi con (cả con của con gái), theo thứ tự trong gia phả. */
  children(id: string): string[];
  /** Cha/mẹ của một người, kèm loại quan hệ. */
  parents(id: string): Array<{
    id: string;
    role: SnapRelation["role"];
    adoptive: boolean;
    lineage: boolean;
  }>;
  spouses(id: string): string[];
  siblings(id: string): string[];
  /** Chuỗi tổ tiên theo dòng từ thủy tổ xuống tới người đó (gồm cả người đó). */
  lineagePath(id: string): string[];
  isAdoptedChild(id: string): boolean;
  descendantCount(id: string): number;
  search(text: string): SnapPerson[];
}

export function buildIndex(snapshot: Snapshot): TreeIndex {
  const childEdges = new Map<string, SnapRelation[]>();
  const parentEdges = new Map<string, SnapRelation[]>();
  for (const r of snapshot.relations) {
    childEdges.set(r.parentId, [...(childEdges.get(r.parentId) ?? []), r]);
    parentEdges.set(r.childId, [...(parentEdges.get(r.childId) ?? []), r]);
  }
  const spouseMap = new Map<string, string[]>();
  const add = (a: string, b: string) =>
    spouseMap.set(a, [...(spouseMap.get(a) ?? []), b]);
  for (const u of snapshot.unions) {
    add(u.a, u.b);
    add(u.b, u.a);
  }
  const lineageChildren = (id: string) =>
    (childEdges.get(id) ?? []).filter((r) => r.lineage).map((r) => r.childId);
  const children = (id: string) => {
    const seen = new Set<string>();
    return (childEdges.get(id) ?? [])
      .map((r) => r.childId)
      .filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  };
  const lineageParent = (id: string) =>
    (parentEdges.get(id) ?? []).find((r) => r.lineage)?.parentId ?? null;
  const roots = [...snapshot.persons.values()].filter(
    (p) =>
      p.category === "CLAN" &&
      lineageParent(p.id) === null &&
      lineageChildren(p.id).length > 0,
  );
  const root = roots.length === 1 ? roots[0].id : null;
  const counts = new Map<string, number>();
  function count(id: string, visiting = new Set<string>()): number {
    const known = counts.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let total = 0;
    for (const child of lineageChildren(id))
      total += 1 + count(child, visiting);
    visiting.delete(id);
    counts.set(id, total);
    return total;
  }
  return {
    snapshot,
    root,
    lineageChildren,
    children,
    parents: (id) =>
      (parentEdges.get(id) ?? []).map((r) => ({
        id: r.parentId,
        role: r.role,
        adoptive: r.adoptive,
        lineage: r.lineage,
      })),
    spouses: (id) => spouseMap.get(id) ?? [],
    siblings: (id) => {
      const fatherId = (parentEdges.get(id) ?? []).find(
        (r) => r.role === "FATHER",
      )?.parentId;
      if (!fatherId) return [];
      return children(fatherId).filter((c) => c !== id);
    },
    lineagePath: (id) => {
      const path: string[] = [];
      const seen = new Set<string>();
      let current: string | null = id;
      while (current && !seen.has(current)) {
        seen.add(current);
        path.push(current);
        current = lineageParent(current);
      }
      return path.reverse();
    },
    isAdoptedChild: (id) =>
      (parentEdges.get(id) ?? []).some((r) => r.adoptive && r.lineage),
    descendantCount: (id) => count(id),
    search: (text) => {
      const q = normalizeName(text);
      if (!q) return [];
      return [...snapshot.persons.values()]
        .filter((p) => p.normalized.includes(q))
        .slice(0, 50);
    },
  };
}

export function yearsLabel(p: Pick<SnapPerson, "birthYear" | "deathYear">) {
  if (p.birthYear && p.deathYear) return `${p.birthYear}–${p.deathYear}`;
  if (p.birthYear) return `s. ${p.birthYear}`;
  if (p.deathYear) return `m. ${p.deathYear}`;
  return "";
}

export function categoryLabel(c: Category) {
  return c === "CLAN"
    ? "Thuộc dòng họ"
    : c === "SPOUSE"
      ? "Kết hôn vào"
      : "Họ ngoại";
}
