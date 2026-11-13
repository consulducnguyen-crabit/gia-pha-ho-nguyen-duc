import { describe, expect, it } from "vitest";
import { EditError } from "../src/editCore";
import {
  applyRelation,
  relationReads,
  type RelationOp,
  type RelationState,
} from "../src/editRelation";

const tree = {
  v: 1,
  persons: {
    ts: ["Cụ Tổ", null, null, 1, "C", "c1", []],
    a: ["Giả A", null, null, 2, "C", "c1", []],
    a2: ["Giả A2", null, null, 2, "C", "c1", []],
    a3: ["Giả A3", null, null, 3, "C", "c1", []],
    k: ["Giả K", null, null, 3, "C", "c1", []],
    g: ["Giả G", null, null, 4, "C", "c1", []],
    b: ["Vợ Giả A", null, null, null, "S", null, []],
    x: ["Họ Ngoại", null, null, null, "E", null, []],
    o: ["Giả Mồ Côi", null, null, null, "C", null, []],
    oc: ["Con Mồ Côi", null, null, null, "C", null, []],
  },
  relations: [
    ["ts", "a", "F", "B", 1],
    ["ts", "a2", "F", "B", 1],
    ["a2", "a3", "F", "B", 1],
    ["a", "k", "F", "B", 1],
    ["b", "k", "M", "B", 0],
    ["k", "g", "F", "B", 1],
    ["o", "oc", "F", "B", 1],
  ],
  unions: [["a", "b", "1"]],
  branches: { c1: ["Chi 1", "ts", null, null] },
};
function state(over: Partial<RelationState> = {}): RelationState {
  const persons: RelationState["docs"] = {};
  for (const id of Object.keys(tree.persons)) persons[id] = { sex: "M" };
  persons.b = { sex: "F" };
  return {
    snapshot: {
      schemaVersion: 1,
      dataVersion: "x",
      editVersion: 5,
      data: JSON.stringify(tree),
    },
    docs: persons,
    relations: {
      "r-a-k": { version: 1 },
      "r-b-k": { version: 1 },
      "r-a2-k": null,
      "r-a3-k": null,
      "r-a2-o": null,
      "r-b-a2": null,
      "r-x-k": null,
      "r-o-k": null,
      "r-a2-x": null,
      ...over.relations,
    },
    ...(over.snapshot ? { snapshot: over.snapshot } : {}),
    ...(over.docs ? { docs: { ...persons, ...over.docs } } : {}),
  };
}
const parent = (
  childId: string,
  parentId: string,
  over: Partial<Extract<RelationOp, { type: "setParent" }>> = {},
): RelationOp => ({
  type: "setParent",
  childId,
  role: "FATHER",
  parentId,
  adoptive: false,
  confirmReplace: false,
  ...over,
});
const run = (op: RelationOp, s = state(), expectedVersion = 5) =>
  applyRelation(s, { op, expectedVersion, actorUid: "admin" });
const byPath = (r: ReturnType<typeof run>) =>
  Object.fromEntries(r.writes.map((w) => [w.path, w]));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof EditError) return e.code;
    throw e;
  }
  return "OK";
};
const snap = (r: ReturnType<typeof run>) =>
  JSON.parse(byPath(r)["treeSnapshots/main"].data.data as string);

