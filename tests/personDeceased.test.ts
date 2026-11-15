// Lập kế hoạch chuẩn hóa "Đã mất" theo đời (hàm thuần). Dữ liệu hoàn toàn giả.
import { describe, expect, it } from "vitest";
import {
  MAX_WRITES,
  SNAPSHOT_MAX_BYTES,
  planPersonDeceased,
  type UndoRecord,
} from "../scripts/gia-pha/person-deceased-core";
import { SNAPSHOT_MAX_BYTES as APP_MAX } from "../src/editCore";
import {
  PROD_PROJECT,
  ackPhrase,
  evaluateProdGate,
} from "../scripts/gia-pha/prod-gate";

type Doc = Record<string, unknown>;
// [tên, năm sinh, năm mất, đời, loại, nhánh, cờ, giới tính, (đã mất), (ghi chú)]
const tuples = (): Record<string, unknown[]> => ({
  g1: ["Giả đời 1", 1800, null, 1, "C", "c1", [], "M"],
  w1: ["Vợ đời 1", null, null, null, "S", null, [], "F"],
  w1b: ["Vợ hai đời 1", 1945, null, null, "S", null, [], "F"],
  g4: ["Giả đời 4", null, null, 4, "C", "c1", [], "M", false],
  w4: ["Chồng đời 4", null, null, null, "S", null, [], "M", false, "ghi chú"],
  g5: ["Giả đời 5", null, null, 5, "C", "c1", [], "F", false],
  w5: ["Vợ đời 5", null, null, null, "S", null, [], "F", false],
  x: ["Người dòng họ đời 6", null, null, 6, "C", "c1", [], "M", false],
  e: ["Người EXTERNAL", null, null, null, "E", null, [], "M", false],
});
const snap = (persons = tuples(), editVersion: unknown = 7): Doc => ({
  schemaVersion: 1,
  editVersion,
  data: JSON.stringify({
    v: 1,
    persons,
    relations: [],
    unions: [
      ["g1", "w1", null],
      ["g1", "w1b", null], // người có hai vợ
      ["g4", "w4", null],
      ["g4", "x", null], // vợ/chồng là người dòng họ đời 6: cần xem lại
      ["g1", "e", null], // vợ/chồng loại EXTERNAL: cần xem lại
      ["g5", "w5", null],
    ],
    branches: {},
  }),
});
const docs = (over: Record<string, Doc | undefined> = {}) =>
  new Map<string, Doc>(
    Object.entries<Doc | undefined>({
      g1: { generation: 1, category: "CLAN", profileVersion: 2 },
      w1: { category: "SPOUSE", profileVersion: 2 },
      w1b: { category: "SPOUSE", profileVersion: 2 },
      g4: { generation: 4, category: "CLAN", profileVersion: 2 },
      w4: { category: "SPOUSE", profileVersion: 2 },
      g5: { generation: 5, category: "CLAN" },
      w5: { category: "SPOUSE" },
      x: { generation: 6, category: "CLAN" },
      e: { category: "EXTERNAL" },
      ...over,
    }).filter((e): e is [string, Doc] => e[1] !== undefined),
  );
const ok = (r: ReturnType<typeof planPersonDeceased>) => {
  if ("errors" in r) throw new Error(r.errors.join());
  return r;
};
const mark = (s = snap(), d = docs(), max = 4) =>
  planPersonDeceased(s, d, { mode: "mark", maxGeneration: max });

