// Thống kê trang Tổng quan: hàm thuần trên ảnh chụp cây (treeSnapshots/main), không phụ thuộc React/Firebase.
// Mọi con số tuổi tính theo NĂM DƯƠNG: tuổi = (năm mất ?? năm hiện tại) − năm sinh; không biết ngày sinh nên
// chỉ là xấp xỉ (có thể lệch 1 tuổi), giao diện phải ghi rõ điều này.
import type { Category, SnapBranch, SnapPerson, Snapshot } from "./treeModel";

/** Người đang sống chỉ được suy ra khi tuổi không quá ngưỡng này; quá ngưỡng mà không có năm mất = chưa rõ. */
export const LIVING_MAX_AGE = 100;
/** Người đã mất thọ hơn mức này coi là nhập sai năm, đưa vào "dữ liệu năm cần kiểm tra". */
export const MAX_LIFESPAN = 120;
/** Số người hiện ban đầu mỗi nhóm "thiếu thông tin" (UI bấm "Xem thêm" để mở tiếp). */
export const MISSING_PAGE_SIZE = 50;

/** Năm dương hiện tại theo giờ Việt Nam (Asia/Ho_Chi_Minh), để 31/12 17:00 UTC đã là năm mới ở Việt Nam. */
export function vnYear(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "year")?.value);
}

export type LifeStatus = "living" | "deceased" | "unknown" | "invalid";
export interface LifeInfo {
  status: LifeStatus;
  /** Tuổi theo năm dương; null khi không tính được hoặc dữ liệu năm không hợp lệ. */
  age: number | null;
}

/**
 * Phân loại sống/mất và tuổi.
 * - invalid: cờ BIRTH_CONFLICT, năm sinh/mất sau năm hiện tại, năm mất trước năm sinh, thọ quá MAX_LIFESPAN (loại khỏi thống kê tuổi).
 * - deceased: có năm mất hoặc được đánh dấu "đã mất" (tuổi null nếu thiếu năm mất hoặc năm sinh).
 * - living: không năm mất, có năm sinh, 0 ≤ tuổi ≤ livingMaxAge.
 * - unknown: còn lại (không có năm sinh, hoặc quá ngưỡng mà không có năm mất).
 */
export function lifeStatus(
  p: Pick<SnapPerson, "birthYear" | "deathYear" | "flags" | "deceased">,
  currentYear: number,
  livingMaxAge: number = LIVING_MAX_AGE,
): LifeInfo {
  const { birthYear: b, deathYear: d } = p;
  if (
    p.flags.includes("BIRTH_CONFLICT") ||
    (b !== null && b > currentYear) ||
    (d !== null && d > currentYear) ||
    (b !== null && d !== null && (d < b || d - b > MAX_LIFESPAN))
  )
    return { status: "invalid", age: null };
  if (d !== null) return { status: "deceased", age: b === null ? null : d - b };
  if (p.deceased === true) return { status: "deceased", age: null };
  if (b === null) return { status: "unknown", age: null };
  const age = currentYear - b;
  return age <= livingMaxAge
    ? { status: "living", age }
    : { status: "unknown", age: null };
}

export type MissingField =
  "name" | "sex" | "birthYear" | "generation" | "branch";
export const MISSING_FIELD_LABELS: Record<MissingField, string> = {
  name: "Họ tên",
  sex: "Giới tính",
  birthYear: "Năm sinh",
  generation: "Đời",
  branch: "Chi",
};
const MISSING_ORDER: MissingField[] = [
  "name",
  "sex",
  "birthYear",
  "generation",
  "branch",
];

/**
 * Đời nhỏ nhất trong số những người khai làm "người khai chi" (founderId); thủy tổ và các đời trên đó
 * không thuộc chi nào nên không bị báo thiếu chi. null = chưa có người khai chi hợp lệ.
 */