describe("setParent: thay cha", () => {
  it("cần xác nhận khi thay cha đang có, nêu tên người cũ", () => {
    try {
      run(parent("k", "a3"));
      throw new Error("phải ném lỗi");
    } catch (e) {
      expect(e).toBeInstanceOf(EditError);
      expect((e as EditError).code).toBe("CONFIRM_REQUIRED");
      expect((e as EditError).message).toContain("Giả A");
    }
  });

  it("thay cha: ẩn quan hệ cũ, tạo quan hệ mới, tính lại đời cả nhánh, ghi nhật ký", () => {
    const r = run(parent("k", "a3", { confirmReplace: true }));
    const w = byPath(r);
    expect(r.nextVersion).toBe(6);
    expect(w["relations/r-a-k"]).toMatchObject({
      mode: "merge",
      data: {
        deleted: true,
        replacedBy: "r-a3-k",
        version: 2,
        deletedBy: "admin",
      },
    });
    expect(w["relations/r-a3-k"]).toMatchObject({
      mode: "create",
      data: {
        parentId: "a3",
        parentRole: "FATHER",
        lineageTransmission: true,
        version: 1,
        sourceRefs: ["auditLogs/edit-6"],
      },
    });
    const d = snap(r);
    expect(d.relations).not.toContainEqual(["a", "k", "F", "B", 1]);
    expect(d.relations).toContainEqual(["a3", "k", "F", "B", 1]);
    expect(d.persons.k[3]).toBe(4);
    expect(d.persons.g[3]).toBe(5);
    expect(d.persons.a[3]).toBe(2);
    expect(w["auditLogs/edit-6"].data).toMatchObject({
      event: "PARENT_CHANGED",
      personId: "k",
      relationIds: ["r-a3-k"],
      removedRelationIds: ["r-a-k"],
      before: {
        removed: { parentId: "a", role: "FATHER", relationType: "BIOLOGICAL" },
      },
    });
  });

  it("chống vòng lặp và thủy tổ không có cha", () => {
    expect(code(() => run(parent("a", "g", { confirmReplace: true })))).toBe(
      "INVALID",
    );
    expect(code(() => run(parent("ts", "a2", { confirmReplace: true })))).toBe(
      "INVALID",
    );
    expect(code(() => run(parent("k", "k")))).toBe("INVALID");
  });

  it("nối người dòng họ chưa có đời (mồ côi) vào cây: tính lại đời cho cả nhánh", () => {
    const r = run(parent("o", "a2"));
    const d = snap(r);
    expect(d.persons.o[3]).toBe(3);
    expect(d.persons.oc[3]).toBe(4);
    expect(
      Object.keys(byPath(r)).some((k) => k.startsWith("relations/r-a-")),
    ).toBe(false);
  });

  it("người dòng họ chỉ có cha thuộc dòng họ đã nối tới thủy tổ", () => {
    expect(code(() => run(parent("k", "x", { confirmReplace: true })))).toBe(
      "INVALID",
    );
    expect(code(() => run(parent("k", "o", { confirmReplace: true })))).toBe(
      "INVALID",
    );
  });

  it("từ chối cùng cha, cha là nữ, quan hệ từng có", () => {
    expect(code(() => run(parent("k", "a", { confirmReplace: true })))).toBe(
      "INVALID",
    );
    expect(code(() => run(parent("a3", "b")))).toBe("INVALID");
    expect(
      code(() =>
        run(
          parent("k", "a3", { confirmReplace: true }),
          state({ relations: { "r-a3-k": { version: 1, deleted: true } } }),
        ),
      ),
    ).toBe("INVALID");
  });
});

describe("setParent: đặt mẹ", () => {
  it("thêm mẹ khi chưa có: không ẩn gì, không đổi đời, không truyền dòng", () => {
    const r = run(parent("a2", "b", { role: "MOTHER" }));
    const w = byPath(r);
    expect(w["relations/r-b-a2"].data).toMatchObject({
      parentRole: "MOTHER",
      lineageTransmission: false,
    });
    expect(
      Object.values(w).some(
        (x) => x.mode === "merge" && x.path.startsWith("relations/"),
      ),
    ).toBe(false);
    expect(snap(r).persons.a2[3]).toBe(2);
    expect(w["auditLogs/edit-6"].data).toMatchObject({
      removedRelationIds: [],
    });
  });
  it("từ chối mẹ là nam", () => {
    expect(
      code(() =>
        run(
          parent("a2", "b", { role: "MOTHER" }),
          state({ docs: { b: { sex: "M" } } }),
        ),
      ),
    ).toBe("INVALID");
  });
  it("thay mẹ cần xác nhận", () => {
    const s = state({ docs: { x: { sex: "F" } } });
    expect(code(() => run(parent("k", "x", { role: "MOTHER" }), s))).toBe(
      "CONFIRM_REQUIRED",
    );
    const r = run(
      parent("k", "x", { role: "MOTHER", confirmReplace: true }),
      s,
    );
    expect(byPath(r)["relations/r-b-k"].data).toMatchObject({ deleted: true });
  });
});

