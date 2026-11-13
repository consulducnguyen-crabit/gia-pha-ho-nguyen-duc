import { describe, expect, it } from "vitest";
import { parseDsl } from "../scripts/gia-pha/dsl";
import { buildImportPlan } from "../scripts/gia-pha/import-plan";
import {
  NOTE_CLIP,
  buildIndex,
  clipNote,
  parseSnapshot,
  sameNamePeople,
  setTupleDeceased,
  setTupleNote,
  setTupleSex,
  yearsLabel,
  type SnapPerson,
} from "../src/treeModel";

// Dữ liệu hoàn toàn giả, đi qua đúng bộ dựng ảnh chụp của script nạp.
const text = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I||",
  "P|a|Giả Văn A|M|CLAN|II|I|b=1927;d=1973|",
  "P|b|Giả Thị B|F|CLAN|II|I|b=1930|",
  "P|va|Vợ Giả A|F|SPOUSE|||b=1930|",
  "P|vb|Chồng Giả B|M|SPOUSE||||",
  "P|c|Giả Văn C|M|CLAN|III|I||",
  "P|d|Giả Văn Nuôi|M|CLAN|III|I||",
  "P|e|Con Của B|M|EXTERNAL||||",
  "K|ts|-|a,b",
  "K|a|va|c,d:A",
  "K|vb|b|e",
].join("\n");
function snapshot() {
  const plan = buildImportPlan(parseDsl(text), "import-test");
  return parseSnapshot(
    plan.docs.find((d) => d.path === "treeSnapshots/main")!.data,
  );
}

describe("đọc và dựng chỉ mục ảnh chụp cây", () => {
  const idx = buildIndex(snapshot());

  it("tìm đúng một thủy tổ và đường truyền dòng", () => {
    expect(idx.root).toBe("ts");
    expect(idx.lineagePath("c")).toEqual(["ts", "a", "c"]);
    expect(idx.lineageChildren("ts")).toEqual(["a", "b"]);
    expect(idx.descendantCount("ts")).toBe(4);
  });

  it("con nuôi vẫn nằm trong dòng và được nhận diện để gắn badge", () => {
    expect(idx.lineageChildren("a")).toEqual(["c", "d"]);
    expect(idx.isAdoptedChild("d")).toBe(true);
    expect(idx.isAdoptedChild("c")).toBe(false);
    expect(idx.parents("d").map((p) => p.adoptive)).toEqual([true, true]);
  });

  it("con của con gái không truyền dòng nhưng hiện ở hồ sơ mẹ", () => {
    expect(idx.lineageChildren("b")).toEqual([]);
    expect(idx.children("b")).toEqual(["e"]);
    expect(
      idx
        .parents("e")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["b", "vb"]);
  });

  it("vợ chồng, anh chị em và nhãn năm", () => {
    expect(idx.spouses("a")).toEqual(["va"]);
    expect(idx.spouses("b")).toEqual(["vb"]);
    expect(idx.siblings("a")).toEqual(["b"]);
    expect(idx.siblings("c")).toEqual(["d"]);
    const a = idx.snapshot.persons.get("a")!;
    expect(yearsLabel(a)).toBe("1927–1973");
    expect(yearsLabel(idx.snapshot.persons.get("b")!)).toBe("s. 1930");
    expect(yearsLabel(idx.snapshot.persons.get("ts")!)).toBe("");
  });

  it("tìm kiếm không phân biệt dấu và hoa thường", () => {
    expect(idx.search("GIA VAN").map((p) => p.id)).toEqual(["a", "c", "d"]);
    expect(idx.search("nuoi").map((p) => p.id)).toEqual(["d"]);
    expect(idx.search("   ")).toEqual([]);
  });
});

