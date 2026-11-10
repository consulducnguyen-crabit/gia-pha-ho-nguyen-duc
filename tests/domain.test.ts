import { describe, it, expect } from "vitest";
import { createsCycle, normalizeName } from "../src/domain";
describe("graph integrity", () => {
  const relations = [
    { parentId: "a", childId: "b", verificationStatus: "APPROVED" },
    { parentId: "b", childId: "c", verificationStatus: "APPROVED" },
  ];
  it("rejects self-parent and indirect cycles", () => {
    expect(createsCycle(relations, "a", "a")).toBe(true);
    expect(createsCycle(relations, "c", "a")).toBe(true);
  });
  it("allows a disconnected parent without inferring lineage", () =>
    expect(createsCycle(relations, "x", "a")).toBe(false));
  it("terminates even on corrupt historical graphs", () =>
    expect(
      createsCycle(
        [
          ...relations,
          { parentId: "c", childId: "a", verificationStatus: "APPROVED" },
        ],
        "x",
        "a",
      ),
    ).toBe(false));
  it("normalizes Vietnamese search", () =>
    expect(normalizeName(" Đặng Ánh ")).toBe("dang anh"));
});
