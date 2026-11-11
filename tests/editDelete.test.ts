import { describe, expect, it } from "vitest";
import { EditError } from "../src/editCore";
import {
  applyDelete,
  deleteReads,
  type DeleteOp,
  type DeleteState,
} from "../src/editDelete";

const tree = () => ({
  v: 1,
  persons: {
    ts: ["Cụ Tổ", null, null, 1, "C", "c1", []],
    a: ["Giả A", 1900, null, 2, "C", "c1", []],
    k: ["Giả K", null, 1990, 3, "C", "c1", []],
    b: ["Vợ Giả A", null, null, null, "S", null, []],
    z: ["Người Lẻ", null, null, null, "E", null, []],
  },
  relations: [
    ["ts", "a", "F", "B", 1],
    ["a", "k", "F", "B", 1],
    ["b", "k", "M", "B", 0],
  ],
  unions: [["a", "b", "1"]],
  branches: { c1: ["Chi 1", "ts", null, null] },
});
const snap = (t: unknown, editVersion = 5) => ({
  schemaVersion: 1,
  dataVersion: "x",
  editVersion,
  data: JSON.stringify(t),
});
const person = (extra = {}) => ({
  displayName: "Giả K",
  normalizedName: "gia k",
  profileVersion: 2,
  ...extra,
});
const del = (personId: string, confirm = true): DeleteOp => ({
  type: "deletePerson",
  personId,
  confirm,
});
function delState(id = "k", t: unknown = tree()): DeleteState {
  const data = t as ReturnType<typeof tree>;
  const relations: DeleteState["relations"] = {};
  for (const r of data.relations)
    if (r[1] === id) relations[`r-${r[0]}-${id}`] = { version: 3 };
  return { snapshot: snap(t), person: person(), relations };
}
const run = (s: DeleteState, op: DeleteOp, v = 5) =>
  applyDelete(s, { op, expectedVersion: v, actorUid: "admin" });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof EditError ? e.code : "OTHER";
  }
  return "NONE";
};
const data = (r: {
  writes: { path: string; data: Record<string, unknown> }[];
}) =>
  JSON.parse(
    String(r.writes.find((w) => w.path === "treeSnapshots/main")!.data.data),
  );

describe("ẩn người (xóa mềm)", () => {
  it("ẩn người lá: gỡ khỏi snapshot, đánh dấu tài liệu, xóa bản thành viên, ghi nhật ký đủ để khôi phục", () => {
    const r = run(delState(), del("k"));
    expect(r.nextVersion).toBe(6);
    const d = data(r);
    expect(d.persons.k).toBeUndefined();
    expect(d.relations).toEqual([["ts", "a", "F", "B", 1]]);
    const w = Object.fromEntries(r.writes.map((x) => [x.path, x]));
    expect(w["persons/k"].data).toMatchObject({
      deleted: true,
      deletedAtVersion: 6,
      profileVersion: 3,
    });
    expect(w["memberProfiles/k"].mode).toBe("delete");
    expect(w["relations/r-a-k"].data).toMatchObject({
      deleted: true,
      deletedWith: "k",
      version: 4,
    });
    expect(w["relations/r-b-k"].data.version).toBe(4);
    const a = w["auditLogs/edit-6"].data;
    expect(a.event).toBe("PERSON_DELETED");
    expect(a.relationIds).toEqual(["r-a-k", "r-b-k"]);
    expect(
      JSON.parse(String((a.before as Record<string, unknown>).rows)).person,
    ).toEqual(tree().persons.k);
  });
  it("ẩn vợ/chồng: ẩn cả quan hệ vợ chồng (một)", () => {
    // b có con k nên bị chặn; dùng người lẻ có union
    const t = tree();
    t.relations = [t.relations[0]];
    const r = run(delState("b", t), del("b"));
    const w = r.writes.map((x) => x.path);
    expect(w).toContain("unions/u-a-b");
    expect(data(r).unions).toEqual([]);
  });
  it("chặn: còn con, người sáng lập chi, nhiều vợ/chồng, chưa xác nhận, sai phiên bản, đã ẩn", () => {
    expect(code(() => run(delState("a"), del("a")))).toBe("INVALID");
    expect(code(() => run(delState("ts"), del("ts")))).toBe("INVALID");
    const t = tree();
    t.relations = [t.relations[0]];
    t.unions.push(["a", "z", "2"]);
    expect(code(() => run(delState("a", t), del("a")))).toBe("INVALID");
    expect(code(() => run(delState(), del("k", false)))).toBe(
      "CONFIRM_REQUIRED",
    );
    expect(code(() => run(delState(), del("k"), 4))).toBe("VERSION_CONFLICT");
    const s = delState();
    s.person = person({ deleted: true });
    expect(code(() => run(s, del("k")))).toBe("INVALID");
    expect(code(() => run(delState(), del("khong-co")))).toBe("INVALID");
  });
  it("chặn người có hơn hai quan hệ cha/mẹ", () => {
    const t = tree();
    t.relations.push(["z", "k", "F", "A", 0]);
    expect(code(() => run(delState("k", t), del("k")))).toBe("INVALID");
  });
  it("deleteReads trả các quan hệ cha/mẹ", () => {
    expect(deleteReads(snap(tree()), "k").sort()).toEqual(["r-a-k", "r-b-k"]);
  });
});

