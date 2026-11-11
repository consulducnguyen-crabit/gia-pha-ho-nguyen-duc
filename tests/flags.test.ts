import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDsl } from "../scripts/gia-pha/dsl";
import { FLAG_LABELS, computeReviewFlags } from "../scripts/gia-pha/flags";
import { buildImportPlan } from "../scripts/gia-pha/import-plan";
import {
  FLAG_LABELS as UI_LABELS,
  FLAG_ORDER,
  parseSnapshot,
} from "../src/treeModel";

// Dữ liệu hoàn toàn giả.
const P = (
  id: string,
  name: string,
  cat: string,
  gen: string,
  attrs = "",
  note = "",
) => ["P", id, name, "M", cat, gen, "", attrs, note].join("|");
const text = [
  P("ts", "Cụ Giả Thủy Tổ", "CLAN", "I"),
  P("a", "Giả Văn An", "CLAN", "II", "b=1950/1951"),
  P("b", "Giả Văn Bình", "CLAN", "II", "fl=VERIFY"),
  P("c", "Giả Văn An", "CLAN", "II"),
  P("d", "Cụ Giả (chưa rõ tên)", "CLAN", "III"),
  P("e", "Giả Văn Lẻ", "CLAN", "IV", "", "CẦN XÁC MINH cha"),
  P("f", "Người Ngoài", "EXTERNAL", ""),
  "K|ts|-|a,b,c",
  "K|c|-|d",
].join("\n");

describe("cờ cần kiểm tra", () => {
  const model = parseDsl(text);
  const flags = computeReviewFlags(model);
  it("tự động phát hiện năm sinh mâu thuẫn, trùng tên, chưa rõ tên, chưa nối", () => {
    expect(flags.get("a")).toEqual(["BIRTH_CONFLICT", "DUP_NAME"]);
    expect(flags.get("c")).toEqual(["DUP_NAME"]);
    expect(flags.get("d")).toEqual(["NAME_UNKNOWN"]);
    expect(flags.get("e")).toEqual(["UNCONNECTED", "VERIFY"]);
  });
  it("cờ thủ công và ghi chú CẦN XÁC MINH; người sạch không có cờ", () => {
    expect(flags.get("b")).toEqual(["VERIFY"]);
    expect(flags.has("ts")).toBe(false);
    expect(flags.has("f")).toBe(false);
  });
  it("mã cờ lạ bị báo lỗi", () => {
    const bad = parseDsl(P("x", "Giả", "CLAN", "I", "fl=SAI"));
    expect(bad.issues.some((i) => i.code === "BAD_FLAG")).toBe(true);
  });
  it("đi vào ảnh chụp cây và giao diện đọc được, kể cả bản cũ 6 phần tử", () => {
    const plan = buildImportPlan(model, "import-test");
    const snap = plan.docs.find((d) => d.path === "treeSnapshots/main")!.data;
    const parsed = parseSnapshot(snap);
    expect(parsed.persons.get("a")!.flags).toEqual([
      "BIRTH_CONFLICT",
      "DUP_NAME",
    ]);
    expect(parsed.persons.get("ts")!.flags).toEqual([]);
    const persons = plan.docs.find((d) => d.path === "persons/a")!.data;
    expect(persons.reviewFlags).toEqual(["BIRTH_CONFLICT", "DUP_NAME"]);
    const old = {
      schemaVersion: 1,
      dataVersion: "x",
      data: JSON.stringify({
        v: 1,
        persons: { a: ["A", null, null, 1, "C", null] },
        relations: [],
        unions: [],
        branches: {},
      }),
    };
    expect(parseSnapshot(old).persons.get("a")!.flags).toEqual([]);
    const bad = {
      ...old,
      data: JSON.stringify({
        v: 1,
        persons: { a: ["A", null, null, 1, "C", null, ["SAI"]] },
        relations: [],
        unions: [],
        branches: {},
      }),
    };
    expect(() => parseSnapshot(bad)).toThrow();
  });
  it("nhãn giao diện khớp nhãn của script và đủ mã", () => {
    expect(UI_LABELS).toEqual(FLAG_LABELS);
    expect([...FLAG_ORDER].sort()).toEqual(Object.keys(FLAG_LABELS).sort());
  });
  it("bộ demo có đủ các loại cờ", () => {
    const demo = parseDsl(
      readFileSync("scripts/gia-pha/demo/gia-pha-demo.txt", "utf8"),
    );
    expect(demo.issues.filter((i) => i.severity === "ERROR")).toEqual([]);
    const seen = new Set([...computeReviewFlags(demo).values()].flat());
    for (const code of [
      "BIRTH_CONFLICT",
      "UNCONNECTED",
      "DUP_NAME",
      "NAME_UNKNOWN",
      "VERIFY",
    ])
      expect(seen.has(code as never)).toBe(true);
  });
});
