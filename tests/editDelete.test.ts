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
  it("chặn: còn con, người sáng lập chi, chưa xác nhận, sai phiên bản, đã ẩn", () => {
    expect(code(() => run(delState("a"), del("a")))).toBe("INVALID");
    expect(code(() => run(delState("ts"), del("ts")))).toBe("INVALID");
    expect(code(() => run(delState(), del("k", false)))).toBe(
      "CONFIRM_REQUIRED",
    );
    expect(code(() => run(delState(), del("k"), 4))).toBe("VERSION_CONFLICT");
    const s = delState();
    s.person = person({ deleted: true });
    expect(code(() => run(s, del("k")))).toBe("INVALID");
    expect(code(() => run(delState(), del("khong-co")))).toBe("INVALID");
  });
  // Người lẻ z có nhiều vợ/chồng: z–a, z–b, ... (nhiều vợ/chồng là lịch sử có thật).
  const multi = (n: number) => {
    const t = tree();
    t.relations = [t.relations[0]];
    t.unions = [];
    for (let i = 0; i < n; i++) {
      const id = `v${i}`;
      (t.persons as Record<string, unknown[]>)[id] = [
        `Vợ ${i}`,
        null,
        null,
        null,
        "S",
        null,
        [],
      ];
      t.unions.push(["z", id, String(i + 1)]);
    }
    return t;
  };
  it("ẩn người có nhiều vợ/chồng: ẩn từng liên kết, nhật ký có unionId + moreUnionIds", () => {
    const r = run(delState("z", multi(3)), del("z"));
    const w = r.writes.map((x) => x.path);
    for (let i = 0; i < 3; i++) expect(w).toContain(`unions/u-v${i}-z`);
    expect(data(r).unions).toEqual([]);
    const a = r.writes.find((x) => x.path === "auditLogs/edit-6")!.data;
    expect(a.unionId).toBe("u-v0-z");
    expect(a.moreUnionIds).toEqual(["u-v1-z", "u-v2-z"]);
    const rows = JSON.parse(String((a.before as { rows: string }).rows));
    expect(rows.union).toEqual(["z", "v0", "1"]);
    expect(rows.moreUnions).toHaveLength(2);
  });
  it("ẩn được đúng 6 vợ/chồng, 7 thì chặn", () => {
    expect(
      run(delState("z", multi(6)), del("z")).writes.length,
    ).toBeGreaterThan(6);
    expect(code(() => run(delState("z", multi(7)), del("z")))).toBe("INVALID");
  });
  it("báo lỗi dữ liệu khi có hàng vợ/chồng trùng hai chiều hoặc tự nối", () => {
    const t = multi(2);
    t.unions.push(["v0", "z", "9"]);
    expect(code(() => run(delState("z", t), del("z")))).toBe("BAD_STATE");
    const u = multi(1);
    u.unions.push(["z", "z", "9"]);
    expect(code(() => run(delState("z", u), del("z")))).toBe("BAD_STATE");
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

describe("khôi phục người nhiều vợ/chồng", () => {
  const t0 = () => {
    const t = tree();
    t.relations = [t.relations[0]];
    t.unions = [];
    for (let i = 0; i < 3; i++) {
      (t.persons as Record<string, unknown[]>)[`v${i}`] = [
        `Vợ ${i}`,
        null,
        null,
        null,
        "S",
        null,
        [],
      ];
      t.unions.push(["z", `v${i}`, String(i + 1)]);
    }
    return t;
  };
  const hidden = () => {
    const first = run(delState("z", t0()), del("z"));
    return {
      audit: first.writes.find((w) => w.path === "auditLogs/edit-6")!.data,
      snapshot: snap(data(first), 6),
    };
  };
  const stateOf = (over: Partial<DeleteState> = {}): DeleteState => ({
    ...hidden(),
    person: person({ deleted: true, deletedAtVersion: 6, profileVersion: 3 }),
    relations: {},
    ...over,
  });
  const op: DeleteOp = {
    type: "restorePerson",
    personId: "z",
    deleteVersion: 6,
  };
  it("khôi phục đủ mọi liên kết vợ/chồng", () => {
    const r = run(stateOf(), op, 6);
    expect(data(r).unions).toHaveLength(3);
    const w = r.writes.map((x) => x.path);
    for (let i = 0; i < 3; i++) expect(w).toContain(`unions/u-v${i}-z`);
    const a = r.writes.find((x) => x.path === "auditLogs/edit-7")!.data;
    expect(a.unionId).toBe("u-v0-z");
    expect(a.moreUnionIds).toEqual(["u-v1-z", "u-v2-z"]);
  });
  it("từ chối nếu một vợ/chồng hiện không có trong cây, nêu rõ mã", () => {
    const h = hidden();
    const t = JSON.parse(String(h.snapshot.data));
    delete t.persons.v2;
    let message = "";
    try {
      run(stateOf({ snapshot: snap(t, 6) }), op, 6);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("v2");
  });
  it("khôi phục được từ nhật ký cũ chỉ có `union` (không có moreUnions)", () => {
    const h = hidden();
    const rows = JSON.parse(String((h.audit.before as { rows: string }).rows));
    delete rows.moreUnions;
    rows.union = ["z", "v0", "1"];
    const audit = { ...h.audit, before: { rows: JSON.stringify(rows) } };
    const r = run(stateOf({ audit }), op, 6);
    expect(data(r).unions).toHaveLength(1);
  });
  it("từ chối nhật ký có moreUnions sai hình dạng hoặc vượt 5", () => {
    const h = hidden();
    const rows = JSON.parse(String((h.audit.before as { rows: string }).rows));
    const mk = (moreUnions: unknown) => ({
      ...h.audit,
      before: { rows: JSON.stringify({ ...rows, moreUnions }) },
    });
    expect(code(() => run(stateOf({ audit: mk("x") }), op, 6))).toBe(
      "BAD_STATE",
    );
    expect(
      code(() =>
        run(stateOf({ audit: mk(Array(6).fill(["z", "v9", "1"])) }), op, 6),
      ),
    ).toBe("BAD_STATE");
    expect(
      code(() => run(stateOf({ audit: mk([["x", "y", null]]) }), op, 6)),
    ).toBe("BAD_STATE");
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
    // Giới tính lấy từ persons/k (fixture không có sex => null), không lấy từ nhật ký.
    expect(d.persons.k).toEqual([...tree().persons.k, null]);
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

describe("giới tính trong ảnh chụp", () => {
  const sexed = () => {
    const t = tree();
    for (const v of Object.values(t.persons) as unknown[][]) v.push("M");
    return t;
  };
  it("ẩn người: nhật ký vẫn giữ bộ 7 phần tử; người khác giữ phần tử 8", () => {
    const r = run(delState("k", sexed()), del("k"));
    const rows = JSON.parse(
      String(
        (
          r.writes.find((w) => w.path === "auditLogs/edit-6")!.data
            .before as Record<string, unknown>
        ).rows,
      ),
    );
    expect(rows.person).toHaveLength(7);
    expect(data(r).persons.a).toHaveLength(8);
  });
  it("khôi phục lấy giới tính từ persons, không từ nhật ký; giá trị lạ thành null", () => {
    const base = run(delState("k", sexed()), del("k"));
    const audit = base.writes.find((w) => w.path === "auditLogs/edit-6")!.data;
    const snapshot = snap(data(base), 6);
    const restoreWith = (sex: unknown) =>
      data(
        run(
          {
            snapshot,
            person: person({
              deleted: true,
              deletedAtVersion: 6,
              profileVersion: 3,
              sex,
            }),
            relations: {
              "r-a-k": { version: 4, deleted: true },
              "r-b-k": { version: 4, deleted: true },
            },
            audit,
          },
          { type: "restorePerson", personId: "k", deleteVersion: 6 },
          6,
        ),
      ).persons.k;
    expect(restoreWith("F")[7]).toBe("F");
    expect(restoreWith(undefined)[7]).toBeNull();
    expect(restoreWith("X")[7]).toBeNull();
    expect(restoreWith("F")).toHaveLength(8);
  });
});