function founderMinGeneration(snap: Pick<Snapshot, "branches" | "persons">) {
  let min: number | null = null;
  for (const b of snap.branches) {
    const g = b.founderId ? snap.persons.get(b.founderId)?.generation : null;
    if (typeof g === "number" && (min === null || g < min)) min = g;
  }
  return min;
}

/**
 * Các trường bắt buộc còn thiếu của một người. CLAN xét 5 trường; SPOUSE/EXTERNAL chỉ tên, giới tính, năm sinh.
 * Không tính năm mất, ghi chú. sex undefined (ảnh chụp chưa đồng bộ giới tính) không bị coi là thiếu.
 * Người bị cờ BIRTH_CONFLICT không báo "thiếu năm sinh" (đã có nhóm "năm sinh mâu thuẫn" riêng).
 */
export function missingFields(
  p: SnapPerson,
  founderMinGen: number | null,
): MissingField[] {
  const out: MissingField[] = [];
  if (!p.name.trim() || p.flags.includes("NAME_UNKNOWN")) out.push("name");
  if (p.sex === null) out.push("sex");
  if (p.birthYear === null && !p.flags.includes("BIRTH_CONFLICT"))
    out.push("birthYear");
  if (p.category === "CLAN") {
    if (p.generation === null) out.push("generation");
    const aboveBranches =
      founderMinGen !== null &&
      p.generation !== null &&
      p.generation < founderMinGen;
    if (p.branch === null && !aboveBranches) out.push("branch");
  }
  return out;
}

export interface PersonRef {
  id: string;
  name: string;
  generation: number | null;
  birthYear: number | null;
  deathYear: number | null;
}
function ref(p: SnapPerson): PersonRef {
  return {
    id: p.id,
    name: p.name,
    generation: p.generation,
    birthYear: p.birthYear,
    deathYear: p.deathYear,
  };
}
/** Đời tăng dần (chưa rõ đời xếp cuối), rồi họ tên theo thứ tự tiếng Việt, rồi mã để ổn định. */
export function comparePeople(a: PersonRef, b: PersonRef): number {
  const ga = a.generation ?? Number.POSITIVE_INFINITY;
  const gb = b.generation ?? Number.POSITIVE_INFINITY;
  if (ga !== gb) return ga < gb ? -1 : 1;
  return a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id);
}

export interface AgeExtreme {
  age: number;
  people: PersonRef[];
}
export interface BranchRow {
  key: string;
  label: string;
  kind: "branch" | "unassigned" | "unknown-code" | "outside";
  count: number;
}
export interface GenerationRow {
  generation: number | null;
  count: number;
}
export interface AgeBand {
  label: string;
  from: number;
  to: number;
  male: number;
  female: number;
  /** Giới tính chưa rõ (null) hoặc chưa đồng bộ (undefined). */
  other: number;
  total: number;
}
export interface MissingGroup {
  field: MissingField | "birthConflict";
  label: string;
  people: PersonRef[];
}
export interface OverviewStats {
  currentYear: number;
  livingMaxAge: number;
  totals: { all: number; clan: number; spouse: number; external: number };
  sex: {
    male: number;
    female: number;
    unknown: number;
    /** Chưa có dữ liệu giới tính trong ảnh chụp (sex undefined). */
    unsynced: number;
    /** Toàn bộ ảnh chụp chưa đồng bộ giới tính (và có ít nhất một người). */
    allUnsynced: boolean;
  };
  ages: {
    living: number;
    deceased: number;
    /** Chưa đủ dữ liệu để tính tuổi (chưa có năm sinh, hoặc quá ngưỡng mà không có năm mất); bốn nhóm living/deceased/unknown/invalid loại trừ nhau và cộng bằng tổng. */
    unknown: number;
    /** Một phần của `deceased`: đã mất nhưng chưa có năm sinh (không tính được tuổi). */
    deceasedNoBirth: number;
    /** Một phần của `deceased`: được đánh dấu "đã mất" nhưng chưa có năm mất (không tính được tuổi). */
    deceasedNoDeathYear: number;
    /** Dữ liệu năm cần kiểm tra (BIRTH_CONFLICT, năm sinh/mất không hợp lệ). */
    invalid: number;
    /** Người còn trong thống kê tuổi, nghĩa là có tuổi tính được. */
    counted: number;
    oldest: AgeExtreme | null;
    oldestLiving: AgeExtreme | null;
    youngestLiving: AgeExtreme | null;
    averageLiving: number | null;
    averageLivingN: number;
  };
  byBranch: BranchRow[];
  /** Chỉ người thuộc dòng họ (CLAN); vợ/chồng và họ ngoại thường không có đời. */
  byGeneration: GenerationRow[];
  livingAgeBands: AgeBand[];
  missing: {
    groups: MissingGroup[];
    /** Số người khác nhau thiếu ít nhất một trường bắt buộc (không tính năm sinh mâu thuẫn). */
    people: number;
    /** Người bị cờ BIRTH_CONFLICT, tách riêng khỏi "thiếu". */
    conflicts: PersonRef[];
  };
}

