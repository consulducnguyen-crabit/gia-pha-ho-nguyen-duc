import { describe, expect, it } from "vitest";
import {
  comparePeople,
  computeOverviewStats,
  lifeStatus,
  missingFields,
  vnYear,
} from "../src/overviewStats";
import type {
  Category,
  FlagCode,
  SnapBranch,
  SnapPerson,
} from "../src/treeModel";

// Dữ liệu hoàn toàn giả.
function p(id: string, over: Partial<SnapPerson> = {}): SnapPerson {
  return {
    id,
    name: `Người ${id}`,
    birthYear: 1980,
    deathYear: null,
    generation: 3,
    category: "CLAN" as Category,
    branch: "I",
    flags: [] as FlagCode[],
    sex: "M",
    normalized: id,
    ...over,
  };
}
const branch = (code: string, founderId: string | null): SnapBranch => ({
  code,
  name: `Chi ${code}`,
  founderId,
  mergedFrom: null,
  note: null,
});
function snap(people: SnapPerson[], branches: SnapBranch[] = []) {
  return {
    persons: new Map(people.map((x) => [x.id, x])),
    branches,
  };
}
const Y = 2026;
const stats = (people: SnapPerson[], branches: SnapBranch[] = []) =>
  computeOverviewStats(snap(people, branches), { currentYear: Y });

describe("vnYear", () => {
  it("31/12 17:00 UTC đã là năm mới ở Việt Nam, 16:59 thì chưa", () => {
    expect(vnYear(new Date("2026-12-31T16:59:59Z"))).toBe(2026);
    expect(vnYear(new Date("2026-12-31T17:00:00Z"))).toBe(2027);
    expect(vnYear(new Date("2027-01-01T00:00:00Z"))).toBe(2027);
  });
});

describe("lifeStatus", () => {
  const base = { flags: [] as FlagCode[] };
  it("đúng 100 tuổi vẫn đang sống, 101 tuổi thì chưa rõ", () => {
    expect(
      lifeStatus({ ...base, birthYear: Y - 100, deathYear: null }, Y),
    ).toEqual({ status: "living", age: 100 });
    expect(
      lifeStatus({ ...base, birthYear: Y - 101, deathYear: null }, Y),
    ).toEqual({ status: "unknown", age: null });
  });
  it("đã mất thọ quá 120 tuổi bị coi là dữ liệu năm cần kiểm tra, đúng 120 thì hợp lệ", () => {
    expect(
      lifeStatus({ ...base, birthYear: 1800, deathYear: 1921 }, Y).status,
    ).toBe("invalid");
    expect(
      lifeStatus({ ...base, birthYear: 1800, deathYear: 1920 }, Y),
    ).toEqual({ status: "deceased", age: 120 });
  });
  it("tuổi 0 (sinh năm nay) tính là đang sống", () => {
    expect(lifeStatus({ ...base, birthYear: Y, deathYear: null }, Y).age).toBe(
      0,
    );
  });
  it("thiếu năm sinh: chưa rõ; đã mất không có năm sinh: không có tuổi", () => {
    expect(
      lifeStatus({ ...base, birthYear: null, deathYear: null }, Y),
    ).toEqual({ status: "unknown", age: null });
    expect(
      lifeStatus({ ...base, birthYear: null, deathYear: 1990 }, Y),
    ).toEqual({ status: "deceased", age: null });
  });
  it("đã mất: tuổi = năm mất − năm sinh, kể cả quá 100", () => {
    expect(
      lifeStatus({ ...base, birthYear: 1850, deathYear: 1960 }, Y),
    ).toEqual({ status: "deceased", age: 110 });
  });
  it("năm không hợp lệ bị loại: sinh sau năm hiện tại, mất trước sinh, BIRTH_CONFLICT", () => {
    for (const x of [
      { ...base, birthYear: Y + 1, deathYear: null },
      { ...base, birthYear: 1950, deathYear: 1940 },
      { ...base, birthYear: 1950, deathYear: Y + 3 },
      {
        flags: ["BIRTH_CONFLICT" as FlagCode],
        birthYear: 1950,
        deathYear: null,
      },
    ])
      expect(lifeStatus(x, Y)).toEqual({ status: "invalid", age: null });
  });
});

