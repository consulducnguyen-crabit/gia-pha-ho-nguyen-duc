import { describe, expect, it } from "vitest";
import { BRANCH_TEXT_LIMIT, branchInfo, clipText } from "../src/branchInfo";
import type { SnapBranch, SnapPerson } from "../src/treeModel";

// Dữ liệu hoàn toàn giả.
function person(id: string, name: string): SnapPerson {
  return {
    id,
    name,
    birthYear: null,
    deathYear: null,
    generation: 1,
    category: "CLAN",
    branch: null,
    flags: [],
    normalized: name.toLowerCase(),
  };
}
function snap(branches: SnapBranch[], ids = ["ts"]) {
  return {
    branches,
    persons: new Map(ids.map((id) => [id, person(id, `Người ${id}`)])),
  };
}
const base: SnapBranch = {
  code: "I",
  name: "Chi Một",
  founderId: "ts",
  mergedFrom: "Dòng giả X",
  note: "ghi chú giả",
};

describe("branchInfo", () => {
  it("trả mergedFrom cho mọi người, note chỉ cho quản trị viên", () => {
    const s = snap([base]);
    const member = branchInfo(s, "I", { isAdmin: false })!;
    expect(member.mergedFrom?.full).toBe("Dòng giả X");
    expect(member.note).toBeNull();
    const admin = branchInfo(s, "I", { isAdmin: true })!;
    expect(admin.note?.full).toBe("ghi chú giả");
    expect(admin.mergedFrom?.full).toBe("Dòng giả X");
  });

  it("founder chỉ có khi có trong cây và id an toàn", () => {
    expect(branchInfo(snap([base]), "I", { isAdmin: false })!.founder).toEqual({
      id: "ts",
      name: "Người ts",
    });
    expect(
      branchInfo(snap([{ ...base, founderId: "khong-co" }]), "I", {
        isAdmin: false,
      })!.founder,
    ).toBeNull();
    // Mã có ký tự nguy hiểm: dù có trong ảnh chụp cũng không dựng liên kết.
    for (const bad of ["a/b", "a b", "../x", "x?y", "", "a".repeat(101)]) {
      const s = snap([{ ...base, founderId: bad }], [bad]);
      expect(branchInfo(s, "I", { isAdmin: true })!.founder).toBeNull();
    }
  });

  it("dữ liệu rỗng/null/khoảng trắng và chi không tồn tại", () => {
    const s = snap([
      { ...base, founderId: null, mergedFrom: "  ", note: null },
    ]);
    const info = branchInfo(s, "I", { isAdmin: true })!;
    expect(info.founder).toBeNull();
    expect(info.mergedFrom).toBeNull();
    expect(info.note).toBeNull();
    expect(branchInfo(s, "ZZ", { isAdmin: true })).toBeNull();
    expect(branchInfo(s, null, { isAdmin: true })).toBeNull();
    expect(branchInfo(s, "", { isAdmin: true })).toBeNull();
  });

  it("chuỗi giữ nguyên là text, không bị biến đổi", () => {
    const s = snap([{ ...base, mergedFrom: "<script>alert(1)</script>" }]);
    expect(branchInfo(s, "I", { isAdmin: false })!.mergedFrom?.full).toBe(
      "<script>alert(1)</script>",
    );
  });
});

describe("clipText", () => {
  it("không cắt chuỗi đúng giới hạn, cắt kèm … khi vượt", () => {
    const ok = "a".repeat(BRANCH_TEXT_LIMIT);
    expect(clipText(ok)).toEqual({ short: ok, full: ok, truncated: false });
    const long = "b".repeat(BRANCH_TEXT_LIMIT + 1);
    const c = clipText(long)!;
    expect(c.truncated).toBe(true);
    expect(c.short).toBe("b".repeat(BRANCH_TEXT_LIMIT) + "…");
    expect(c.full).toBe(long);
  });

  it("cắt theo ký tự Unicode, không chẻ cặp thay thế", () => {
    const c = clipText("😀".repeat(10), 4)!;
    expect(c.short).toBe("😀😀😀😀…");
  });

  it("null/undefined/rỗng → null", () => {
    expect(clipText(null)).toBeNull();
    expect(clipText(undefined)).toBeNull();
    expect(clipText("   ")).toBeNull();
  });
});