function extreme(
  rows: Array<{ ref: PersonRef; age: number }>,
  pick: "max" | "min",
): AgeExtreme | null {
  if (!rows.length) return null;
  const best = rows.reduce(
    (m, r) => (pick === "max" ? Math.max(m, r.age) : Math.min(m, r.age)),
    rows[0].age,
  );
  return {
    age: best,
    people: rows
      .filter((r) => r.age === best)
      .map((r) => r.ref)
      .sort(comparePeople),
  };
}

function branchRows(
  persons: SnapPerson[],
  branches: SnapBranch[],
): BranchRow[] {
  const counts = new Map<string, number>();
  let unassigned = 0;
  let outside = 0;
  for (const p of persons) {
    if (p.category !== "CLAN") outside++;
    else if (p.branch === null) unassigned++;
    else counts.set(p.branch, (counts.get(p.branch) ?? 0) + 1);
  }
  const rows: BranchRow[] = branches.map((b) => ({
    key: b.code,
    label: b.name || b.code,
    kind: "branch",
    count: counts.get(b.code) ?? 0,
  }));
  const known = new Set(branches.map((b) => b.code));
  for (const [code, count] of counts)
    if (!known.has(code))
      rows.push({
        key: code,
        label: `Mã chi không có trong danh sách: ${code}`,
        kind: "unknown-code",
        count,
      });
  rows.push({
    key: "-",
    label: "Chưa xếp chi",
    kind: "unassigned",
    count: unassigned,
  });
  rows.push({
    key: "~",
    label: "Vợ/chồng và họ ngoại",
    kind: "outside",
    count: outside,
  });
  return rows;
}

