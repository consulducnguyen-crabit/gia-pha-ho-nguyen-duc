import { describe, expect, it } from "vitest";
import { EditError } from "../src/editCore";
import {
  addTargets,
  applyAdd,
  newPersonId,
  type AddOp,
  type AddState,
  type NewPerson,
} from "../src/editAdd";
import { NOTE_CLIP } from "../src/treeModel";

const tree = {
  v: 1,
  persons: {
    ts: ["Cụ Tổ", null, null, 1, "C", "c1", []],
    a: ["Giả Văn A", 1900, 1970, 2, "C", "c1", []],
    b: ["Vợ Giả A", 1905, null, null, "S", null, []],
    c: ["Giả Thị C", 1930, null, 3, "C", "c1", []],
    x: ["Chồng Giả C", null, null, null, "E", null, []],
    o: ["Giả Mồ Côi", null, null, null, "C", null, []],
  },
  relations: [
    ["ts", "a", "F", "B", 1],
    ["a", "c", "F", "B", 1],
    ["b", "c", "M", "B", 0],
  ],
  unions: [["a", "b", "1"]],
  branches: { c1: ["Chi 1", "ts", null, null] },
};
function state(over: Partial<AddState["docs"]> = {}): AddState {
  return {
    snapshot: {
      schemaVersion: 1,
      dataVersion: "x",
      editVersion: 2,
      data: JSON.stringify(tree),
    },
    docs: {
      "p-new": null,
      a: { sex: "M" },
      b: { sex: "F" },
      c: { sex: "F" },
      x: { sex: "M" },
      o: { sex: "M" },
      ...over,
    },
  };
}
const kid: NewPerson = {
  name: "  Giả Văn  Con ",
  sex: "M",
  birthYear: 1960,
  deathYear: null,
  note: "",
};
const child = (
  over: Partial<Extract<AddOp, { type: "addChild" }>> = {},
): AddOp => ({
  type: "addChild",
  newId: "p-new",
  fatherId: "a",
  motherId: "b",
  adoptive: false,
  category: "CLAN",
  branch: "c1",
  child: kid,
  ...over,
});
const run = (op: AddOp, s = state(), expectedVersion = 2) =>
  applyAdd(s, { op, expectedVersion, actorUid: "admin" });
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
const snapData = (r: ReturnType<typeof run>) =>
  JSON.parse(byPath(r)["treeSnapshots/main"].data.data as string);

