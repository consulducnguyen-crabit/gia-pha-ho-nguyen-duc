// Kiểm tra hàm thuần gỡ/khôi phục liên kết vợ/chồng (editUnion). Dữ liệu giả.
import { describe, expect, it } from "vitest";
import { EditError, SERVER_TIME } from "../src/editCore";
import {
  applyUnion,
  removalImpact,
  unionIdOf,
  unionReads,
  type UnionOp,
  type UnionState,
} from "../src/editUnion";
import { buildIndex, parseSnapshot } from "../src/treeModel";

const tree = {
  v: 1,
  persons: {
    ts: ["Cụ Tổ", null, null, 1, "C", "c1", []],
    a: ["Giả A", null, null, 2, "C", "c1", []],
    b: ["Vợ Giả A", null, null, null, "S", null, []],
    c: ["Vợ Hai Giả A", null, null, null, "S", null, []],
    k: ["Giả K", null, null, 3, "C", "c1", []],
  },
  relations: [
    ["ts", "a", "F", "B", 1],
    ["a", "k", "F", "B", 1],
    ["b", "k", "M", "B", 0],
  ],
  unions: [
    ["a", "b", "1"],
    ["a", "c", null],
  ],
  branches: { c1: ["Chi 1", "ts", null, null] },
};
const snapshotDoc = (data: unknown = tree, editVersion = 5) => ({
  schemaVersion: 1,
  dataVersion: "x",
  editVersion,
  data: JSON.stringify(data),
});
const people = () =>
  Object.fromEntries(Object.keys(tree.persons).map((id) => [id, { sex: "M" }]));
function state(over: Partial<UnionState> = {}): UnionState {
  return {
    snapshot: snapshotDoc(),
    docs: people(),
    union: { partnerIds: ["a", "b"], order: "1", status: null, note: null },
    ...over,
  };
}
const remove = (
  over: Partial<Extract<UnionOp, { type: "removeUnion" }>> = {},
) =>
  ({
    type: "removeUnion",
    personId: "a",
    spouseId: "b",
    confirm: true,
    ...over,
  }) as UnionOp;
const restore = (
  removeVersion = 6,
  personId = "a",
  spouseId = "b",
): UnionOp => ({
  type: "restoreRemovedUnion",
  personId,
  spouseId,
  removeVersion,
});
const run = (op: UnionOp, s = state(), expectedVersion = 5) =>
  applyUnion(s, { op, expectedVersion, actorUid: "admin" });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof EditError) return e.code;
    throw e;
  }
  return "OK";
};
const byPath = (r: ReturnType<typeof run>) =>
  Object.fromEntries(r.writes.map((w) => [w.path, w]));
const rows = (r: ReturnType<typeof run>) =>
  JSON.parse(byPath(r)["treeSnapshots/main"].data.data as string);

// Trạng thái sau khi gỡ a–b ở phiên bản 6 (nhật ký edit-6 do người xem là "a" ghi).
function removedState(): UnionState {
  const t = { ...tree, unions: [["a", "c", null]] };
  return {
    snapshot: snapshotDoc(t, 6),
    docs: people(),
    union: {
      partnerIds: ["a", "b"],
      order: "1",
      deleted: true,
      removedAtVersion: 6,
      deletedWith: null,
    },
    audit: {
      event: "UNION_REMOVED",
      editVersion: 6,
      personId: "a",
      unionId: "u-a-b",
      before: { removed: { spouseId: "b", order: "1" } },
    },
  };
}