describe("khôi phục người", () => {
  function deleted() {
    const first = run(delState(), del("k"));
    const audit = first.writes.find((w) => w.path === "auditLogs/edit-6")!.data;
    return { audit, snapshot: snap(data(first), 6) };
  }
  const restore = (): DeleteOp => ({
    type: "restorePerson",
    personId: "k",
    deleteVersion: 6,
  });
  it("khôi phục đúng hàng đã gỡ, tính lại đời, tạo lại bản thành viên", () => {
    const { audit, snapshot } = deleted();
    const r = run(
      {
        snapshot,
        person: person({
          deleted: true,
          deletedAtVersion: 6,
          profileVersion: 3,
        }),
        relations: {
          "r-a-k": { version: 4, deleted: true },
          "r-b-k": { version: 4, deleted: true },
        },
        audit,
      },
      restore(),
      6,
    );
    const d = data(r);
    expect(d.persons.k).toEqual(tree().persons.k);
    expect(d.relations).toHaveLength(3);
    const w = Object.fromEntries(r.writes.map((x) => [x.path, x]));
    expect(w["memberProfiles/k"]).toMatchObject({
      mode: "create",
      data: { profileVersion: 4, deathYear: 1990, displayName: "Giả K" },
    });
    expect(w["relations/r-a-k"].data).toMatchObject({
      deleted: false,
      version: 5,
    });
    expect(w["persons/k"].data).toMatchObject({
      deleted: false,
      profileVersion: 4,
    });
    expect(r.focusId).toBe("k");
  });
  it("từ chối: sai số phiên bản, người không bị ẩn, cha/mẹ đang không có trong cây, nhật ký không khớp", () => {
    const { audit, snapshot } = deleted();
    const base = (): DeleteState => ({
      snapshot,
      person: person({ deleted: true, deletedAtVersion: 6, profileVersion: 3 }),
      relations: {
        "r-a-k": { version: 4 },
        "r-b-k": { version: 4 },
      },
      audit,
    });
    expect(
      code(() =>
        run(base(), { ...restore(), deleteVersion: 7 } as DeleteOp, 6),
      ),
    ).toBe("INVALID");
    const s1 = base();
    s1.person = person({ profileVersion: 3 });
    expect(code(() => run(s1, restore(), 6))).toBe("INVALID");
    const t = JSON.parse(String(snapshot.data));
    delete t.persons.b;
    t.unions = [];
    const s2 = { ...base(), snapshot: snap(t, 6) };
    expect(code(() => run(s2, restore(), 6))).toBe("INVALID");
    const s3 = base();
    s3.audit = { ...audit, event: "PERSON_EDITED" };
    expect(code(() => run(s3, restore(), 6))).toBe("BAD_STATE");
    const s4 = base();
    s4.audit = { ...audit, personId: "a" };
    expect(code(() => run(s4, restore(), 6))).toBe("BAD_STATE");
  });
});
