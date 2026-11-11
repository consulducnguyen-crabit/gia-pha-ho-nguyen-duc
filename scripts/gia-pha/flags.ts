// Cờ "cần kiểm tra" tính từ dữ liệu gia phả (hàm thuần). Không chứa dữ liệu thật.
import { FLAG_CODES, type FlagCode, type Model } from "./dsl.ts";

export const FLAG_LABELS: Record<FlagCode, string> = {
  BIRTH_CONFLICT: "Năm sinh/mất trong tài liệu gốc mâu thuẫn",
  UNCONNECTED: "Chưa xác định vị trí trong cây",
  DUP_NAME: "Trùng họ tên cùng đời với người khác, cần phân biệt",
  NAME_UNKNOWN: "Chưa rõ tên",
  VERIFY: "Tài liệu gốc chưa rõ, cần xác minh",
};

const YEAR_CONFLICT = /\d{4}\s*\/\s*\d{4}/;

/** Trả về cờ cho từng người (chỉ người có ít nhất một cờ), theo thứ tự cố định của FLAG_CODES. */
export function computeReviewFlags(model: Model): Map<string, FlagCode[]> {
  const found = new Map<string, Set<FlagCode>>();
  const add = (id: string, code: FlagCode) => {
    if (!found.has(id)) found.set(id, new Set());
    found.get(id)!.add(code);
  };
  const hasRoot = model.derivedGeneration.size > 0;
  for (const p of model.persons) {
    if (YEAR_CONFLICT.test(p.birth) || YEAR_CONFLICT.test(p.death))
      add(p.id, "BIRTH_CONFLICT");
    if (/chưa rõ/i.test(p.name)) add(p.id, "NAME_UNKNOWN");
    if (p.note.includes("CẦN XÁC MINH")) add(p.id, "VERIFY");
    if (hasRoot && p.category === "CLAN" && !model.derivedGeneration.has(p.id))
      add(p.id, "UNCONNECTED");
    for (const code of p.explicitFlags) add(p.id, code);
  }
  for (const issue of model.issues)
    if (issue.code === "DUP_NAME")
      for (const id of issue.ref.split(",").map((x) => x.trim()))
        if (id) add(id, "DUP_NAME");
  const verified = new Map(model.persons.map((p) => [p.id, p.verifiedFlags]));
  const result = new Map<string, FlagCode[]>();
  for (const [id, codes] of found) {
    if (!verified.has(id)) continue;
    const kept = FLAG_CODES.filter(
      (c) => codes.has(c) && !verified.get(id)!.includes(c),
    );
    if (kept.length) result.set(id, kept);
  }
  return result;
}
