// Kiểm tra lập kế hoạch công bố ghi chú vào ảnh chụp (hàm thuần). Dữ liệu hoàn toàn giả.
import { describe, expect, it } from "vitest";
import {
  NOTE_CLIP,
  SNAPSHOT_MAX_BYTES,
  clipNote,
  planSnapshotNote,
} from "../scripts/gia-pha/snapshot-note-core";
import { SNAPSHOT_MAX_BYTES as APP_MAX } from "../src/editCore";
import { NOTE_CLIP as APP_CLIP, clipNote as appClip } from "../src/treeModel";
import {
  PROD_PROJECT,
  ackPhrase,
  evaluateProdGate,
} from "../scripts/gia-pha/prod-gate";

type Doc = Record<string, unknown>;
const tuples = (): Record<string, unknown[]> => ({
  a: ["Giả A", 1900, null, 1, "C", "c1", [], "M"],
  b: ["Vợ A", null, null, null, "S", null, ["VERIFY"], "F", false],
  c: ["Giả C", null, null, 2, "C", "c1", [], null, false, "cũ"],
});
const snapshot = (persons = tuples(), editVersion: unknown = 4): Doc => ({
  schemaVersion: 1,
  dataVersion: "x",
  editVersion,
  data: JSON.stringify({
    v: 1,
    persons,
    relations: [],
    unions: [],
    branches: {},
  }),
});
const people = (over: Record<string, Doc | undefined> = {}) =>
  new Map<string, Doc>(
    Object.entries({ a: {}, b: {}, c: {}, ...over }).filter(
      (e): e is [string, Doc] => e[1] !== undefined,
    ),
  );
const privs = (over: Record<string, Doc> = {}) =>
  new Map<string, Doc>(Object.entries(over));
const ok = (r: ReturnType<typeof planSnapshotNote>) => {
  if ("errors" in r) throw new Error(r.errors.join());
  return r;
};

