import { describe, expect, it } from "vitest";
import {
  reconcile,
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
    unions: new Map([["u-a-b", { partnerIds: ["a", "b"] }]]),
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
});