describe("từ chối ảnh chụp sai cấu trúc", () => {
  const ok = {
    schemaVersion: 1,
    dataVersion: "x",
    data: JSON.stringify({
      v: 1,
      persons: {},
      relations: [],
      unions: [],
      branches: {},
    }),
  };
  it("đọc editVersion (thiếu hoặc sai kiểu = 0)", () => {
    expect(parseSnapshot(ok).editVersion).toBe(0);
    expect(parseSnapshot({ ...ok, editVersion: 3 }).editVersion).toBe(3);
    expect(parseSnapshot({ ...ok, editVersion: 1.5 }).editVersion).toBe(0);
    expect(parseSnapshot({ ...ok, editVersion: "3" }).editVersion).toBe(0);
  });
  it("chấp nhận bản hợp lệ rỗng", () => {
    expect(parseSnapshot(ok).persons.size).toBe(0);
  });
  it("báo lỗi với phiên bản, JSON và tham chiếu sai", () => {
    expect(() => parseSnapshot(null)).toThrow();
    expect(() => parseSnapshot({ ...ok, schemaVersion: 2 })).toThrow();
    expect(() => parseSnapshot({ ...ok, data: "{" })).toThrow();
    expect(() =>
      parseSnapshot({
        ...ok,
        data: JSON.stringify({
          v: 1,
          persons: {},
          relations: [["x", "y", "F", "B", 1]],
          unions: [],
          branches: {},
        }),
      }),
    ).toThrow();
    expect(() =>
      parseSnapshot({
        ...ok,
        data: JSON.stringify({
          v: 1,
          persons: { a: ["A", null, null, null, "Z", null] },
          relations: [],
          unions: [],
          branches: {},
        }),
      }),
    ).toThrow();
  });
});

describe("sameNamePeople", () => {
  const mk = (
    id: string,
    name: string,
    generation: number | null,
  ): SnapPerson => ({
    id,
    name,
    birthYear: null,
    deathYear: null,
    generation,
    category: "CLAN",
    branch: null,
    flags: [],
    normalized: "",
  });
  const all = [
    mk("a", "Giả Văn An", 3),
    mk("b", "giả  văn an", 3),
    mk("c", "Giả Văn An", 4),
    mk("d", "Giả Văn Ân", 3),
    mk("e", "Giả Văn An", null),
  ];
  it("trùng đúng dấu, cùng đời, bỏ qua hoa/thường và khoảng trắng", () => {
    expect(sameNamePeople(all, "Giả Văn An", 3, "a").map((x) => x.id)).toEqual([
      "b",
    ]);
    expect(sameNamePeople(all, "Giả Văn An", 3, null).map((x) => x.id)).toEqual(
      ["a", "b"],
    );
  });
  it("không báo khi khác dấu, khác đời hoặc chưa biết đời", () => {
    expect(sameNamePeople(all, "Giả Văn Ân", 3, "d")).toEqual([]);
    expect(sameNamePeople(all, "Giả Văn An", null, null)).toEqual([]);
    expect(sameNamePeople(all, "   ", 3, null)).toEqual([]);
  });
});

describe("giới tính trong bộ dữ liệu người", () => {
  const parse = (tuple: unknown[]) =>
    parseSnapshot({
      schemaVersion: 1,
      dataVersion: "x",
      data: JSON.stringify({
        v: 1,
        persons: { a: tuple },
        relations: [],
        unions: [],
        branches: {},
      }),
    }).persons.get("a")!;
  const base = ["Giả A", null, null, 1, "C", null];
  it("6 và 7 phần tử: sex undefined (chưa có dữ liệu)", () => {
    expect(parse(base).sex).toBeUndefined();
    expect(parse([...base, []]).sex).toBeUndefined();
  });
  it("8 phần tử: M, F, null", () => {
    expect(parse([...base, [], "M"]).sex).toBe("M");
    expect(parse([...base, [], "F"]).sex).toBe("F");
    expect(parse([...base, [], null]).sex).toBeNull();
  });
  it("sex sai hoặc quá 8 phần tử bị từ chối", () => {
    expect(() => parse([...base, [], "X"])).toThrow();
    expect(() => parse([...base, [], "m"])).toThrow();
    expect(() => parse([...base, [], "M", 1])).toThrow();
  });
  it("setTupleSex không tạo mảng thưa", () => {
    const t: unknown[] = [...base];
    setTupleSex(t, "F");
    expect(t).toHaveLength(8);
    expect(t[6]).toEqual([]);
    expect(JSON.parse(JSON.stringify(t))[7]).toBe("F");
    expect(parse(t).sex).toBe("F");
  });
});