describe("setRelationType", () => {
  const type = (
    adoptive: boolean,
    parentId = "a",
    childId = "k",
  ): RelationOp => ({
    type: "setRelationType",
    parentId,
    childId,
    adoptive,
  });
  it("đổi sang con nuôi: cập nhật phiên bản, snapshot, nhật ký; đời không đổi", () => {
    const r = run(type(true));
    const w = byPath(r);
    expect(w["relations/r-a-k"].data).toMatchObject({
      relationType: "ADOPTIVE",
      version: 2,
      updatedBy: "admin",
    });
    expect(snap(r).relations).toContainEqual(["a", "k", "F", "A", 1]);
    expect(snap(r).persons.k[3]).toBe(3);
    expect(w["auditLogs/edit-6"].data).toMatchObject({
      event: "RELATION_TYPE_CHANGED",
      relationIds: ["r-a-k"],
      before: { relationType: "BIOLOGICAL" },
      after: { relationType: "ADOPTIVE" },
    });
  });
  it("không đổi, không có quan hệ, thiếu tài liệu", () => {
    expect(code(() => run(type(false)))).toBe("NO_CHANGE");
    expect(code(() => run(type(true, "a2", "k")))).toBe("NOT_FOUND");
    expect(
      code(() => run(type(true), state({ relations: { "r-a-k": null } }))),
    ).toBe("BAD_STATE");
  });
});

describe("bổ sung từ phản biện", () => {
  it("vòng lặp chỉ qua cạnh mẹ vẫn bị chặn", () => {
    expect(
      code(() =>
        run(
          parent("a", "g", { role: "MOTHER" }),
          state({ docs: { g: { sex: "F" } } }),
        ),
      ),
    ).toBe("INVALID");
  });
  it("người họ ngoại/vợ chồng nhận cha dòng họ: không truyền dòng, đời vẫn null", () => {
    const r = run(parent("x", "a2"));
    expect(byPath(r)["relations/r-a2-x"].data).toMatchObject({
      lineageTransmission: false,
    });
    expect(snap(r).persons.x[3]).toBeNull();
  });
  it("chọn làm CHA đúng người đang là MẸ: báo rõ", () => {
    try {
      run(parent("k", "b"), state({ docs: { b: { sex: null } } }));
      throw new Error("phải ném lỗi");
    } catch (e) {
      expect((e as EditError).message).toContain("vai trò khác");
    }
  });
  it("đổi loại con theo cả hai chiều; thiếu version báo BAD_STATE", () => {
    const adopted = JSON.parse(JSON.stringify(tree));
    adopted.relations[3][3] = "A";
    const s = state({
      snapshot: {
        schemaVersion: 1,
        dataVersion: "x",
        editVersion: 5,
        data: JSON.stringify(adopted),
      },
    });
    const r = run(
      { type: "setRelationType", parentId: "a", childId: "k", adoptive: false },
      s,
    );
    expect(snap(r).relations).toContainEqual(["a", "k", "F", "B", 1]);
    expect(
      code(() =>
        run(
          {
            type: "setRelationType",
            parentId: "a",
            childId: "k",
            adoptive: true,
          },
          state({ relations: { "r-a-k": {} } }),
        ),
      ),
    ).toBe("BAD_STATE");
  });
  it("không có đúng một thủy tổ có đời thì không tính được đời", () => {
    const two = JSON.parse(JSON.stringify(tree));
    two.persons.o[3] = 1; // thêm gốc thứ hai có đời
    const s = state({
      snapshot: {
        schemaVersion: 1,
        dataVersion: "x",
        editVersion: 5,
        data: JSON.stringify(two),
      },
    });
    expect(code(() => run(parent("a2", "b", { role: "MOTHER" }), s))).toBe(
      "BAD_STATE",
    );
  });
});

