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