describe("addChild", () => {
  it("tạo người, hai quan hệ, cập nhật snapshot và nhật ký", () => {
    const r = run(child());
    const w = byPath(r);
    expect(r.nextVersion).toBe(3);
    expect(w["persons/p-new"].data).toMatchObject({
      displayName: "Giả Văn Con",
      category: "CLAN",
      generation: 3,
      branchCode: "c1",
      profileVersion: 1,
      createdBy: "admin",
    });
    expect(w["memberProfiles/p-new"].data).toMatchObject({ birthYear: 1960 });
    expect(w["personPrivate/p-new"]).toBeUndefined();
    expect(w["relations/r-a-p-new"].data).toMatchObject({
      parentRole: "FATHER",
      relationType: "BIOLOGICAL",
      lineageTransmission: true,
    });
    expect(w["relations/r-b-p-new"].data).toMatchObject({
      parentRole: "MOTHER",
      lineageTransmission: false,
    });
    const d = snapData(r);
    expect(d.persons["p-new"]).toEqual([
      "Giả Văn Con",
      1960,
      null,
      3,
      "C",
      "c1",
      [],
      "M",
      false,
      null,
    ]);
    expect(d.relations).toContainEqual(["a", "p-new", "F", "B", 1]);
    expect(d.relations).toContainEqual(["b", "p-new", "M", "B", 0]);
    expect(d.relations).toHaveLength(5);
    expect(w["treeSnapshots/main"].data.editVersion).toBe(3);
    expect(w["auditLogs/edit-3"].data).toMatchObject({
      event: "PERSON_ADDED",
      personId: "p-new",
      createdPersonIds: ["p-new"],
      relationIds: ["r-a-p-new", "r-b-p-new"],
      editVersion: 3,
    });
  });

  it("con nuôi vẫn truyền dòng theo cha; ghi chú vào personPrivate, nhật ký chỉ ghi độ dài", () => {
    const r = run(child({ adoptive: true, child: { ...kid, note: "bí mật" } }));
    const w = byPath(r);
    expect(w["relations/r-a-p-new"].data).toMatchObject({
      relationType: "ADOPTIVE",
      lineageTransmission: true,
    });
    expect(w["personPrivate/p-new"].data).toMatchObject({ note: "bí mật" });
    expect(JSON.stringify(w["auditLogs/edit-3"].data)).not.toContain("bí mật");
  });

  it("con của con gái (họ ngoại): chỉ mẹ, không truyền dòng, không có đời", () => {
    const r = run(
      child({
        fatherId: null,
        motherId: "c",
        category: "EXTERNAL",
        branch: null,
      }),
    );
    const w = byPath(r);
    expect(w["persons/p-new"].data).toMatchObject({
      category: "EXTERNAL",
      generation: null,
    });
    expect(w["relations/r-c-p-new"].data).toMatchObject({
      parentRole: "MOTHER",
      lineageTransmission: false,
    });
    expect(Object.keys(w).some((k) => k.startsWith("relations/r-a"))).toBe(
      false,
    );
  });

  it("không tạo thủy tổ mới và không cho cha ngoài dòng truyền dòng", () => {
    expect(code(() => run(child({ fatherId: null, motherId: "b" })))).toBe(
      "INVALID",
    );
    expect(code(() => run(child({ fatherId: "x", motherId: "c" })))).toBe(
      "INVALID",
    );
    expect(code(() => run(child({ fatherId: null, motherId: null })))).toBe(
      "INVALID",
    );
  });

  it("cha thuộc dòng họ nhưng chưa nối tới thủy tổ thì không tạo được con dòng họ (không có gốc thứ hai)", () => {
    expect(code(() => run(child({ fatherId: "o", motherId: null })))).toBe(
      "INVALID",
    );
    // Vẫn thêm được con họ ngoại qua mẹ, hoặc con của cha đã nối.
    expect(
      code(() =>
        run(
          child({
            fatherId: null,
            motherId: "c",
            category: "EXTERNAL",
            branch: null,
          }),
        ),
      ),
    ).toBe("OK");
  });

  it("người họ ngoại không thuộc chi; snapshot sai định dạng báo BAD_STATE", () => {
    expect(
      code(() =>
        run(
          child({
            fatherId: "a",
            motherId: null,
            category: "EXTERNAL",
            branch: "c1",
          }),
        ),
      ),
    ).toBe("INVALID");
    for (const data of ["null", "[]", '{"v":2}'])
      expect(
        code(() =>
          run(child(), {
            ...state(),
            snapshot: { ...state().snapshot, data },
          }),
        ),
      ).toBe("BAD_STATE");
  });

  it("từ chối cha là nữ, mẹ là nam, cha trùng mẹ, mã không có trong cây", () => {
    expect(code(() => run(child({ fatherId: "c", motherId: "b" })))).toBe(
      "INVALID",
    );
    expect(code(() => run(child({ motherId: "a", fatherId: "ts" })))).toBe(
      "INVALID",
    );
    expect(code(() => run(child({ fatherId: "a", motherId: "a" })))).toBe(
      "INVALID",
    );
    expect(code(() => run(child({ fatherId: "zzz" })))).toBe("INVALID");
  });

  it("mã mới phải chưa tồn tại; dữ liệu người mới được kiểm tra", () => {
    expect(code(() => run(child({ newId: "a" }), state({ a: null })))).toBe(
      "INVALID",
    );
    expect(code(() => run(child(), state({ "p-new": { x: 1 } })))).toBe(
      "INVALID",
    );
    expect(code(() => run(child({ newId: "../x" })))).toBe("INVALID");
    expect(code(() => run(child({ child: { ...kid, name: " " } })))).toBe(
      "INVALID",
    );
    expect(
      code(() =>
        run(child({ child: { ...kid, birthYear: 1970, deathYear: 1960 } })),
      ),
    ).toBe("INVALID");
    expect(code(() => run(child({ branch: "toString" })))).toBe("INVALID");
  });

  it("khóa phiên bản", () => {
    expect(code(() => run(child(), state(), 1))).toBe("VERSION_CONFLICT");
  });

  it("không sửa trạng thái đầu vào", () => {
    const s = state();
    const before = JSON.stringify(s);
    run(child(), s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("addTargets liệt kê người cần đọc", () => {
    expect(addTargets(child()).sort()).toEqual(["a", "b", "p-new"]);
  });
});

describe("addSpouse", () => {
  const spouseNew = (
    over: Partial<Extract<AddOp, { type: "addSpouse" }>> = {},
  ): AddOp => ({
    type: "addSpouse",
    personId: "c",
    order: "1",
    spouse: {
      kind: "new",
      newId: "p-new",
      category: "SPOUSE",
      person: { ...kid, name: "Chồng Mới", sex: "M" },
    },
    ...over,
  });

  it("thêm người mới làm vợ/chồng: tạo người, union và nhật ký", () => {
    const r = run(spouseNew());
    const w = byPath(r);
    expect(w["persons/p-new"].data).toMatchObject({
      category: "SPOUSE",
      generation: null,
    });
    expect(w["unions/u-c-p-new"].data).toMatchObject({
      partnerIds: ["c", "p-new"],
      order: "1",
    });
    const d = snapData(r);
    expect(d.unions).toContainEqual(["c", "p-new", "1"]);
    expect(d.persons["p-new"][4]).toBe("S");
    expect(w["auditLogs/edit-3"].data).toMatchObject({
      event: "SPOUSE_ADDED",
      personId: "c",
      createdPersonIds: ["p-new"],
      unionId: "u-c-p-new",
    });
  });

  it("nối với người đã có, không tạo người mới", () => {
    const r = run({
      type: "addSpouse",
      personId: "c",
      order: null,
      spouse: { kind: "existing", id: "x" },
    });
    const w = byPath(r);
    expect(Object.keys(w).some((k) => k.startsWith("persons/"))).toBe(false);
    expect(w["unions/u-c-x"].data.order).toBeNull();
    expect(w["auditLogs/edit-3"].data.createdPersonIds).toEqual([]);
  });

  it("từ chối: trùng quan hệ (cả hai chiều), tự cưới, người không có, thứ tự xấu", () => {
    const ex = (personId: string, id: string): AddOp => ({
      type: "addSpouse",
      personId,
      order: null,
      spouse: { kind: "existing", id },
    });
    expect(code(() => run(ex("a", "b")))).toBe("INVALID");
    expect(code(() => run(ex("b", "a")))).toBe("INVALID");
    expect(code(() => run(ex("a", "a")))).toBe("INVALID");
    expect(code(() => run(ex("a", "zzz")))).toBe("INVALID");
    expect(code(() => run(spouseNew({ order: "x".repeat(21) })))).toBe(
      "INVALID",
    );
    expect(code(() => run(spouseNew({ personId: "zzz" })))).toBe("INVALID");
  });
});

describe("newPersonId", () => {
  it("sinh mã hợp lệ, khác nhau", () => {
    const a = newPersonId();
    expect(a).toMatch(/^p-[a-z0-9]{12}$/);
    expect(newPersonId()).not.toBe(a);
  });
});

describe("giới tính trong ảnh chụp", () => {
  it("con và vợ/chồng mới có phần tử thứ 8 theo giới tính nhập", () => {
    const c = snapData(run(child({ child: { ...kid, sex: "F" } })));
    expect(c.persons["p-new"][7]).toBe("F");
    const c2 = snapData(run(child({ child: { ...kid, sex: null } })));
    expect(c2.persons["p-new"][7]).toBeNull();
    const s = snapData(
      run({
        type: "addSpouse",
        personId: "c",
        order: "1",
        spouse: {
          kind: "new",
          newId: "p-new",
          category: "SPOUSE",
          person: { ...kid, name: "Chồng Mới", sex: "M" },
        },
      }),
    );
    expect(s.persons["p-new"][7]).toBe("M");
  });
});

describe("Đã mất khi thêm người", () => {
  it("con mới: persons.deceased và phần tử thứ 9; mặc định false", () => {
    const r = run(child({ child: { ...kid, deceased: true } }));
    expect(snapData(r).persons["p-new"][8]).toBe(true);
    const w = r.writes.find((x) => x.path === "persons/p-new")!;
    expect(w.data.deceased).toBe(true);
    const r2 = run(child({ child: { ...kid } }));
    expect(snapData(r2).persons["p-new"][8]).toBe(false);
    expect(
      r2.writes.find((x) => x.path === "persons/p-new")!.data.deceased,
    ).toBe(false);
  });
  it("vợ/chồng mới đánh dấu đã mất; kiểu sai bị từ chối", () => {
    const op = (deceased: unknown) =>
      ({
        type: "addSpouse",
        personId: "c",
        spouse: {
          kind: "new",
          newId: "p-new",
          category: "SPOUSE",
          person: { ...kid, name: "Vợ Mới", sex: "F", deceased },
        },
        order: null,
      }) as unknown as Parameters<typeof run>[0];
    expect(snapData(run(op(true))).persons["p-new"][8]).toBe(true);
    expect(() => run(op("x"))).toThrow();
  });
});

describe("ghi chú khi thêm người", () => {
  it("con mới và vợ/chồng mới có phần tử 10 là ghi chú đã cắt", () => {
    const c = snapData(
      run(child({ child: { ...kid, note: "  Ghi chú con  " } })),
    );
    expect(c.persons["p-new"][9]).toBe("Ghi chú con");
    const long = snapData(
      run(child({ child: { ...kid, note: "y".repeat(500) } })),
    );
    expect(long.persons["p-new"][9]).toBe(`${"y".repeat(NOTE_CLIP)}…`);
    const s = snapData(
      run({
        type: "addSpouse",
        personId: "c",
        order: "1",
        spouse: {
          kind: "new",
          newId: "p-new",
          category: "SPOUSE",
          person: { ...kid, name: "Vợ Mới", sex: "F", note: "ghi chú vợ" },
        },
      }),
    );
    expect(s.persons["p-new"][9]).toBe("ghi chú vợ");
  });
});
