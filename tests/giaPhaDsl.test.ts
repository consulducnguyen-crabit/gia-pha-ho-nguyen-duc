import { describe, expect, it } from "vitest";
import { normalizeName, parseDsl } from "../scripts/gia-pha/dsl";

// Dữ liệu hoàn toàn giả, chỉ để kiểm thử logic.
const P = (
  id: string,
  name: string,
  sx: string,
  gen: string,
  cat: string,
  extra: { chi?: string; birth?: string; death?: string; ky?: string } = {},
) => {
  const attrs = [
    extra.birth && `b=${extra.birth}`,
    extra.death && `d=${extra.death}`,
    extra.ky && `ky=${extra.ky}`,
  ]
    .filter(Boolean)
    .join(";");
  return ["P", id, name, sx, cat, gen, extra.chi ?? "", attrs, ""].join("|");
};
const base = [
  P("ts", "Cụ Giả Thủy Tổ", "M", "I", "CLAN", { chi: "I" }),
  P("a", "Giả Văn A", "M", "II", "CLAN", { chi: "I", birth: "1900" }),
  P("b", "Giả Thị B", "F", "II", "CLAN", { chi: "I" }),
  P("va", "Vợ Giả A", "F", "", "SPOUSE"),
  P("c", "Giả Văn C", "M", "III", "CLAN", { chi: "I", birth: "1930" }),
  P("d", "Giả Thị D", "F", "III", "CLAN", { chi: "I" }),
  P("e", "Con Của D", "m", "", "EXTERNAL"),
  P("ch", "Chồng Của D", "M", "", "SPOUSE"),
];
const lines = (...extra: string[]) => [...base, ...extra].join("\n");
const codes = (text: string) =>
  parseDsl(text)
    .issues.filter((i) => i.severity === "ERROR")
    .map((i) => i.code);

describe("file trung gian gia phả", () => {
  it("dựng quan hệ: chỉ cha dòng họ truyền dòng cho con dòng họ, kể cả con gái và con nuôi", () => {
    const m = parseDsl(lines("K|ts|-|a:A,b", "K|a|va|c,d", "K|ch|d|e"));
    expect(m.issues.filter((i) => i.severity === "ERROR")).toEqual([]);
    const edge = (p: string, c: string) =>
      m.relations.find((r) => r.parentId === p && r.childId === c)!;
    expect(edge("ts", "a")).toMatchObject({
      relationType: "ADOPTIVE",
      lineageTransmission: true,
    });
    expect(edge("ts", "b")).toMatchObject({
      relationType: "BIOLOGICAL",
      lineageTransmission: true,
    });
    expect(edge("a", "d").lineageTransmission).toBe(true);
    expect(edge("va", "c")).toMatchObject({
      parentRole: "MOTHER",
      lineageTransmission: false,
    });
    expect(edge("ch", "e").lineageTransmission).toBe(false);
    expect(edge("d", "e").lineageTransmission).toBe(false);
  });

  it("tính đời từ thủy tổ và cảnh báo khi lệch với văn bản", () => {
    const m = parseDsl(lines("K|ts|-|a,b", "K|a|va|c", "K|a|va|d"));
    expect(m.derivedGeneration.get("c")).toBe(3);
    const wrong = parseDsl(
      lines("K|ts|-|a,b", "K|a|va|c", "K|a|va|d").replace(
        "|c|Giả Văn C|M|CLAN|III|",
        "|c|Giả Văn C|M|CLAN|V|",
      ),
    );
    expect(
      wrong.issues.some((i) => i.code === "GEN_MISMATCH" && i.ref === "c"),
    ).toBe(true);
  });

  it("yêu cầu đúng một thủy tổ", () => {
    expect(codes(lines("K|ts|-|a", "K|b|-|c"))).toContain("MULTI_ROOT");
    expect(codes(lines("K|ts|-|a,b"))).not.toContain("MULTI_ROOT");
  });

  it("phát hiện chu trình, mã chưa khai báo, trùng mã và trùng quan hệ", () => {
    expect(codes(lines("K|a|-|c", "K|c|-|a"))).toContain("CYCLE");
    expect(codes(lines("K|zz|-|a"))).toContain("UNKNOWN_REF");
    expect(
      codes(`${base.join("\n")}\n${P("a", "Trùng mã", "M", "", "CLAN")}`),
    ).toContain("DUP_ID");
    expect(codes(lines("K|ts|-|a", "K|ts|-|a"))).toContain("DUP_PAIR");
    expect(codes(lines("K|ts|b|a"))).toEqual(
      expect.not.arrayContaining(["SLOT_CONFLICT", "DUP_PAIR"]),
    );
  });

  it("chặn hai cha sinh học và nhiều đường truyền dòng vào cùng một người", () => {
    const text = lines("K|ts|-|a", "K|b|-|a");
    expect(codes(text)).toContain("MULTI_LINEAGE");
    expect(codes(lines("K|ts|-|a", "K|c|-|a"))).toEqual(
      expect.arrayContaining(["SLOT_CONFLICT", "MULTI_LINEAGE"]),
    );
  });

  it("không tự gộp người trùng tên: chỉ cảnh báo, và đánh dấu giới tính suy từ tên", () => {
    const m = parseDsl(
      `${lines("K|ts|-|a")}\n${P("a2", "Giả Văn A", "m", "II", "CLAN", { chi: "I" })}`,
    );
    expect(m.issues.some((i) => i.code === "DUP_NAME")).toBe(true);
    expect(
      m.issues.some((i) => i.code === "SEX_FROM_NAME" && i.ref === "a2"),
    ).toBe(true);
    expect(m.persons.filter((p) => p.name === "Giả Văn A")).toHaveLength(2);
  });

  it("bản ghi sai trường hoặc giá trị bị báo lỗi", () => {
    expect(codes("P|x|thiếu trường")).toContain("BAD_FIELDS");
    expect(codes("P|x|Tên|M|CLAN|I||zz=1")).toContain("BAD_ATTR");
    expect(codes("Z|x")).toContain("BAD_RECORD");
    expect(codes(P("x", "Tên", "X", "I", "CLAN"))).toContain("BAD_SEX");
    expect(codes(P("x", "Tên", "M", "I", "KHAC"))).toContain("BAD_CATEGORY");
  });

  it("chuẩn hóa tên không dấu", () => {
    expect(normalizeName("  Giả  Đức Hòa ")).toBe("gia duc hoa");
  });
});