describe("planPersonDeceased (đánh dấu)", () => {
  it("đời 1..4, mọi vợ/chồng (kể cả người có hai vợ) được đánh dấu; đời 5 trở đi không đổi; giữ editVersion", () => {
    const r = ok(mark());
    expect(r.editVersion).toBe(7);
    expect(r.changes.map((c) => c.id).sort()).toEqual([
      "g1",
      "g4",
      "w1",
      "w1b",
      "w4",
    ]);
    expect(r.changes.filter((c) => c.role === "SPOUSE").length).toBe(3);
    expect(r.stats).toMatchObject({
      persons: 9,
      ancestors: 2,
      spouses: 3,
      alreadyDeceased: 0,
      toChange: 5,
    });
    const p = JSON.parse(r.json).persons;
    expect(p.g1[8]).toBe(true); // bộ 8 phần tử được nâng lên 9
    expect(p.g1).toHaveLength(9);
    expect(p.w1[8]).toBe(true);
    expect(p.g4[8]).toBe(true);
    expect(p.w4).toEqual([...tuples().w4.slice(0, 8), true, "ghi chú"]); // giữ ghi chú
    expect(p.g5[8]).toBe(false);
    expect(p.w5[8]).toBe(false);
  });
  it("lưu trạng thái trước và profileVersion sau của từng người (để hoàn tác đúng)", () => {
    const r = ok(mark());
    expect(r.changes.find((c) => c.id === "g1")).toMatchObject({
      to: true,
      nextVersion: 3,
      before: { deceased: false, tuple: null, afterVersion: 3 },
    });
    expect(r.changes.find((c) => c.id === "g4")!.before).toEqual({
      deceased: false,
      tuple: false,
      afterVersion: 3,
    });
  });
  it("vợ/chồng thuộc dòng họ đời > giới hạn hoặc loại EXTERNAL: báo xem lại, không tự đổi", () => {
    const r = ok(mark());
    expect(r.review.sort()).toEqual(["e", "x"]);
    const p = JSON.parse(r.json).persons;
    expect(p.x[8]).toBe(false);
    expect(p.e[8]).toBe(false);
  });
  it("báo người sinh từ 1940 (có thể còn sống) nhưng vẫn theo quy tắc đã duyệt", () => {
    const r = ok(mark());
    expect(r.recentBirth).toEqual(["w1b"]);
    expect(r.changes.some((c) => c.id === "w1b")).toBe(true);
  });
  it("giới hạn đời thay đổi được", () => {
    const r = ok(
      mark(snap(), docs({ g5: { generation: 5, category: "CLAN" } }), 5),
    );
    expect(r.changes.map((c) => c.id)).toContain("g5");
    expect(r.changes.map((c) => c.id)).toContain("w5");
  });
  it("idempotent: đã đánh dấu thì không đổi nữa", () => {
    const first = ok(mark());
    const marked = (id: string, extra: Doc = {}) => ({
      ...docs().get(id)!,
      deceased: true,
      ...extra,
    });
    const again = ok(
      mark(
        { ...snap(), data: first.json },
        docs({
          g1: marked("g1"),
          w1: marked("w1"),
          w1b: marked("w1b"),
          g4: marked("g4"),
          w4: marked("w4"),
        }),
      ),
    );
    expect(again.stats.toChange).toBe(0);
    expect(again.stats.alreadyDeceased).toBe(5);
    expect(again.changes).toEqual([]);
  });
  it("persons đã true nhưng ảnh chụp chưa: vẫn đồng bộ ảnh chụp và ghi nhận trạng thái trước", () => {
    const r = ok(
      mark(
        snap(),
        docs({
          g1: { generation: 1, category: "CLAN", deceased: true },
        }),
      ),
    );
    const c = r.changes.find((x) => x.id === "g1")!;
    expect(c.before).toMatchObject({ deceased: true, tuple: null });
  });
  it("dừng khi chưa có giới tính, thiếu persons doc, người bị ẩn, đời/loại lệch, deceased sai kiểu", () => {
    const t = tuples();
    t.g1 = t.g1.slice(0, 7);
    expect(mark(snap(t))).toEqual({ errors: ["NEEDS_SEX_FIRST: g1"] });
    expect(mark(snap(), docs({ g1: undefined }))).toEqual({
      errors: ["PERSON_DOC_MISSING: g1"],
    });
    expect(
      mark(
        snap(),
        docs({ g1: { generation: 1, category: "CLAN", deleted: true } }),
      ),
    ).toEqual({ errors: ["PERSON_HIDDEN: g1"] });
    expect(
      mark(snap(), docs({ g1: { generation: 2, category: "CLAN" } })),
    ).toEqual({ errors: ["GENERATION_MISMATCH: g1"] });
    expect(
      mark(snap(), docs({ g1: { generation: 1, category: "SPOUSE" } })),
    ).toEqual({ errors: ["GENERATION_MISMATCH: g1"] });
    expect(
      mark(
        snap(),
        docs({ g1: { generation: 1, category: "CLAN", deceased: "yes" } }),
      ),
    ).toEqual({ errors: ["DECEASED_INVALID: g1"] });
  });
  it("kiểm hai chiều: người dòng họ đời ≤ giới hạn chỉ có trong persons hoặc ảnh chụp ghi đời khác", () => {
    const extra = docs({ z: { generation: 2, category: "CLAN" } });
    expect(mark(snap(), extra)).toEqual({
      errors: ["PERSON_NOT_IN_SNAPSHOT: z"],
    });
    const t = tuples();
    t.g5 = ["Giả", null, null, 3, "C", "c1", [], "F", false]; // ảnh chụp: đời 3
    // persons nói đời 5, ảnh chụp nói đời 3 → ảnh chụp xếp vào mục tiêu nhưng lệch với persons
    expect(mark(snap(t))).toEqual({ errors: ["GENERATION_MISMATCH: g5"] });
    // persons nói đời 2, ảnh chụp nói đời 5
    expect(
      mark(snap(), docs({ g5: { generation: 2, category: "CLAN" } })),
    ).toEqual({ errors: ["GENERATION_MISMATCH: g5"] });
  });
  it("ảnh chụp hỏng hoặc thiếu thì dừng", () => {
    expect("errors" in mark(null as unknown as Doc)).toBe(true);
    expect("errors" in mark({ schemaVersion: 2, data: "{}" })).toBe(true);
    expect("errors" in mark({ schemaVersion: 1, data: "{" })).toBe(true);
    expect("errors" in mark(snap(tuples(), -1))).toBe(true);
    expect("errors" in mark(snap(), docs(), 0)).toBe(true);
  });
  it("quá số tài liệu cho một giao dịch thì dừng", () => {
    const t: Record<string, unknown[]> = {};
    const d = new Map<string, Doc>();
    for (let i = 0; i < MAX_WRITES + 1; i++) {
      t[`p${i}`] = ["Giả", null, null, 1, "C", "c1", [], "M"];
      d.set(`p${i}`, { generation: 1, category: "CLAN" });
    }
    const r = planPersonDeceased(
      {
        schemaVersion: 1,
        editVersion: 1,
        data: JSON.stringify({ v: 1, persons: t, relations: [], unions: [] }),
      },
      d,
      { mode: "mark", maxGeneration: 4 },
    );
    expect("errors" in r && r.errors[0]).toContain("vượt");
  });
});