describe("gỡ liên kết vợ/chồng", () => {
  it("ba lô ghi: liên kết ẩn + dấu gỡ, snapshot bỏ dòng, nhật ký UNION_REMOVED", () => {
    const r = run(remove());
    expect(r.writes.map((w) => w.path).sort()).toEqual([
      "auditLogs/edit-6",
      "treeSnapshots/main",
      "unions/u-a-b",
    ]);
    const w = byPath(r);
    expect(w["unions/u-a-b"].data).toEqual({
      deleted: true,
      deletedAt: SERVER_TIME,
      deletedBy: "admin",
      deletedWith: null,
      removedAtVersion: 6,
    });
    expect(w["treeSnapshots/main"].data.editVersion).toBe(6);
    expect(rows(r).unions).toEqual([["a", "c", null]]);
    expect(w["auditLogs/edit-6"].data).toMatchObject({
      event: "UNION_REMOVED",
      personId: "a",
      target: "persons/a",
      unionId: "u-a-b",
      moreUnionIds: [],
      relationIds: [],
      removedRelationIds: [],
      createdPersonIds: [],
      revertsVersion: null,
      before: { removed: { spouseId: "b", order: "1" } },
    });
    expect(r.focusId).toBe("a");
  });

  it("đời và quan hệ cha/mẹ trong snapshot không đổi, chỉ bỏ đúng một dòng union", () => {
    const after = rows(run(remove()));
    expect(after.persons).toEqual(tree.persons);
    expect(after.relations).toEqual(tree.relations);
    expect(after.branches).toEqual(tree.branches);
  });

  it("nhận người xem là người kia (b gỡ a): cùng liên kết", () => {
    const r = run(remove({ personId: "b", spouseId: "a" }));
    expect(byPath(r)["unions/u-a-b"]).toBeDefined();
    expect(byPath(r)["auditLogs/edit-6"].data).toMatchObject({
      personId: "b",
      before: { removed: { spouseId: "a", order: "1" } },
    });
  });

  it("thiếu xác nhận bị từ chối và không ghi gì", () => {
    expect(code(() => run(remove({ confirm: false })))).toBe(
      "CONFIRM_REQUIRED",
    );
    expect(
      code(() => run(remove({ confirm: undefined as unknown as boolean }))),
    ).toBe("CONFIRM_REQUIRED");
  });

  it("liên kết không có trong cây hoặc người không có trong cây", () => {
    expect(
      code(() =>
        run(
          remove({ spouseId: "k" }),
          state({ union: { partnerIds: ["a", "k"] } }),
        ),
      ),
    ).toBe("NOT_FOUND");
    expect(code(() => run(remove({ spouseId: "zz" })))).toBe("INVALID");
    expect(code(() => run(remove({ spouseId: "a" })))).toBe("INVALID");
    expect(code(() => run(remove({ spouseId: "bad id!" })))).toBe("INVALID");
  });

  it("lệch snapshot: tài liệu thiếu, đã ẩn, đã có dấu gỡ, partnerIds hay thứ tự khác", () => {
    expect(code(() => run(remove(), state({ union: null })))).toBe("BAD_STATE");
    for (const extra of [
      { deleted: true },
      { removedAtVersion: 3 },
      { order: "2" },
      { partnerIds: ["a", "c"] },
    ])
      expect(
        code(() =>
          run(
            remove(),
            state({
              union: { partnerIds: ["a", "b"], order: "1", ...extra },
            }),
          ),
        ),
      ).toBe("BAD_STATE");
  });

  it("liên kết hiện còn deletedWith cũ (sau khi ẩn/khôi phục người) vẫn gỡ được và được xóa dấu đó", () => {
    const r = run(
      remove(),
      state({
        union: {
          partnerIds: ["a", "b"],
          order: "1",
          deleted: false,
          deletedWith: "a",
        },
      }),
    );
    expect(byPath(r)["unions/u-a-b"].data.deletedWith).toBeNull();
  });

  it("dòng union bị trùng trong snapshot là BAD_STATE", () => {
    const dup = { ...tree, unions: [...tree.unions, ["b", "a", "1"]] };
    expect(
      code(() => run(remove(), state({ snapshot: snapshotDoc(dup) }))),
    ).toBe("BAD_STATE");
  });

  it("người đang bị ẩn thì không gỡ được", () => {
    const docs = { ...people(), b: { deleted: true } };
    expect(code(() => run(remove(), state({ docs })))).toBe("INVALID");
  });

  it("sai phiên bản kỳ vọng là VERSION_CONFLICT", () => {
    expect(code(() => run(remove(), state(), 4))).toBe("VERSION_CONFLICT");
  });

  it("loại thao tác lạ, thiếu người thực hiện", () => {
    expect(
      code(() => run({ type: "x", personId: "a", spouseId: "b" } as never)),
    ).toBe("INVALID");
    expect(
      code(() =>
        applyUnion(state(), { op: remove(), expectedVersion: 5, actorUid: "" }),
      ),
    ).toBe("INVALID");
  });
});

