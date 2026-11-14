import { describe, expect, it } from "vitest";
import { initialOf, parseName, sortMembers } from "../src/memberListModel";
import type { SnapBranch, SnapPerson } from "../src/treeModel";

// Dữ liệu hoàn toàn giả.
const person = (
  id: string,
  name: string,
  branch: string | null = null,
  generation: number | null = null,
): SnapPerson => ({
  id,
  name,
  birthYear: null,
  deathYear: null,
  generation,
  category: "CLAN",
  branch,
  flags: [],
  normalized: name.toLowerCase(),
});
const branches: SnapBranch[] = ["1", "2", "3", "10"].map((code) => ({
  code,
  name: `Chi ${code}`,
  founderId: null,
  mergedFrom: null,
  note: null,
}));
const order = (people: SnapPerson[]) =>
  sortMembers(people, branches).map((r) => r.person.id);

describe("tách họ tên", () => {
  it("họ - đệm - tên", () => {
    expect(parseName("Giả Văn Minh Hải")).toMatchObject({
      family: "Giả",
      middle: ["Văn", "Minh"],
      given: "Hải",
      historic: false,
    });
    expect(parseName("Giả An")).toMatchObject({ middle: [], given: "An" });
    expect(parseName("  Hải ")).toMatchObject({ family: "", given: "Hải" });
  });
  it("Cụ cao tổ là danh hiệu, không phải người tên Tổ", () => {
    expect(parseName("Cụ cao tổ")).toMatchObject({
      historic: true,
      given: "",
    });
    expect(parseName("cu CAO to")).toMatchObject({ historic: true });
    expect(parseName("Cụ cao tổ Giả Văn Hải")).toMatchObject({
      title: "Cụ cao tổ",
      historic: false,
      given: "Hải",
      middle: ["Văn"],
    });
  });
  it("chuỗi rỗng không gây lỗi", () => {
    expect(parseName("")).toMatchObject({ given: "", historic: false });
  });
});

describe("chữ cái đầu của tên", () => {
  it("bỏ dấu thanh, giữ chữ cái riêng của tiếng Việt", () => {
    expect(initialOf("Ánh")).toBe("A");
    expect(initialOf("Ân")).toBe("Â");
    expect(initialOf("Ắn")).toBe("Ă");
    expect(initialOf("Đức")).toBe("Đ");
    expect(initialOf("ơn")).toBe("Ơ");
  });
});

describe("thứ tự danh sách", () => {
  it("tên trước, đúng bảng chữ cái tiếng Việt", () => {
    expect(
      order([
        person("d", "Giả Văn Đức"),
        person("b", "Giả Văn Bình"),
        person("a2", "Giả Văn Ân"),
        person("a1", "Giả Văn An"),
      ]),
    ).toEqual(["a1", "a2", "b", "d"]);
  });
  it("cùng tên thì theo tên đệm, rồi chi, rồi đời", () => {
    expect(
      order([
        person("e", "Giả Văn Hải", "2", 5),
        person("d", "Giả Văn Hải", "1", 7),
        person("c", "Giả Văn Hải", "1", 4),
        person("b", "Giả Minh Hải", "3", 9),
        person("a", "Giả Hải", "10", 9),
      ]),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("chi theo thứ tự khai (chi 10 sau chi 3), chưa có chi/đời xếp cuối", () => {
    expect(
      order([
        person("n", "Giả Hải", null, 1),
        person("t", "Giả Hải", "10", 1),
        person("u", "Giả Hải", "3", null),
        person("v", "Giả Hải", "3", 2),
      ]),
    ).toEqual(["v", "u", "t", "n"]);
  });
  it("nhân vật lịch sử đứng đầu, chưa rõ tên đứng cuối, kết quả ổn định", () => {
    const people = [
      person("z", ""),
      person("b", "Giả Bình"),
      person("t2", "Cụ cao tổ", "1", 2),
      person("t1", "Cụ cao tổ", "1", 1),
    ];
    expect(order(people)).toEqual(["t1", "t2", "b", "z"]);
    expect(order([...people].reverse())).toEqual(order(people));
  });
});
