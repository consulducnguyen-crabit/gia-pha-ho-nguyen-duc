import { describe, expect, it } from "vitest";
import {
  buildChildOp,
  buildSpouseOp,
  emptyPerson,
  type ChildForm,
  type SpouseForm,
} from "../src/addForm";

const lineage = new Set(["a"]);
const ctx = {
  newId: "p-new",
  canBeLineageFather: (id: string) => lineage.has(id),
};
const child: ChildForm = {
  ...emptyPerson,
  name: " Giả  Con ",
  role: "FATHER",
  otherParent: "",
  category: "CLAN",
  adoptive: false,
  branch: "c1",
};
const spouse: SpouseForm = {
  ...emptyPerson,
  name: "Vợ Giả",
  kind: "new",
  existingId: "",
  category: "SPOUSE",
  order: "",
};

describe("buildChildOp", () => {
  it("người xem là cha: cha = người đó, mẹ = người còn lại", () => {
    const r = buildChildOp("a", { ...child, otherParent: "m" }, ctx);
    expect(r).toMatchObject({
      op: {
        type: "addChild",
        newId: "p-new",
        fatherId: "a",
        motherId: "m",
        category: "CLAN",
        branch: "c1",
        child: { name: "Giả Con", sex: null, birthYear: null },
      },
    });
  });
  it("người xem là mẹ: con họ ngoại, không có chi", () => {
    const r = buildChildOp(
      "x",
      { ...child, role: "MOTHER", category: "EXTERNAL" },
      ctx,
    );
    expect(r).toMatchObject({
      op: { fatherId: null, motherId: "x", category: "EXTERNAL", branch: null },
    });
  });
  it("bắt buộc chọn cha/mẹ, tên; năm hợp lệ", () => {
    const r = buildChildOp(
      "a",
      { ...child, role: "", name: " ", birthYear: "x" },
      ctx,
    );
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual([
      "birthYear",
      "name",
      "role",
    ]);
  });
  it("thuộc dòng họ cần cha thuộc dòng họ", () => {
    expect(buildChildOp("x", { ...child, role: "FATHER" }, ctx)).toHaveProperty(
      "errors.category",
    );
    expect(buildChildOp("a", { ...child, role: "MOTHER" }, ctx)).toHaveProperty(
      "errors.category",
    );
  });
});

describe("buildSpouseOp", () => {
  it("người mới", () => {
    expect(buildSpouseOp("a", { ...spouse, order: " 1 " }, ctx)).toMatchObject({
      op: {
        type: "addSpouse",
        personId: "a",
        order: "1",
        spouse: { kind: "new", newId: "p-new", category: "SPOUSE" },
      },
    });
  });
  it("người có sẵn cần chọn", () => {
    expect(
      buildSpouseOp("a", { ...spouse, kind: "existing" }, ctx),
    ).toHaveProperty("errors.existingId");
    expect(
      buildSpouseOp("a", { ...spouse, kind: "existing", existingId: "x" }, ctx),
    ).toMatchObject({ op: { spouse: { kind: "existing", id: "x" } } });
  });
  it("kiểm tra tên và thứ tự", () => {
    const r = buildSpouseOp(
      "a",
      { ...spouse, name: "", order: "x".repeat(21) },
      ctx,
    );
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual([
      "name",
      "order",
    ]);
  });
});
