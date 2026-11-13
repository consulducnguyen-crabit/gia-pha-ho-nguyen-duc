// Kiểm tra lập kế hoạch đồng bộ giới tính vào ảnh chụp (hàm thuần). Dữ liệu hoàn toàn giả.
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_MAX_BYTES,
  planSnapshotSex,
} from "../scripts/gia-pha/snapshot-sex-core";
import { SNAPSHOT_MAX_BYTES as APP_MAX } from "../src/editCore";

type Doc = Record<string, unknown>;
const tuples = (): Record<string, unknown[]> => ({
  a: ["Giả A", 1900, null, 1, "C", "c1", []],
  b: ["Vợ A", null, null, null, "S", null, ["VERIFY"]],
  c: ["Giả C", null, null, 2, "C", "c1"], // bản cũ 6 phần tử
});
const snapshot = (
  persons = tuples(),
  editVersion: unknown = 4,
  noVersion = false,
): Doc => ({
  schemaVersion: 1,
  dataVersion: "x",
  ...(noVersion ? {} : { editVersion }),
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
    Object.entries({
      a: { sex: "M" },
      b: { sex: "F" },
      c: {},
      ...over,
    }).filter((e): e is [string, Doc] => e[1] !== undefined),
  );
const ok = (r: ReturnType<typeof planSnapshotSex>) => {
  if ("errors" in r) throw new Error(r.errors.join());
  return r;
};

describe("planSnapshotSex", () => {
  it("điền giới tính, nâng bộ 6 phần tử lên 8, đếm đúng, giữ editVersion", () => {
    const r = ok(planSnapshotSex(snapshot(), people()));
    expect(r.editVersion).toBe(4);
    expect(r.stats).toEqual({
      persons: 3,
      male: 1,
      female: 1,
      unknown: 1,
      changed: 3,
    });
    const p = JSON.parse(r.json).persons;
    expect(p.a[7]).toBe("M");
    expect(p.b).toEqual(["Vợ A", null, null, null, "S", null, ["VERIFY"], "F"]);
    expect(p.c).toEqual(["Giả C", null, null, 2, "C", "c1", [], null]);
  });
  it("idempotent: chạy lại trên kết quả thì changed = 0 và json y nguyên", () => {
    const first = ok(planSnapshotSex(snapshot(), people()));
    const doc = { ...snapshot(), data: first.json };
    const second = ok(planSnapshotSex(doc, people()));
    expect(second.stats.changed).toBe(0);
    expect(second.json).toBe(first.json);
  });
  it("cập nhật khi persons.sex đổi (bộ đã có 8 phần tử)", () => {
    const first = ok(planSnapshotSex(snapshot(), people()));
    const r = ok(
      planSnapshotSex(
        { ...snapshot(), data: first.json },
        people({ a: { sex: "F" } }),
      ),
    );
    expect(r.stats.changed).toBe(1);
    expect(JSON.parse(r.json).persons.a[7]).toBe("F");
  });
  it("editVersion thiếu = 0", () => {
    expect(
      ok(planSnapshotSex(snapshot(tuples(), undefined, true), people()))
        .editVersion,
    ).toBe(0);
  });
  it("dừng khi người trong ảnh chụp không có persons doc hoặc bị ẩn (chỉ in mã)", () => {
    const missing = planSnapshotSex(snapshot(), people({ b: undefined }));
    expect(missing).toEqual({ errors: ["PERSON_DOC_MISSING: b"] });
    const hidden = planSnapshotSex(
      snapshot(),
      people({ a: { sex: "M", deleted: true } }),
    );
    expect(hidden).toEqual({ errors: ["PERSON_HIDDEN: a"] });
    expect(JSON.stringify([missing, hidden])).not.toContain("Giả");
  });
  it("dừng khi sex ngoài M/F/null", () => {
    expect(planSnapshotSex(snapshot(), people({ a: { sex: "X" } }))).toEqual({
      errors: ["SEX_INVALID: a"],
    });
  });
  it("dừng khi ảnh chụp hỏng, sai phiên bản hoặc editVersion lạ", () => {
    expect("errors" in planSnapshotSex(null, people())).toBe(true);
    expect(
      "errors" in
        planSnapshotSex({ ...snapshot(), schemaVersion: 2 }, people()),
    ).toBe(true);
    expect(
      "errors" in planSnapshotSex({ ...snapshot(), data: "{" }, people()),
    ).toBe(true);
    expect("errors" in planSnapshotSex(snapshot(tuples(), -1), people())).toBe(
      true,
    );
    expect("errors" in planSnapshotSex(snapshot({ a: ["x"] }), people())).toBe(
      true,
    );
  });
  it("dừng khi kết quả vượt trần kích thước", () => {
    const big: Record<string, unknown[]> = {};
    const docs = new Map<string, Doc>();
    const pad = "x".repeat(900);
    for (let i = 0; i < 1000; i++) {
      big[`p${i}`] = [pad, null, null, null, "C", null, []];
      docs.set(`p${i}`, { sex: "M" });
    }
    const r = planSnapshotSex(snapshot(big), docs);
    expect("errors" in r && r.errors[0]).toContain("vượt trần");
  });
  it("--strip cắt về 7 phần tử, không cần persons, idempotent", () => {
    const synced = ok(planSnapshotSex(snapshot(), people()));
    const doc = { ...snapshot(), data: synced.json };
    const r = ok(planSnapshotSex(doc, new Map(), { strip: true }));
    expect(r.stats.changed).toBe(3);
    const p = JSON.parse(r.json).persons;
    for (const id of ["a", "b", "c"])
      expect(p[id].length).toBeLessThanOrEqual(7);
    expect(p.b[6]).toEqual(["VERIFY"]);
    const again = ok(
      planSnapshotSex({ ...doc, data: r.json }, new Map(), { strip: true }),
    );
    expect(again.stats.changed).toBe(0);
  });
  it("trần khớp src/editCore", () => {
    expect(SNAPSHOT_MAX_BYTES).toBe(APP_MAX);
  });
});