describe("planSnapshotNote", () => {
  it("điền đã mất + ghi chú, nâng bộ 8/9 lên 10, đếm đúng, giữ editVersion", () => {
    const r = ok(
      planSnapshotNote(
        snapshot(),
        people({ a: { deceased: true } }),
        privs({ a: { note: "  Ghi chú A  " }, b: { note: "" } }),
      ),
    );
    expect(r.editVersion).toBe(4);
    const p = JSON.parse(r.json).persons;
    expect(p.a).toEqual([...tuples().a, true, "Ghi chú A"]);
    expect(p.b).toEqual([...tuples().b, null]);
    // c có ghi chú cũ "cũ" trong ảnh chụp nhưng personPrivate không có → xóa khỏi ảnh chụp.
    expect(p.c[9]).toBeNull();
    expect(r.stats).toEqual({
      persons: 3,
      withNote: 1,
      clipped: 0,
      changed: 3,
      newlyPublished: 1,
    });
    expect(r.review).toEqual([{ id: "a", chars: 9, published: "Ghi chú A" }]);
  });
  it("ghi chú dài bị cắt, tính vào clipped; review chỉ chứa bản đã cắt", () => {
    const long = "x".repeat(NOTE_CLIP + 40);
    const r = ok(
      planSnapshotNote(snapshot(), people(), privs({ a: { note: long } })),
    );
    expect(r.stats.clipped).toBe(1);
    expect(r.review[0]).toEqual({
      id: "a",
      chars: NOTE_CLIP + 40,
      published: `${"x".repeat(NOTE_CLIP)}…`,
    });
    expect(JSON.stringify(r.stats)).not.toContain("xxx");
  });
  it("idempotent: chạy lại trên kết quả thì changed = 0 và json y nguyên", () => {
    const first = ok(
      planSnapshotNote(snapshot(), people(), privs({ a: { note: "n" } })),
    );
    const second = ok(
      planSnapshotNote(
        { ...snapshot(), data: first.json },
        people(),
        privs({ a: { note: "n" } }),
      ),
    );
    expect(second.stats.changed).toBe(0);
    expect(second.json).toBe(first.json);
    expect(second.review).toEqual([]);
  });
  it("cập nhật khi ghi chú hoặc đã mất đổi; không tính là công bố lần đầu", () => {
    const first = ok(
      planSnapshotNote(snapshot(), people(), privs({ a: { note: "n" } })),
    );
    const r = ok(
      planSnapshotNote(
        { ...snapshot(), data: first.json },
        people({ a: { deceased: true } }),
        privs({ a: { note: "n2" } }),
      ),
    );
    expect(r.stats.changed).toBe(1);
    expect(r.stats.newlyPublished).toBe(0);
    expect(JSON.parse(r.json).persons.a.slice(8)).toEqual([true, "n2"]);
  });
  it("dừng (chỉ in mã) khi thiếu giới tính, thiếu/ẩn persons doc hoặc dữ liệu sai kiểu", () => {
    const old = tuples();
    old.a = ["Giả A", 1900, null, 1, "C", "c1", []];
    expect(planSnapshotNote(snapshot(old), people(), privs())).toEqual({
      errors: ["NEEDS_SEX_FIRST: a"],
    });
    expect(
      planSnapshotNote(snapshot(), people({ b: undefined }), privs()),
    ).toEqual({ errors: ["PERSON_DOC_MISSING: b"] });
    expect(
      planSnapshotNote(snapshot(), people({ a: { deleted: true } }), privs()),
    ).toEqual({ errors: ["PERSON_HIDDEN: a"] });
    expect(
      planSnapshotNote(snapshot(), people({ a: { deceased: "x" } }), privs()),
    ).toEqual({ errors: ["DECEASED_INVALID: a"] });
    expect(
      planSnapshotNote(snapshot(), people(), privs({ a: { note: 5 } })),
    ).toEqual({ errors: ["NOTE_INVALID: a"] });
  });
  it("dừng khi ảnh chụp hỏng, sai phiên bản hoặc editVersion lạ", () => {
    const bad = (s: Doc | null) =>
      "errors" in planSnapshotNote(s, people(), privs());
    expect(bad(null)).toBe(true);
    expect(bad({ ...snapshot(), schemaVersion: 2 })).toBe(true);
    expect(bad({ ...snapshot(), data: "{" })).toBe(true);
    expect(bad(snapshot(tuples(), -1))).toBe(true);
    expect(bad(snapshot({ a: ["x"] }))).toBe(true);
  });
  it("dừng khi kết quả vượt trần kích thước", () => {
    const big: Record<string, unknown[]> = {};
    const docs = new Map<string, Doc>();
    const pad = "x".repeat(900);
    for (let i = 0; i < 1000; i++) {
      big[`p${i}`] = [pad, null, null, null, "C", null, [], null];
      docs.set(`p${i}`, {});
    }
    const r = planSnapshotNote(snapshot(big), docs, privs());
    expect("errors" in r && r.errors[0]).toContain("vượt trần");
  });
  it("--strip cắt về 9 phần tử (giữ đã mất), không cần persons, idempotent", () => {
    const synced = ok(
      planSnapshotNote(
        snapshot(),
        people({ a: { deceased: true } }),
        privs({ a: { note: "n" } }),
      ),
    );
    const doc = { ...snapshot(), data: synced.json };
    const r = ok(planSnapshotNote(doc, new Map(), new Map(), { strip: true }));
    const p = JSON.parse(r.json).persons;
    for (const id of ["a", "b", "c"]) expect(p[id]).toHaveLength(9);
    expect(p.a[8]).toBe(true);
    const again = ok(
      planSnapshotNote({ ...doc, data: r.json }, new Map(), new Map(), {
        strip: true,
      }),
    );
    expect(again.stats.changed).toBe(0);
  });
  it("hằng số và clipNote khớp src (script không import được src)", () => {
    expect(SNAPSHOT_MAX_BYTES).toBe(APP_MAX);
    expect(NOTE_CLIP).toBe(APP_CLIP);
    for (const s of [
      "",
      "  ",
      "ngắn",
      "a".repeat(NOTE_CLIP),
      "b".repeat(NOTE_CLIP + 7),
      "😀".repeat(NOTE_CLIP + 2),
      "dòng 1\ndòng 2 " + "z".repeat(400),
    ])
      expect(clipNote(s)).toBe(appClip(s));
  });
});

describe("cổng prod cho CONG BO GHI CHU", () => {
  it("cần đúng project, --confirm và câu xác nhận; không đòi sao lưu", () => {
    const base = {
      action: "CONG BO GHI CHU" as const,
      project: PROD_PROJECT,
      needsBackup: false,
      now: new Date(),
    };
    expect(
      evaluateProdGate({ ...base, confirm: undefined, ack: undefined }).ok,
    ).toBe(false);
    expect(
      evaluateProdGate({
        ...base,
        confirm: PROD_PROJECT,
        ack: ackPhrase("CONG BO GHI CHU", PROD_PROJECT),
      }).ok,
    ).toBe(true);
    expect(
      evaluateProdGate({
        ...base,
        confirm: PROD_PROJECT,
        ack: ackPhrase("DONG BO GIOI TINH", PROD_PROJECT),
      }).ok,
    ).toBe(false);
  });
});