describe("đã mất trong ảnh chụp", () => {
  const parse = (tuple: unknown[]) =>
    parseSnapshot({
      schemaVersion: 1,
      dataVersion: "x",
      data: JSON.stringify({
        v: 1,
        persons: { a: tuple },
        relations: [],
        unions: [],
        branches: {},
      }),
    }).persons.get("a")!;
  const base = ["Giả A", null, null, 1, "C", null, [], "M"];
  it("bộ < 9 phần tử: deceased undefined", () => {
    expect(parse(base).deceased).toBeUndefined();
  });
  it("9 phần tử: true/false; không phải boolean thì bị từ chối; quá 9 bị từ chối", () => {
    expect(parse([...base, true]).deceased).toBe(true);
    expect(parse([...base, false]).deceased).toBe(false);
    expect(() => parse([...base, null])).toThrow();
    expect(() => parse([...base, "true"])).toThrow();
    expect(() => parse([...base, true, 1])).toThrow();
  });
  it("setTupleDeceased đệm cờ/giới tính, không tạo mảng thưa", () => {
    const t: unknown[] = ["Giả A", null, null, 1, "C", null];
    setTupleDeceased(t, true);
    expect(t).toHaveLength(9);
    expect(t[6]).toEqual([]);
    expect(t[7]).toBeNull();
    expect(JSON.parse(JSON.stringify(t))[8]).toBe(true);
    expect(parse(t).deceased).toBe(true);
  });
  it("yearsLabel: đã mất không rõ năm vẫn hiện, có năm mất thì dùng năm", () => {
    const y = (o: object) =>
      yearsLabel({ birthYear: null, deathYear: null, ...o });
    expect(y({ deceased: true })).toBe("đã mất");
    expect(y({ birthYear: 1930, deceased: true })).toBe("s. 1930 · đã mất");
    expect(y({ birthYear: 1930, deathYear: 1990, deceased: true })).toBe(
      "1930–1990",
    );
    expect(y({ deathYear: 1990, deceased: true })).toBe("m. 1990");
    expect(y({ birthYear: 1930 })).toBe("s. 1930");
    expect(y({})).toBe("");
  });
});

describe("ghi chú trong ảnh chụp", () => {
  const parse = (tuple: unknown[]) =>
    parseSnapshot({
      schemaVersion: 1,
      dataVersion: "x",
      data: JSON.stringify({
        v: 1,
        persons: { a: tuple },
        relations: [],
        unions: [],
        branches: {},
      }),
    }).persons.get("a")!;
  const base = ["Giả A", null, null, 1, "C", null, [], "M", false];
  it("bộ < 10 phần tử: note undefined; 10 phần tử: chuỗi hoặc null", () => {
    expect(parse(base).note).toBeUndefined();
    expect(parse([...base, "Ghi chú"]).note).toBe("Ghi chú");
    expect(parse([...base, null]).note).toBeNull();
    expect(parse([...base, ""]).note).toBeNull();
  });
  it("phần tử 10 sai kiểu hoặc quá 10 phần tử bị từ chối", () => {
    expect(() => parse([...base, 5])).toThrow();
    expect(() => parse([...base, {}])).toThrow();
    expect(() => parse([...base, "x", 1])).toThrow();
  });
  it("clipNote: rỗng → null, ngắn giữ nguyên, dài bị cắt có dấu …", () => {
    expect(clipNote("")).toBeNull();
    expect(clipNote("  \n ")).toBeNull();
    expect(clipNote("  ngắn  ")).toBe("ngắn");
    const exact = "a".repeat(NOTE_CLIP);
    expect(clipNote(exact)).toBe(exact);
    const long = clipNote("b".repeat(NOTE_CLIP + 50))!;
    expect(long).toBe(`${"b".repeat(NOTE_CLIP)}…`);
  });
  it("clipNote không cắt giữa cặp thay thế (emoji) và giữ xuống dòng", () => {
    const s = "😀".repeat(NOTE_CLIP + 1);
    const out = clipNote(s)!;
    expect(Array.from(out)).toHaveLength(NOTE_CLIP + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
    expect(clipNote("dòng 1\ndòng 2")).toBe("dòng 1\ndòng 2");
  });
  it("setTupleNote đệm cờ/giới tính/đã mất, không tạo mảng thưa", () => {
    const t: unknown[] = ["Giả A", null, null, 1, "C", null];
    setTupleNote(t, "ghi chú");
    expect(t).toHaveLength(10);
    expect(t.slice(6)).toEqual([[], null, false, "ghi chú"]);
    expect(parse(t).note).toBe("ghi chú");
  });
});