describe("chung", () => {
  it("khóa phiên bản và không sửa trạng thái đầu vào", () => {
    expect(
      code(() => run(parent("a2", "b", { role: "MOTHER" }), state(), 4)),
    ).toBe("VERSION_CONFLICT");
    const s = state();
    const before = JSON.stringify(s);
    run(parent("k", "a3", { confirmReplace: true }), s);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("relationReads tìm quan hệ cũ cùng vai trò", () => {
    expect(
      relationReads(state().snapshot, parent("k", "a3")).relations.sort(),
    ).toEqual(["r-a-k", "r-a3-k"]);
    expect(
      relationReads(state().snapshot, parent("a2", "b", { role: "MOTHER" }))
        .relations,
    ).toEqual(["r-b-a2"]);
  });
});

describe("revertParent (hoàn tác lần thay cha/mẹ gần nhất)", () => {
  // Thay cha của k từ a sang a3 (edit-6), rồi dựng trạng thái sau đó để hoàn tác.
  function afterReplace(tweak: (s: RelationState) => void = () => {}) {
    const replaced = run(parent("k", "a3", { confirmReplace: true }));
    const auditData = replaced.writes.find(
      (w) => w.path === "auditLogs/edit-6",
    )!.data as Record<string, unknown>;
    const s = state({
      snapshot: {
        schemaVersion: 1,
        dataVersion: "x",
        editVersion: 6,
        data: String(
          (
            replaced.writes.find((w) => w.path === "treeSnapshots/main")!
              .data as {
              data: string;
            }
          ).data,
        ),
      },
    });
    s.relations = {
      "r-a3-k": {
        version: 1,
        parentRole: "FATHER",
        relationType: "BIOLOGICAL",
        lineageTransmission: true,
        sourceRefs: ["auditLogs/edit-6"],
      },
      "r-a-k": {
        version: 2,
        deleted: true,
        replacedBy: "r-a3-k",
        parentRole: "FATHER",
        relationType: "BIOLOGICAL",
        lineageTransmission: true,
      },
    };
    s.audit = auditData;
    tweak(s);
    return s;
  }
  const revert = (
    over: Partial<Extract<RelationOp, { type: "revertParent" }>> = {},
  ): RelationOp => ({
    type: "revertParent",
    childId: "k",
    role: "FATHER",
    parentId: "a",
    changeVersion: 6,
    ...over,
  });
  const go = (s: RelationState, op = revert(), v = 6) => run(op, s, v);

  it("đảo đúng hai quan hệ, tính lại đời, ghi nhật ký PARENT_REVERTED", () => {
    const r = go(afterReplace());
    const w = byPath(r);
    expect(w["relations/r-a-k"].data).toMatchObject({
      deleted: false,
      replacedBy: null,
      version: 3,
    });
    expect(w["relations/r-a3-k"].data).toMatchObject({
      deleted: true,
      revertedAtVersion: 7,
      version: 2,
    });
    expect(w["auditLogs/edit-7"].data).toMatchObject({
      event: "PARENT_REVERTED",
      relationIds: ["r-a-k"],
      removedRelationIds: ["r-a3-k"],
      revertsVersion: 6,
      unionId: null,
    });
    const data = JSON.parse(
      String((w["treeSnapshots/main"].data as { data: string }).data),
    );
    expect(data.relations).toContainEqual(["a", "k", "F", "B", 1]);
    expect(data.relations).not.toContainEqual(["a3", "k", "F", "B", 1]);
    expect(data.persons.k[3]).toBe(3);
    expect(data.persons.g[3]).toBe(4);
    expect(r.nextVersion).toBe(7);
  });

  it("từ chối khi không phải lần thay gần nhất hoặc nhật ký/quan hệ không khớp", () => {
    expect(
      code(() =>
        go(
          afterReplace(
            (s) => (s.audit = { ...s.audit!, event: "PERSON_EDITED" }),
          ),
        ),
      ),
    ).toBe("BAD_STATE");
    expect(
      code(() =>
        go(afterReplace((s) => (s.audit = { ...s.audit!, personId: "g" }))),
      ),
    ).toBe("BAD_STATE");
    expect(
      code(() =>
        go(
          afterReplace((s) => {
            s.relations["r-a3-k"] = {
              ...s.relations["r-a3-k"],
              sourceRefs: ["auditLogs/edit-9"],
            };
          }),
        ),
      ),
    ).toBe("BAD_STATE");
    expect(
      code(() =>
        go(
          afterReplace((s) => {
            s.relations["r-a-k"] = { ...s.relations["r-a-k"], deleted: false };
          }),
        ),
      ),
    ).toBe("BAD_STATE");
    expect(
      code(() =>
        go(
          afterReplace((s) => {
            s.relations["r-a-k"] = {
              ...s.relations["r-a-k"],
              replacedBy: "r-khac-k",
            };
          }),
        ),
      ),
    ).toBe("BAD_STATE");
    expect(
      code(() =>
        go(
          afterReplace((s) => {
            s.relations["r-a-k"] = {
              ...s.relations["r-a-k"],
              relationType: "ADOPTIVE",
            };
          }),
        ),
      ),
    ).toBe("BAD_STATE");
    expect(code(() => go(afterReplace((s) => (s.audit = null))))).toBe(
      "BAD_STATE",
    );
    expect(code(() => go(afterReplace(), revert({ changeVersion: 5 })))).toBe(
      "BAD_STATE",
    );
  });

  it("từ chối: số phiên bản sai, cha cũ/con bị ẩn hoặc vắng, giới tính trái, vai trò khác, vòng lặp", () => {
    expect(code(() => go(afterReplace(), revert({ changeVersion: 0 })))).toBe(
      "INVALID",
    );
    expect(code(() => go(afterReplace(), revert({ changeVersion: 99 })))).toBe(
      "INVALID",
    );
    expect(
      code(() =>
        go(afterReplace((s) => (s.docs.a = { sex: "M", deleted: true }))),
      ),
    ).toBe("INVALID");
    expect(
      code(() =>
        go(afterReplace((s) => (s.docs.k = { sex: "M", deleted: true }))),
      ),
    ).toBe("INVALID");
    expect(
      code(() => go(afterReplace(), revert({ parentId: "khong-co" }))),
    ).toBe("INVALID");
    expect(code(() => go(afterReplace((s) => (s.docs.a = { sex: "F" }))))).toBe(
      "INVALID",
    );
    expect(code(() => go(afterReplace(), revert({ role: "MOTHER" })))).toBe(
      "BAD_STATE",
    );
    expect(
      code(() =>
        go(
          afterReplace((s) => {
            const d = JSON.parse(String(s.snapshot.data));
            d.relations.push(["k", "a", "M", "B", 0]);
            s.snapshot = { ...s.snapshot, data: JSON.stringify(d) };
          }),
        ),
      ),
    ).toBe("INVALID");
  });

  it("khóa phiên bản, relationReads trả quan hệ cũ + hiện tại + nhật ký, không sửa đầu vào", () => {
    expect(code(() => go(afterReplace(), revert(), 5))).toBe(
      "VERSION_CONFLICT",
    );
    const s = afterReplace();
    const reads = relationReads(s.snapshot, revert());
    expect(reads.relations.sort()).toEqual(["r-a-k", "r-a3-k"]);
    expect(reads.audit).toBe("edit-6");
    const before = JSON.stringify(s);
    go(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("chuỗi hai lần thay: chỉ hoàn tác được lần mới nhất", () => {
    // k: a -> a3 (edit-6) rồi a3 -> a2 (edit-7). Hoàn tác edit-6 khi quan hệ hiện tại do edit-7 tạo ra bị từ chối.
    const first = afterReplace();
    const second = run(
      parent("k", "a2", { confirmReplace: true }),
      {
        ...first,
        relations: { ...first.relations, "r-a2-k": null },
        docs: first.docs,
      },
      6,
    );
    const s = state({
      snapshot: {
        schemaVersion: 1,
        dataVersion: "x",
        editVersion: 7,
        data: String(
          (
            second.writes.find((w) => w.path === "treeSnapshots/main")!
              .data as {
              data: string;
            }
          ).data,
        ),
      },
    });
    s.relations = {
      "r-a2-k": {
        version: 1,
        parentRole: "FATHER",
        relationType: "BIOLOGICAL",
        lineageTransmission: true,
        sourceRefs: ["auditLogs/edit-7"],
      },
      "r-a-k": first.relations["r-a-k"],
    };
    s.audit = first.audit;
    expect(code(() => go(s, revert({ changeVersion: 6 }), 7))).toBe(
      "BAD_STATE",
    );
  });
});

describe("removeParent (gỡ quan hệ cha/mẹ nhập sai)", () => {
  const motherDoc = {
    version: 1,
    parentRole: "MOTHER",
    relationType: "BIOLOGICAL",
    lineageTransmission: false,
  };
  const fatherDoc = {
    version: 1,
    parentRole: "FATHER",
    relationType: "BIOLOGICAL",
    lineageTransmission: true,
  };
  const remove = (
    over: Partial<Extract<RelationOp, { type: "removeParent" }>> = {},
  ): RelationOp => ({
    type: "removeParent",
    childId: "k",
    role: "MOTHER",
    parentId: "b",
    confirm: true,
    ...over,
  });
  const withMother = (extra: Record<string, unknown> = {}) =>
    state({ relations: { "r-b-k": { ...motherDoc, ...extra } } });

  it("gỡ mẹ: ẩn quan hệ, bỏ dòng snapshot, không đổi đời, ghi nhật ký PARENT_REMOVED", () => {
    const r = run(remove(), withMother({ deletedWith: "b" }));
    const w = byPath(r);
    expect(r.nextVersion).toBe(6);
    expect(w["relations/r-b-k"]).toMatchObject({
      mode: "merge",
      data: {
        deleted: true,
        deletedBy: "admin",
        deletedWith: null,
        removedAtVersion: 6,
        version: 2,
      },
    });
    const d = snap(r);
    expect(d.relations).not.toContainEqual(["b", "k", "M", "B", 0]);
    expect(d.persons.k[3]).toBe(3);
    expect(d.persons.g[3]).toBe(4);
    expect(w["auditLogs/edit-6"].data).toMatchObject({
      event: "PARENT_REMOVED",
      personId: "k",
      createdPersonIds: [],
      relationIds: [],
      removedRelationIds: ["r-b-k"],
      unionId: null,
      fields: ["parent"],
      before: {
        removed: {
          parentId: "b",
          role: "MOTHER",
          relationType: "BIOLOGICAL",
          lineageTransmission: false,
        },
      },
      after: { removed: true },
    });
    expect(Object.keys(w).sort()).toEqual([
      "auditLogs/edit-6",
      "relations/r-b-k",
      "treeSnapshots/main",
    ]);
  });

  it("thiếu xác nhận, cha theo dòng, không có quan hệ", () => {
    expect(code(() => run(remove({ confirm: false }), withMother()))).toBe(
      "CONFIRM_REQUIRED",
    );
    expect(
      code(() =>
        run(
          remove({ role: "FATHER", parentId: "a" }),
          state({ relations: { "r-a-k": fatherDoc } }),
        ),
      ),
    ).toBe("INVALID");
    expect(code(() => run(remove({ parentId: "a2" }), withMother()))).toBe(
      "NOT_FOUND",
    );
    // đúng người nhưng sai vai trò
    expect(code(() => run(remove({ role: "FATHER" }), withMother()))).toBe(
      "NOT_FOUND",
    );
  });

  it("tài liệu quan hệ lệch ảnh chụp: BAD_STATE", () => {
    for (const extra of [
      { deleted: true },
      { replacedBy: "r-x-k" },
      { relationType: "ADOPTIVE" },
      { removedAtVersion: 3 },
      { parentRole: "FATHER" },
      { lineageTransmission: null },
    ])
      expect(code(() => run(remove(), withMother(extra)))).toBe("BAD_STATE");
    expect(
      code(() => run(remove(), state({ relations: { "r-b-k": null } }))),
    ).toBe("BAD_STATE");
    expect(
      code(() => run(remove(), withMother({ lineageTransmission: true }))),
    ).toBe("INVALID");
  });

  it("khóa phiên bản; người bị ẩn; không sửa đầu vào", () => {
    expect(code(() => run(remove(), withMother(), 4))).toBe("VERSION_CONFLICT");
    const hidden = withMother();
    hidden.docs.b = { sex: "F", deleted: true };
    expect(code(() => run(remove(), hidden))).toBe("INVALID");
    const s = withMother();
    const before = JSON.stringify(s);
    run(remove(), s);
    expect(JSON.stringify(s)).toBe(before);
    expect(relationReads(s.snapshot, remove())).toEqual({
      persons: ["b", "k"],
      relations: ["r-b-k"],
    });
  });
});

describe("restoreRemovedParent (khôi phục việc gỡ cha/mẹ)", () => {
  // Gỡ mẹ b của k (edit-6) rồi dựng trạng thái sau đó.
  function afterRemove(tweak: (s: RelationState) => void = () => {}) {
    const removed = run(
      {
        type: "removeParent",
        childId: "k",
        role: "MOTHER",
        parentId: "b",
        confirm: true,
      },
      state({
        relations: {
          "r-b-k": {
            version: 1,
            parentRole: "MOTHER",
            relationType: "BIOLOGICAL",
            lineageTransmission: false,
          },
        },
      }),
    );
    const s = state({
      snapshot: {
        schemaVersion: 1,
        dataVersion: "x",
        editVersion: 6,
        data: String(
          (
            removed.writes.find((w) => w.path === "treeSnapshots/main")!
              .data as { data: string }
          ).data,
        ),
      },
    });
    s.relations = {
      "r-b-k": {
        version: 2,
        deleted: true,
        deletedWith: null,
        removedAtVersion: 6,
        parentRole: "MOTHER",
        relationType: "BIOLOGICAL",
        lineageTransmission: false,
      },
    };
    s.audit = removed.writes.find((w) => w.path === "auditLogs/edit-6")!
      .data as Record<string, unknown>;
    tweak(s);
    return s;
  }
  const restore = (
    over: Partial<Extract<RelationOp, { type: "restoreRemovedParent" }>> = {},
  ): RelationOp => ({
    type: "restoreRemovedParent",
    childId: "k",
    role: "MOTHER",
    parentId: "b",
    removeVersion: 6,
    ...over,
  });
  const go = (s: RelationState, op = restore(), v = 6) => run(op, s, v);
  const patchRel = (s: RelationState, extra: Record<string, unknown>) => {
    s.relations["r-b-k"] = { ...s.relations["r-b-k"], ...extra };
  };
  const addRow = (s: RelationState, row: unknown[]) => {
    const d = JSON.parse(String(s.snapshot.data));
    d.relations.push(row);
    s.snapshot = { ...s.snapshot, data: JSON.stringify(d) };
  };

  it("đưa quan hệ lại: dòng snapshot, xóa dấu gỡ, nhật ký PARENT_REMOVAL_UNDONE, không đổi đời", () => {
    const r = go(afterRemove());
    const w = byPath(r);
    expect(r.nextVersion).toBe(7);
    expect(w["relations/r-b-k"].data).toMatchObject({
      deleted: false,
      removedAtVersion: null,
      restoredBy: "admin",
      version: 3,
    });
    const d = snap(r);
    expect(d.relations).toContainEqual(["b", "k", "M", "B", 0]);
    expect(d.persons.k[3]).toBe(3);
    expect(w["auditLogs/edit-7"].data).toMatchObject({
      event: "PARENT_REMOVAL_UNDONE",
      relationIds: ["r-b-k"],
      removedRelationIds: [],
      revertsVersion: 6,
      unionId: null,
    });
  });

  it("mẹ ruột đã gỡ vẫn khôi phục được khi người con đang có mẹ nuôi (chỉ chặn trùng cả vai trò lẫn loại)", () => {
    const r = go(afterRemove((s) => addRow(s, ["x", "k", "M", "A", 0])));
    expect(snap(r).relations).toContainEqual(["b", "k", "M", "B", 0]);
  });

  it("từ chối: chỗ mẹ đã có người, vòng lặp, giới tính trái", () => {
    expect(
      code(() => go(afterRemove((s) => addRow(s, ["x", "k", "M", "B", 0])))),
    ).toBe("INVALID");
    expect(
      code(() => go(afterRemove((s) => addRow(s, ["k", "b", "F", "B", 0])))),
    ).toBe("INVALID");
    expect(code(() => go(afterRemove((s) => (s.docs.b = { sex: "M" }))))).toBe(
      "INVALID",
    );
  });

  it("từ chối: nhật ký sai, quan hệ không ở trạng thái đã gỡ, người bị ẩn", () => {
    expect(
      code(() =>
        go(
          afterRemove(
            (s) => (s.audit = { ...s.audit!, event: "PARENT_CHANGED" }),
          ),
        ),
      ),
    ).toBe("BAD_STATE");
    expect(
      code(() =>
        go(afterRemove((s) => (s.audit = { ...s.audit!, personId: "g" }))),
      ),
    ).toBe("BAD_STATE");
    expect(code(() => go(afterRemove((s) => (s.audit = null))))).toBe(
      "BAD_STATE",
    );
    expect(code(() => go(afterRemove(), restore({ removeVersion: 5 })))).toBe(
      "BAD_STATE",
    );
    for (const extra of [
      { deleted: false },
      { removedAtVersion: 3 },
      { removedAtVersion: null },
      { replacedBy: "r-x-k" },
      { revertedAtVersion: 4 },
      { deletedWith: "b" },
      { relationType: "ADOPTIVE" },
      { lineageTransmission: true },
    ])
      expect(code(() => go(afterRemove((s) => patchRel(s, extra))))).toBe(
        "BAD_STATE",
      );
    expect(
      code(() =>
        go(afterRemove((s) => (s.docs.b = { sex: "F", deleted: true }))),
      ),
    ).toBe("INVALID");
    expect(
      code(() =>
        go(afterRemove((s) => (s.docs.k = { sex: "M", deleted: true }))),
      ),
    ).toBe("INVALID");
    expect(code(() => go(afterRemove(), restore({ removeVersion: 0 })))).toBe(
      "INVALID",
    );
    expect(code(() => go(afterRemove(), restore({ removeVersion: 99 })))).toBe(
      "INVALID",
    );
  });

  it("khóa phiên bản; relationReads trả quan hệ + nhật ký; không sửa đầu vào", () => {
    expect(code(() => go(afterRemove(), restore(), 5))).toBe(
      "VERSION_CONFLICT",
    );
    const s = afterRemove();
    expect(relationReads(s.snapshot, restore())).toEqual({
      persons: ["b", "k"],
      relations: ["r-b-k"],
      audit: "edit-6",
    });
    const before = JSON.stringify(s);
    go(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("giới tính trong ảnh chụp", () => {
  it("đổi cha giữ nguyên phần tử thứ 8 của mọi người (kể cả khi tính lại đời)", () => {
    const sexed = structuredClone(tree) as typeof tree;
    for (const v of Object.values(sexed.persons) as unknown[][]) v.push("M");
    const s = state({
      snapshot: {
        schemaVersion: 1,
        dataVersion: "x",
        editVersion: 5,
        data: JSON.stringify(sexed),
      },
    });
    const r = run(parent("k", "a3", { confirmReplace: true }), s);
    for (const t of Object.values(snap(r).persons) as unknown[][]) {
      expect(t).toHaveLength(8);
      expect(t[7]).toBe("M");
    }
  });
});