describe("computeOverviewStats", () => {
  it("ảnh chụp rỗng: không NaN, không null lạ", () => {
    const s = stats([]);
    expect(s.totals).toEqual({ all: 0, clan: 0, spouse: 0, external: 0 });
    expect(s.ages.averageLiving).toBeNull();
    expect(s.ages.oldest).toBeNull();
    expect(s.sex.allUnsynced).toBe(false);
    expect(s.byGeneration).toEqual([]);
    expect(s.livingAgeBands.every((b) => b.total === 0)).toBe(true);
    expect(JSON.stringify(s)).not.toContain("NaN");
  });

  it("đếm theo loại và giới tính; sex undefined khác null", () => {
    const s = stats([
      p("a"),
      p("b", { sex: "F" }),
      p("c", { sex: null }),
      p("d", { category: "SPOUSE", sex: "F" }),
      p("e", { category: "EXTERNAL", sex: "M" }),
    ]);
    expect(s.totals).toEqual({ all: 5, clan: 3, spouse: 1, external: 1 });
    expect(s.sex).toMatchObject({
      male: 2,
      female: 2,
      unknown: 1,
      unsynced: 0,
    });
  });
  it("toàn bộ sex undefined: allUnsynced, không bị coi là thiếu giới tính", () => {
    const people = [p("a", { sex: undefined }), p("b", { sex: undefined })];
    const s = stats(people, [branch("I", "a")]);
    expect(s.sex.allUnsynced).toBe(true);
    expect(s.sex.unsynced).toBe(2);
    expect(s.missing.groups.find((g) => g.field === "sex")!.people).toEqual([]);
    // Còn null thì vẫn là thiếu.
    const t = stats([p("a", { sex: undefined }), p("b", { sex: null })]);
    expect(t.sex.allUnsynced).toBe(false);
    expect(
      t.missing.groups.find((g) => g.field === "sex")!.people,
    ).toHaveLength(1);
  });

  it("tuổi: cực trị gồm tất cả người bằng nhau, tách đang sống/đã mất", () => {
    const s = stats([
      p("a", { birthYear: 1900, deathYear: 1990 }), // 90, mất
      p("b", { birthYear: 1930, deathYear: 2020 }), // 90, mất
      p("c", { birthYear: 1940 }), // 86, sống
      p("d", { birthYear: 1940 }), // 86, sống
      p("e", { birthYear: 2020 }), // 6
      p("f", { birthYear: 2020 }), // 6
      p("g", { birthYear: null }), // chưa rõ
      p("h", { birthYear: 1900 }), // 126 không năm mất: chưa rõ
      p("i", { birthYear: 2030 }), // sau năm hiện tại
      p("j", { flags: ["BIRTH_CONFLICT"], birthYear: 1960 }),
    ]);
    expect(s.ages.oldest!.age).toBe(90);
    expect(s.ages.oldest!.people.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.ages.oldestLiving!.age).toBe(86);
    expect(s.ages.oldestLiving!.people.map((x) => x.id)).toEqual(["c", "d"]);
    expect(s.ages.youngestLiving!.people.map((x) => x.id)).toEqual(["e", "f"]);
    expect(s.ages).toMatchObject({
      living: 4,
      deceased: 2,
      unknown: 2,
      invalid: 2,
      counted: 6,
      averageLivingN: 4,
    });
    expect(s.ages.averageLiving).toBeCloseTo((86 + 86 + 6 + 6) / 4);
  });
  it("bốn nhóm loại trừ nhau và cộng bằng tổng; đã mất không năm sinh chỉ đếm ở đã mất", () => {
    const s = stats([
      p("a", { birthYear: 1950 }), // sống
      p("b", { birthYear: null, deathYear: 1990 }), // đã mất, không năm sinh
      p("c", { birthYear: 1900, deathYear: 1980 }), // đã mất
      p("d", { birthYear: null }), // chưa rõ
      p("e", { flags: ["BIRTH_CONFLICT"] }), // cần kiểm tra
      p("f", { birthYear: 1700, deathYear: 1900 }), // thọ 200: cần kiểm tra
    ]);
    expect(s.ages).toMatchObject({
      living: 1,
      deceased: 2,
      deceasedNoBirth: 1,
      unknown: 1,
      invalid: 2,
      counted: 2,
    });
    const a = s.ages;
    expect(a.living + a.deceased + a.unknown + a.invalid).toBe(s.totals.all);
    expect(s.ages.oldest!.people.map((x) => x.id)).toEqual(["c"]);
  });
  it("tháp tuổi: ranh giới nhóm và 100 tuổi vào nhóm cuối", () => {
    const s = stats([
      p("a", { birthYear: Y - 9 }),
      p("b", { birthYear: Y - 10, sex: "F" }),
      p("c", { birthYear: Y - 100, sex: null }),
      p("d", { birthYear: Y - 89 }),
    ]);
    const bands = s.livingAgeBands;
    expect(bands[0]).toMatchObject({ label: "0–9", male: 1, total: 1 });
    expect(bands[1]).toMatchObject({ label: "10–19", female: 1, total: 1 });
    expect(bands[8]).toMatchObject({ label: "80–89", male: 1 });
    expect(bands[bands.length - 1]).toMatchObject({
      label: "90–100",
      other: 1,
      total: 1,
    });
    expect(bands).toHaveLength(10);
  });

  it("theo chi: chi trong danh sách, chưa xếp chi, mã chi lạ, vợ/chồng+họ ngoại một dòng", () => {
    const s = stats(
      [
        p("a", { branch: "I" }),
        p("b", { branch: "I" }),
        p("c", { branch: null }),
        p("d", { branch: "Z" }),
        p("e", { category: "SPOUSE", branch: "I" }),
        p("f", { category: "EXTERNAL", branch: null }),
      ],
      [branch("I", "a"), branch("II", null)],
    );
    const by = Object.fromEntries(s.byBranch.map((r) => [r.key, r]));
    expect(by.I).toMatchObject({ label: "Chi I", count: 2, kind: "branch" });
    expect(by.II.count).toBe(0);
    expect(by["-"]).toMatchObject({ kind: "unassigned", count: 1 });
    expect(by.Z).toMatchObject({ kind: "unknown-code", count: 1 });
    expect(by["~"]).toMatchObject({ kind: "outside", count: 2 });
    expect(s.byBranch.reduce((n, r) => n + r.count, 0)).toBe(6);
  });
  it("theo đời: chỉ CLAN, đời chưa rõ xếp cuối", () => {
    const s = stats([
      p("a", { generation: 2 }),
      p("b", { generation: 1 }),
      p("c", { generation: 2 }),
      p("d", { generation: null }),
      p("e", { category: "SPOUSE", generation: 2 }),
    ]);
    expect(s.byGeneration).toEqual([
      { generation: 1, count: 1 },
      { generation: 2, count: 2 },
      { generation: null, count: 1 },
    ]);
  });
});

