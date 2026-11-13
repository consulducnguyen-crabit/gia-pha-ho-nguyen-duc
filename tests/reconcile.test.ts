import { describe, expect, it } from "vitest";
import {
  reconcile,
  reconcileWarnings,
  type ReconcileInput,
} from "../scripts/gia-pha/reconcile-core";

const tree = () => ({
  v: 1,
  persons: {
    ts: ["Cụ Tổ", null, null, 1, "C", "c1", []] as unknown[],
    a: ["Giả A", null, null, 2, "C", "c1", []] as unknown[],
    b: ["Vợ A", null, null, null, "S", null, []] as unknown[],
  },
  relations: [["ts", "a", "F", "B", 1]] as unknown[][],
  unions: [["a", "b", "1"]],
});
function good(): ReconcileInput {
  const t = tree();
  const person = (
    id: string,
    name: string,
    category: string,
    branch: string | null,
  ) =>
    [
      id,
      { displayName: name, category, branchCode: branch } as Record<
        string,
        unknown
      >,
    ] as const;
  const mp = (name: string) => ({ displayName: name });
  return {
    snapshot: { schemaVersion: 1, editVersion: 2, data: JSON.stringify(t) },
    persons: new Map([
      person("ts", "Cụ Tổ", "CLAN", "c1"),
      person("a", "Giả A", "CLAN", "c1"),
      person("b", "Vợ A", "SPOUSE", null),
    ]),
    memberProfiles: new Map([
      ["ts", mp("Cụ Tổ")],
      ["a", mp("Giả A")],
      ["b", mp("Vợ A")],
    ]),
    relations: new Map([
      [
        "r-ts-a",
        {
          parentRole: "FATHER",
          relationType: "BIOLOGICAL",
          lineageTransmission: true,
        } as Record<string, unknown>,
      ],
    ]),
    unions: new Map([["u-a-b", { partnerIds: ["a", "b"], order: "1" }]]),
    edits: [
      { id: "edit-1", editVersion: 1, event: "PERSON_EDITED" },
      { id: "edit-2", editVersion: 2, event: "PERSON_ADDED" },
    ],
  };
}
const codes = (i: ReconcileInput) => reconcile(i).map((x) => x.code);
const setData = (i: ReconcileInput, t: unknown) => {
  i.snapshot!.data = JSON.stringify(t);
};