describe("khôi phục liên kết đã gỡ", () => {
  it("đưa dòng về snapshot, xóa dấu gỡ, nhật ký UNION_REMOVAL_UNDONE, không đổi đời", () => {
    const r = run(restore(), removedState(), 6);
    const w = byPath(r);
    expect(w["unions/u-a-b"].data).toEqual({
      deleted: false,
      removedAtVersion: null,
      restoredAt: SERVER_TIME,
      restoredBy: "admin",
    });
    const after = rows(r);
    expect(after.unions).toEqual([
      ["a", "c", null],
      ["a", "b", "1"],
    ]);
    expect(after.persons).toEqual(tree.persons);
    expect(w["auditLogs/edit-7"].data).toMatchObject({
      event: "UNION_REMOVAL_UNDONE",
      unionId: "u-a-b",
      personId: "a",
      revertsVersion: 6,
      relationIds: [],
      moreUnionIds: [],
      after: { spouseId: "b", order: "1" },
    });
  });

  it("khôi phục từ hồ sơ của người kia (b khôi phục a)", () => {
    const r = run(restore(6, "b", "a"), removedState(), 6);
    expect(byPath(r)["auditLogs/edit-7"].data).toMatchObject({
      personId: "b",
      after: { spouseId: "a", order: "1" },
    });
  });

  it("khi người kia đang bị ẩn thì từ chối", () => {
    const s = removedState();
    s.docs = { ...people(), b: { deleted: true } };
    expect(code(() => run(restore(), s, 6))).toBe("INVALID");
    // Người kia không còn trong snapshot (đã ẩn cùng cây).
    const t = JSON.parse(s.snapshot.data as string);
    delete t.persons.b;
    s.snapshot = snapshotDoc(t, 6);
    expect(code(() => run(restore(), s, 6))).toBe("INVALID");
  });

  it("sai phiên bản gỡ, nhật ký không phải UNION_REMOVED hoặc của cặp khác", () => {
    expect(code(() => run(restore(5), removedState(), 6))).toBe("BAD_STATE");
    expect(code(() => run(restore(0), removedState(), 6))).toBe("INVALID");
    expect(code(() => run(restore(9), removedState(), 6))).toBe("INVALID");
    for (const bad of [
      { event: "PERSON_DELETED" },
      { unionId: "u-a-c" },
      { personId: "k" },
      { editVersion: 5 },
      { before: { removed: { spouseId: "c", order: "1" } } },
      { before: { removed: { spouseId: "b", order: 7 } } },
      { before: {} },
    ]) {
      const s = removedState();
      s.audit = { ...s.audit, ...bad };
      expect(code(() => run(restore(), s, 6))).toBe("BAD_STATE");
    }
    const s = removedState();
    s.audit = null;
    expect(code(() => run(restore(), s, 6))).toBe("NOT_FOUND");
  });

  it("liên kết chưa ở trạng thái đã gỡ khớp nhật ký là BAD_STATE", () => {
    for (const extra of [
      { deleted: false },
      { removedAtVersion: 3 },
      { removedAtVersion: null },
      { deletedWith: "a" },
      { order: "2" },
    ]) {
      const s = removedState();
      s.union = { ...s.union, ...extra };
      expect(code(() => run(restore(), s, 6))).toBe("BAD_STATE");
    }
    const none = removedState();
    none.union = null;
    expect(code(() => run(restore(), none, 6))).toBe("BAD_STATE");
  });

  it("dòng đã có trong snapshot thì không khôi phục (tránh trùng)", () => {
    const s = removedState();
    s.snapshot = snapshotDoc(tree, 6);
    expect(code(() => run(restore(), s, 6))).toBe("BAD_STATE");
  });

  it("gỡ rồi khôi phục: thứ tự hai người theo partnerIds, order lấy từ nhật ký", () => {
    const s = removedState();
    s.union = { ...s.union, partnerIds: ["b", "a"] };
    expect(rows(run(restore(), s, 6)).unions).toContainEqual(["b", "a", "1"]);
  });
});

describe("hỗ trợ", () => {
  it("unionIdOf sắp theo thứ tự chữ; unionReads trả đủ tài liệu cần đọc", () => {
    expect(unionIdOf("b", "a")).toBe("u-a-b");
    expect(unionReads(remove())).toEqual({
      persons: ["a", "b"],
      unionId: "u-a-b",
    });
    expect(unionReads(restore(6))).toEqual({
      persons: ["a", "b"],
      unionId: "u-a-b",
      audit: "edit-6",
    });
  });

  it("removalImpact: đếm con chung và người mồ côi sau khi gỡ", () => {
    const index = buildIndex(parseSnapshot(snapshotDoc()));
    // a–b có con chung k; b chỉ có k nên không mồ côi. a có cha.
    expect(removalImpact(index, "a", "b")).toEqual({
      commonChildren: 1,
      orphaned: [],
    });
    // a–c không con chung; c không cha/mẹ/con và chỉ có a làm vợ/chồng nên mồ côi.
    expect(removalImpact(index, "a", "c")).toEqual({
      commonChildren: 0,
      orphaned: ["c"],
    });
  });
});