describe("missingFields", () => {
  it("CLAN xét 5 trường, vợ/chồng và họ ngoại chỉ 3 trường", () => {
    const empty = {
      name: "",
      sex: null,
      birthYear: null,
      generation: null,
      branch: null,
    } as const;
    expect(missingFields(p("a", empty), null)).toEqual([
      "name",
      "sex",
      "birthYear",
      "generation",
      "branch",
    ]);
    for (const category of ["SPOUSE", "EXTERNAL"] as const)
      expect(missingFields(p("b", { ...empty, category }), null)).toEqual([
        "name",
        "sex",
        "birthYear",
      ]);
  });
  it("không tính năm mất; NAME_UNKNOWN là thiếu tên; sex undefined không thiếu", () => {
    expect(
      missingFields(p("a", { deathYear: null, sex: undefined }), 2),
    ).toEqual([]);
    expect(missingFields(p("a", { flags: ["NAME_UNKNOWN"] }), 2)).toEqual([
      "name",
    ]);
  });
  it("thủy tổ và các đời trên người khai chi không bị báo thiếu chi", () => {
    // Người khai chi duy nhất ở đời 2 → đời 1 miễn, đời 2 trở đi phải có chi.
    const s = stats(
      [
        p("ts", { generation: 1, branch: null }),
        p("a", { generation: 2, branch: "I" }),
        p("b", { generation: 2, branch: null }),
        p("c", { generation: 3, branch: null }),
        p("d", { generation: null, branch: null }),
      ],
      [branch("I", "a")],
    );
    const ids = s.missing.groups
      .find((g) => g.field === "branch")!
      .people.map((x) => x.id);
    expect(ids).toEqual(["b", "c", "d"]);
  });
  it("chưa có người khai chi: mọi CLAN thiếu chi đều bị báo", () => {
    const s = stats(
      [p("ts", { generation: 1, branch: null })],
      [branch("I", null)],
    );
    expect(
      s.missing.groups.find((g) => g.field === "branch")!.people,
    ).toHaveLength(1);
  });
  it("BIRTH_CONFLICT tách khỏi thiếu năm sinh", () => {
    const s = stats([
      p("a", { birthYear: null, flags: ["BIRTH_CONFLICT"] }),
      p("b", { birthYear: null }),
    ]);
    expect(
      s.missing.groups
        .find((g) => g.field === "birthYear")!
        .people.map((x) => x.id),
    ).toEqual(["b"]);
    expect(s.missing.conflicts.map((x) => x.id)).toEqual(["a"]);
    expect(s.missing.people).toBe(1);
  });
  it("chi null ở người khai khác: người có đời nhưng founder không có đời không làm sai", () => {
    expect(
      stats([p("a", { branch: null })], [branch("I", "khong-co")]).missing
        .people,
    ).toBe(1);
  });
});

describe("comparePeople", () => {
  it("đời tăng dần, rồi tên theo thứ tự tiếng Việt, đời chưa rõ cuối", () => {
    const r = (id: string, name: string, generation: number | null) => ({
      id,
      name,
      generation,
      birthYear: null,
      deathYear: null,
    });
    const list = [
      r("1", "Zung", 2),
      r("2", "Ân", 2),
      r("3", "An", 2),
      r("4", "Đạt", 2),
      r("5", "Dũng", 2),
      r("6", "Bình", null),
      r("7", "Cường", 1),
    ].sort(comparePeople);
    expect(list.map((x) => x.name)).toEqual([
      "Cường",
      "An",
      "Ân",
      "Dũng",
      "Đạt",
      "Zung",
      "Bình",
    ]);
  });
});