describe("đối soát snapshot", () => {
  it("dữ liệu khớp: không sai lệch", () => {
    expect(codes(good())).toEqual([]);
  });
  it("bắt người, quan hệ, vợ chồng lệch hai chiều", () => {
    const g = good();
    g.persons.delete("b");
    expect(codes(g)).toContain("SNAPSHOT_PERSON_NOT_LIVE");
    const h = good();
    h.persons.set("x", { displayName: "X", category: "CLAN" });
    expect(codes(h)).toContain("PERSON_NOT_IN_SNAPSHOT");
    const r = good();
    r.relations.get("r-ts-a")!.deleted = true;
    expect(codes(r)).toContain("SNAPSHOT_RELATION_NOT_LIVE");
    const r2 = good();
    r2.relations.set("r-ts-b", { parentRole: "FATHER" });
    expect(codes(r2)).toContain("RELATION_NOT_IN_SNAPSHOT");
    const u = good();
    u.unions.clear();
    expect(codes(u)).toContain("SNAPSHOT_UNION_NOT_LIVE");
  });
  it("liên kết vợ/chồng đã gỡ: trạng thái đúng thì đạt, sai trạng thái bị bắt", () => {
    const ok = good();
    // Gỡ liên kết: không còn trong snapshot, unions/{id} ẩn + removedAtVersion, deletedWith null.
    const t = tree();
    t.unions = [];
    setData(ok, t);
    ok.unions.set("u-a-b", {
      partnerIds: ["a", "b"],
      deleted: true,
      removedAtVersion: 3,
      deletedWith: null,
    });
    // Chưa có nhật ký UNION_REMOVED tương ứng thì bị bắt.
    expect(codes(ok)).toContain("UNION_REMOVED_BAD_STATE");
    ok.snapshot!.editVersion = 3;
    ok.edits.push({ id: "edit-3", editVersion: 3, event: "UNION_REMOVED" });
    expect(codes(ok)).toEqual([]);
    ok.edits[2].event = "PERSON_EDITED";
    expect(codes(ok)).toContain("UNION_REMOVED_BAD_STATE");
    const live = good();
    live.unions.get("u-a-b")!.removedAtVersion = 3;
    expect(codes(live)).toContain("UNION_REMOVED_BAD_STATE");
    const withPerson = good();
    withPerson.unions.set("u-a-b", {
      partnerIds: ["a", "b"],
      deleted: true,
      removedAtVersion: 3,
      deletedWith: "a",
    });
    const t2 = tree();
    t2.unions = [];
    setData(withPerson, t2);
    expect(codes(withPerson)).toContain("UNION_REMOVED_BAD_STATE");
    // Liên kết ẩn cùng người (không có dấu gỡ) vẫn hợp lệ.
    const hidden = good();
    hidden.unions.set("u-a-b", {
      partnerIds: ["a", "b"],
      deleted: true,
      deletedWith: "a",
    });
    setData(hidden, t2);
    expect(codes(hidden)).not.toContain("UNION_REMOVED_BAD_STATE");
  });
  it("bắt dòng vợ/chồng trùng, tự nối và lệch thứ tự", () => {
    const d = good();
    const t = tree();
    t.unions = [
      ["a", "b", "1"],
      ["b", "a", "1"],
    ];
    setData(d, t);
    expect(codes(d)).toContain("SNAPSHOT_UNION_DUPLICATE");
    const self = good();
    const t2 = tree();
    t2.unions = [["a", "a", "1"]];
    setData(self, t2);
    expect(codes(self)).toContain("UNION_SELF");
    const o = good();
    o.unions.get("u-a-b")!.order = "2";
    expect(codes(o)).toContain("UNION_ORDER_MISMATCH");
    const nul = good();
    nul.unions.get("u-a-b")!.order = null;
    expect(codes(nul)).toContain("UNION_ORDER_MISMATCH");
  });
  it("bắt tên, loại, quan hệ khác nhau và bản thành viên lệch", () => {
    const g = good();
    g.persons.get("a")!.displayName = "Khác";
    g.relations.get("r-ts-a")!.relationType = "ADOPTIVE";
    g.memberProfiles.delete("b");
    expect(codes(g)).toEqual(
      expect.arrayContaining([
        "NAME_MISMATCH",
        "MEMBER_NAME_MISMATCH",
        "RELATION_RELATIONTYPE_MISMATCH",
        "MEMBER_PROFILE_MISSING",
      ]),
    );
  });
  it("bắt người ẩn còn bản thành viên, sai đời, vòng lặp, hai cha cùng vai", () => {
    const g = good();
    g.persons.get("b")!.deleted = true;
    expect(codes(g)).toContain("MEMBER_PROFILE_FOR_HIDDEN");
    const h = good();
    const t = tree();
    t.persons.a[3] = 5;
    setData(h, t);
    expect(codes(h)).toContain("GENERATION_MISMATCH");
    const c = good();
    const t2 = tree();
    t2.relations.push(["a", "ts", "M", "B", 0]);
    setData(c, t2);
    c.relations.set("r-a-ts", {
      parentRole: "MOTHER",
      relationType: "BIOLOGICAL",
      lineageTransmission: false,
    });
    expect(codes(c)).toContain("PARENT_CYCLE");
    const d = good();
    const t3 = tree();
    t3.relations.push(["b", "a", "F", "B", 1]);
    setData(d, t3);
    expect(codes(d)).toContain("DUP_PARENT_ROLE");
  });
  it("cha ruột ngoại tộc + cha nuôi là hợp lệ; hai cha cùng loại thì báo", () => {
    const g = good();
    const t = tree();
    (t.persons as Record<string, unknown[]>).x = [
      "Ngoại X",
      null,
      null,
      null,
      "E",
      null,
      [],
    ];
    t.relations.push(["x", "a", "F", "A", 0]);
    setData(g, t);
    g.persons.set("x", {
      displayName: "Ngoại X",
      category: "EXTERNAL",
      branchCode: null,
    });
    g.memberProfiles.set("x", { displayName: "Ngoại X" });
    g.relations.set("r-x-a", {
      parentRole: "FATHER",
      relationType: "ADOPTIVE",
      lineageTransmission: false,
    });
    expect(codes(g)).toEqual([]);
  });
  it("bắt năm sinh/mất, cờ, đầu mút và đối tác vợ chồng lệch", () => {
    const g = good();
    g.memberProfiles.get("a")!.birthYear = 1900;
    g.persons.get("a")!.reviewFlags = ["VERIFY"];
    g.unions.get("u-a-b")!.partnerIds = ["a", "zz"];
    expect(codes(g)).toEqual(
      expect.arrayContaining([
        "BIRTH_YEAR_MISMATCH",
        "FLAGS_MISMATCH",
        "UNION_PARTNERS_MISMATCH",
      ]),
    );
    const h = good();
    const t = tree();
    t.unions.push(["a", "ghost", null as unknown as string]);
    setData(h, t);
    expect(codes(h)).toContain("UNION_ENDPOINT_MISSING");
  });
  it("bắt phiên bản sửa lệch snapshot, hụt số, trùng số", () => {
    const g = good();
    g.snapshot!.editVersion = 3;
    expect(codes(g)).toContain("EDIT_VERSION_MISMATCH");
    const h = good();
    h.edits = [{ id: "edit-2", editVersion: 2, event: "PERSON_ADDED" }];
    expect(codes(h)).toContain("AUDIT_GAP");
    const d = good();
    d.edits.push({ id: "edit-2b", editVersion: 2, event: "PERSON_ADDED" });
    expect(codes(d)).toEqual(
      expect.arrayContaining(["AUDIT_DUP_VERSION", "AUDIT_ID_MISMATCH"]),
    );
  });
  it("không có snapshot hoặc không đọc được", () => {
    const g = good();
    g.snapshot = null;
    expect(codes(g)).toEqual(["SNAPSHOT_MISSING"]);
    g.snapshot = { data: "{" };
    expect(codes(g)).toEqual(["SNAPSHOT_UNREADABLE"]);
  });

  describe("cảnh báo chi lệch người khai chi", () => {
    // ts(c1, khai c1) → a(c1) → k(c2); người khai chi c2 là a2.
    const mk = () => {
      const g = good();
      const t = tree() as unknown as {
        persons: Record<string, unknown[]>;
        relations: unknown[][];
        branches: Record<string, unknown[]>;
      };
      t.branches = {
        c1: ["Chi 1", "ts", null, null],
        c2: ["Chi 2", "a", null, null],
      };
      // Người khai chi c2 phải mang chi c2 (chi lồng nhau trong c1).
      t.persons.a[5] = "c2";
      t.persons.k = ["Giả K", null, null, 3, "C", "c2", []];
      t.relations.push(["a", "k", "F", "B", 1]);
      setData(g, t);
      g.persons.get("a")!.branchCode = "c2";
      g.persons.set("k", {
        displayName: "Giả K",
        category: "CLAN",
        branchCode: "c2",
      });
      g.memberProfiles.set("k", { displayName: "Giả K" });
      g.relations.set("r-a-k", {
        parentRole: "FATHER",
        relationType: "BIOLOGICAL",
        lineageTransmission: true,
      });
      return { g, t };
    };
    // Cảnh báo giới tính kiểm riêng ở describe "giới tính"; ở đây chỉ xét cảnh báo chi.
    const warn = (i: ReconcileInput) =>
      reconcileWarnings(i)
        .filter((x) => x.code !== "SEX_NOT_IN_SNAPSHOT")
        .map((x) => `${x.code}:${x.ref}`);
    it("khớp thì không cảnh báo", () => {
      expect(warn(mk().g)).toEqual([]);
    });
    it("người khai chi của chi con mang chi của mình thì không cảnh báo", () => {
      expect(warn(mk().g)).not.toContain("BRANCH_FOUNDER_MISMATCH:a");
    });
    it("người khai chi mang chi KHÁC chi mình khai (kể cả chi của cha) thì cảnh báo", () => {
      const { g, t } = mk();
      t.persons.a[5] = "c1";
      setData(g, t);
      g.persons.get("a")!.branchCode = "c1";
      expect(warn(g)).toContain("BRANCH_FOUNDER_MISMATCH:a");
    });
    it("lệch thì cảnh báo, không đổi kết quả đối soát", () => {
      const { g, t } = mk();
      t.persons.k[5] = "c1";
      setData(g, t);
      g.persons.get("k")!.branchCode = "c1";
      expect(warn(g)).toEqual(["BRANCH_FOUNDER_MISMATCH:k"]);
      expect(codes(g)).toEqual([]);
      expect(reconcile(g)).toEqual([]);
      const out = JSON.stringify(reconcileWarnings(g));
      expect(out).not.toContain("Giả K");
      expect(out).not.toContain("Chi 2");
    });
    it("con nuôi có lineage tính như con ruột", () => {
      const { g, t } = mk();
      t.relations[1] = ["a", "k", "F", "A", 1];
      t.persons.k[5] = "c1";
      setData(g, t);
      g.persons.get("k")!.branchCode = "c1";
      g.relations.get("r-a-k")!.relationType = "ADOPTIVE";
      expect(warn(g)).toEqual(["BRANCH_FOUNDER_MISMATCH:k"]);
    });
    it("SPOUSE/EXTERNAL bị bỏ qua", () => {
      const { g, t } = mk();
      t.persons.k[4] = "E";
      t.persons.k[5] = "c1";
      setData(g, t);
      expect(warn(g)).toEqual([]);
    });
    it("người đã ẩn và quan hệ đã deleted bị bỏ qua", () => {
      const { g, t } = mk();
      t.persons.k[5] = "c1";
      setData(g, t);
      g.persons.get("k")!.deleted = true;
      expect(warn(g)).toEqual([]);
      g.persons.get("k")!.deleted = false;
      g.relations.get("r-a-k")!.deleted = true;
      expect(warn(g)).toEqual([]);
    });
    it("người không thuộc cây con người khai chi nào thì bỏ qua", () => {
      const { g, t } = mk();
      t.branches.c1[1] = null; // chi c1 không khai người khai chi
      t.persons.ts[5] = "c9"; // thủy tổ không có tổ tiên khai chi
      setData(g, t);
      expect(warn(g)).toEqual([]);
    });
    it("vòng lặp quan hệ không treo", () => {
      const { g, t } = mk();
      t.relations.push(["k", "ts", "F", "B", 1]);
      t.persons.k[5] = "c1";
      setData(g, t);
      expect(warn(g)).toContain("BRANCH_FOUNDER_MISMATCH:k");
    });
  });
});