describe("planPersonDeceased (hoàn tác)", () => {
  const afterMark = () => {
    const m = ok(mark());
    const records: UndoRecord[] = m.changes.map((c) => ({
      id: c.id,
      ...c.before!,
    }));
    // persons sau khi đánh dấu: deceased true, profileVersion = afterVersion
    const after = (over: Record<string, Doc> = {}) => {
      const d = docs();
      for (const c of m.changes)
        d.set(c.id, {
          ...d.get(c.id)!,
          deceased: true,
          profileVersion: c.nextVersion,
        });
      for (const [k, v] of Object.entries(over))
        d.set(k, { ...d.get(k)!, ...v });
      return d;
    };
    return { m, records, after };
  };
  it("khôi phục đúng trạng thái trước (cả ảnh chụp lẫn persons)", () => {
    const { m, records, after } = afterMark();
    const u = ok(
      planPersonDeceased({ ...snap(), data: m.json }, after(), {
        mode: "undo",
        undo: records,
      }),
    );
    expect(u.changes).toHaveLength(5);
    expect(u.changes.every((c) => c.to === false)).toBe(true);
    expect(u.changes.every((c) => c.nextVersion === 4)).toBe(true);
    const p = JSON.parse(u.json).persons;
    expect(p.g1[8]).toBe(false);
    expect(p.g4[8]).toBe(false);
    expect(p.g5[8]).toBe(false);
  });
  it("người vốn đã mất trước khi đánh dấu thì hoàn tác giữ nguyên đã mất (không ép false)", () => {
    const pre = docs({
      g1: {
        generation: 1,
        category: "CLAN",
        profileVersion: 2,
        deceased: true,
      },
    });
    const m = ok(
      planPersonDeceased(snap(), pre, { mode: "mark", maxGeneration: 4 }),
    );
    const records: UndoRecord[] = m.changes.map((c) => ({
      id: c.id,
      ...c.before!,
    }));
    const d = docs();
    for (const c of m.changes)
      d.set(c.id, {
        ...d.get(c.id)!,
        deceased: true,
        profileVersion: c.nextVersion,
      });
    const u = ok(
      planPersonDeceased({ ...snap(), data: m.json }, d, {
        mode: "undo",
        undo: records,
      }),
    );
    expect(u.changes.find((c) => c.id === "g1")!.to).toBe(true);
    expect(JSON.parse(u.json).persons.g1[8]).toBe(true);
    expect(u.changes.find((c) => c.id === "w1")!.to).toBe(false);
  });
  it("người đã được sửa tay sau lần đánh dấu bị bỏ qua và báo", () => {
    const { m, records, after } = afterMark();
    const u = ok(
      planPersonDeceased(
        { ...snap(), data: m.json },
        after({ g4: { profileVersion: 9 } }),
        { mode: "undo", undo: records },
      ),
    );
    expect(u.skippedEdited).toEqual(["g4"]);
    expect(u.changes.map((c) => c.id)).not.toContain("g4");
    expect(JSON.parse(u.json).persons.g4[8]).toBe(true); // giữ nguyên
  });
  it("mã không có trong ảnh chụp thì dừng", () => {
    expect(
      planPersonDeceased(snap(), docs(), {
        mode: "undo",
        undo: [{ id: "zz", deceased: false, tuple: null, afterVersion: 1 }],
      }),
    ).toEqual({ errors: ["UNDO_UNKNOWN: zz"] });
  });
});

describe("hằng số và cổng", () => {
  it("trần ảnh chụp khớp ứng dụng", () => {
    expect(SNAPSHOT_MAX_BYTES).toBe(APP_MAX);
  });
  it("cổng prod cần --confirm và câu CHUAN HOA DA MAT", () => {
    const now = new Date();
    const base = {
      action: "CHUAN HOA DA MAT" as const,
      project: PROD_PROJECT,
      needsBackup: false,
      now,
    };
    expect(
      evaluateProdGate({
        ...base,
        confirm: PROD_PROJECT,
        ack: ackPhrase("CHUAN HOA DA MAT", PROD_PROJECT),
      }).ok,
    ).toBe(true);
    expect(
      evaluateProdGate({ ...base, confirm: PROD_PROJECT, ack: "x" }).ok,
    ).toBe(false);
    expect(
      evaluateProdGate({
        ...base,
        confirm: undefined,
        ack: ackPhrase("CHUAN HOA DA MAT", PROD_PROJECT),
      }).ok,
    ).toBe(false);
  });
});