export function computeOverviewStats(
  snap: Pick<Snapshot, "persons" | "branches">,
  opts: { currentYear: number; livingMaxAge?: number },
): OverviewStats {
  const { currentYear } = opts;
  const livingMaxAge = opts.livingMaxAge ?? LIVING_MAX_AGE;
  const persons = [...snap.persons.values()];
  const byCategory = (c: Category) =>
    persons.filter((p) => p.category === c).length;

  const sex = {
    male: 0,
    female: 0,
    unknown: 0,
    unsynced: 0,
    allUnsynced: false,
  };
  for (const p of persons) {
    if (p.sex === undefined) sex.unsynced++;
    else if (p.sex === "M") sex.male++;
    else if (p.sex === "F") sex.female++;
    else sex.unknown++;
  }
  sex.allUnsynced = persons.length > 0 && sex.unsynced === persons.length;

  // Thống kê tuổi.
  let living = 0,
    deceased = 0,
    unknown = 0,
    invalid = 0,
    deceasedNoBirth = 0,
    deceasedNoDeathYear = 0;
  const aged: Array<{ ref: PersonRef; age: number }> = [];
  const livingAged: Array<{ ref: PersonRef; age: number }> = [];
  const bands: AgeBand[] = [];
  // Nhóm 10 tuổi; nhóm cuối gom cả mốc ngưỡng (0–9, …, 80–89, 90–100) để 100 tuổi không thành nhóm riêng.
  for (let from = 0; from <= livingMaxAge; from += 10) {
    const last = livingMaxAge - from <= 10;
    const to = last ? livingMaxAge : from + 9;
    bands.push({
      label: from === to ? `${from}` : `${from}–${to}`,
      from,
      to,
      male: 0,
      female: 0,
      other: 0,
      total: 0,
    });
    if (last) break;
  }
  for (const p of persons) {
    const info = lifeStatus(p, currentYear, livingMaxAge);
    if (info.status === "invalid") invalid++;
    else if (info.status === "unknown") unknown++;
    else if (info.status === "deceased") deceased++;
    else living++;
    // Đã mất nhưng thiếu năm sinh hoặc năm mất: vẫn là "đã mất" (không đếm lại ở nhóm khác), chỉ không có tuổi.
    if (info.status === "deceased") {
      if (p.birthYear === null) deceasedNoBirth++;
      if (p.deathYear === null) deceasedNoDeathYear++;
    }
    if (info.age === null) continue;
    const row = { ref: ref(p), age: info.age };
    aged.push(row);
    if (info.status === "living") {
      livingAged.push(row);
      const band = bands[Math.min(Math.floor(info.age / 10), bands.length - 1)];
      band.total++;
      if (p.sex === "M") band.male++;
      else if (p.sex === "F") band.female++;
      else band.other++;
    }
  }
  const sum = livingAged.reduce((s, r) => s + r.age, 0);

  // Thiếu thông tin bắt buộc.
  const founderMin = founderMinGeneration(snap);
  const lists = new Map<MissingField, PersonRef[]>(
    MISSING_ORDER.map((f) => [f, []]),
  );
  const conflicts: PersonRef[] = [];
  let missingPeople = 0;
  for (const p of persons) {
    const fields = missingFields(p, founderMin);
    if (fields.length) missingPeople++;
    for (const f of fields) lists.get(f)!.push(ref(p));
    if (p.flags.includes("BIRTH_CONFLICT")) conflicts.push(ref(p));
  }
  const groups: MissingGroup[] = MISSING_ORDER.map((f) => ({
    field: f,
    label: MISSING_FIELD_LABELS[f],
    people: lists.get(f)!.sort(comparePeople),
  }));
  conflicts.sort(comparePeople);

  // Theo đời (chỉ CLAN).
  const gens = new Map<number | null, number>();
  for (const p of persons)
    if (p.category === "CLAN")
      gens.set(p.generation, (gens.get(p.generation) ?? 0) + 1);
  const byGeneration: GenerationRow[] = [...gens]
    .map(([generation, count]) => ({ generation, count }))
    .sort(
      (a, b) =>
        (a.generation ?? Number.POSITIVE_INFINITY) -
          (b.generation ?? Number.POSITIVE_INFINITY) || 0,
    );

  return {
    currentYear,
    livingMaxAge,
    totals: {
      all: persons.length,
      clan: byCategory("CLAN"),
      spouse: byCategory("SPOUSE"),
      external: byCategory("EXTERNAL"),
    },
    sex,
    ages: {
      living,
      deceased,
      unknown,
      invalid,
      deceasedNoBirth,
      deceasedNoDeathYear,
      counted: aged.length,
      oldest: extreme(aged, "max"),
      oldestLiving: extreme(livingAged, "max"),
      youngestLiving: extreme(livingAged, "min"),
      averageLiving: livingAged.length ? sum / livingAged.length : null,
      averageLivingN: livingAged.length,
    },
    byBranch: branchRows(persons, snap.branches),
    byGeneration,
    livingAgeBands: bands,
    missing: { groups, people: missingPeople, conflicts },
  };
}