describe("giới tính trong ảnh chụp", () => {
  const withSex = () => {
    const g = good();
    const t = tree();
    const sexes: Record<string, string | null> = { ts: "M", a: "M", b: "F" };
    for (const [id, v] of Object.entries(t.persons)) {
      v.push(sexes[id]);
      g.persons.get(id)!.sex = sexes[id];
    }
    setData(g, t);
    return { g, t };
  };
  it("bộ 8 phần tử khớp persons.sex: đạt, không cảnh báo", () => {
    const { g } = withSex();
    expect(codes(g)).toEqual([]);
    expect(reconcileWarnings(g)).toEqual([]);
  });
  it("persons.sex thiếu coi như null", () => {
    const { g, t } = withSex();
    delete g.persons.get("b")!.sex;
    t.persons.b[7] = null;
    setData(g, t);
    expect(codes(g)).toEqual([]);
  });
  it("lệch sex bị bắt là SEX_MISMATCH", () => {
    const { g, t } = withSex();
    t.persons.a[7] = "F";
    setData(g, t);
    expect(reconcile(g)).toContainEqual({ code: "SEX_MISMATCH", ref: "a" });
  });
  it("bộ chưa có giới tính: không lỗi, chỉ cảnh báo SEX_NOT_IN_SNAPSHOT (mã người, không tên)", () => {
    const g = good();
    expect(codes(g)).toEqual([]);
    const w = reconcileWarnings(g);
    expect(w.map((x) => x.ref).sort()).toEqual(["a", "b", "ts"]);
    expect(w.every((x) => x.code === "SEX_NOT_IN_SNAPSHOT")).toBe(true);
    expect(JSON.stringify(w)).not.toContain("Giả");
  });
});
