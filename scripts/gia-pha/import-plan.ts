// Dựng kế hoạch nạp Firestore từ mô hình gia phả đã kiểm tra (hàm thuần, không I/O).
// Không chứa dữ liệu thật; dữ liệu thật chỉ đi qua từ private-data/ lúc chạy.
import { normalizeName, type Model } from "./dsl.ts";

export interface PlanDoc {
  path: string;
  data: Record<string, unknown>;
}
export interface ImportPlan {
  batchId: string;
  docs: PlanDoc[];
  counts: Record<string, number>;
}

const MONTH_WORDS: Record<string, number> = { giêng: 1 };

export function solarDate(text: string) {
  const original = text.trim();
  if (!original) return null;
  let m: RegExpMatchArray | null;
  if ((m = original.match(/^(\d{4})$/)))
    return {
      calendar: "SOLAR",
      year: Number(m[1]),
      month: null,
      day: null,
      precision: "YEAR",
      approximate: false,
      originalText: original,
    };
  if ((m = original.match(/^(\d{1,2})[/-](\d{4})$/)))
    return {
      calendar: "SOLAR",
      year: Number(m[2]),
      month: Number(m[1]),
      day: null,
      precision: "MONTH",
      approximate: false,
      originalText: original,
    };
  if ((m = original.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)))
    return {
      calendar: "SOLAR",
      year: Number(m[3]),
      month: Number(m[2]),
      day: Number(m[1]),
      precision: "DAY",
      approximate: false,
      originalText: original,
    };
  // Văn bản có nhiều giá trị mâu thuẫn hoặc ghi chú: giữ nguyên, không tự đoán.
  return {
    calendar: "SOLAR",
    year: null,
    month: null,
    day: null,
    precision: "UNKNOWN",
    approximate: false,
    originalText: original,
  };
}

// Kỵ nhật ghi theo âm lịch (ngày/tháng); không tự chuyển sang dương lịch.
export function lunarAnniversary(text: string) {
  const original = text.trim();
  if (!original) return null;
  const m = original.match(
    /^(\d{1,2})\s*[/-]\s*(\d{1,2}|giêng)(?:\s*[/-].*)?$/i,
  );
  let month: number | null = null;
  let day: number | null = null;
  if (m) {
    day = Number(m[1]);
    month = /^\d+$/.test(m[2])
      ? Number(m[2])
      : (MONTH_WORDS[m[2].toLowerCase()] ?? null);
  }
  return {
    calendar: "LUNAR",
    month,
    day,
    leapMonth: null,
    precision: day && month ? "DAY" : "UNKNOWN",
    approximate: false,
    originalText: original,
  };
}

function year(date: ReturnType<typeof solarDate>): number | null {
  return date && date.year !== null ? date.year : null;
}

export function buildImportPlan(model: Model, batchId: string): ImportPlan {
  const docs: PlanDoc[] = [];
  const base = { schemaVersion: 1, importBatchId: batchId };
  for (const p of model.persons) {
    const birth = solarDate(p.birth);
    const death = solarDate(p.death);
    const normalized = normalizeName(p.name);
    docs.push({
      path: `persons/${p.id}`,
      data: {
        displayName: p.name,
        normalizedName: normalized,
        sex: p.sex === "?" ? null : p.sex,
        sexBasis: p.sexBasis,
        category: p.category,
        branchCode: p.branch || null,
        generation: model.derivedGeneration.get(p.id) ?? null,
        declaredGeneration: p.declaredGeneration,
        birth,
        death,
        kyNhat: lunarAnniversary(p.kyNhat),
        profileVersion: 1,
        importRef: p.id,
        ...base,
      },
    });
    // Thành viên chỉ thấy tên và năm sinh/mất (quyết định 2026-11-11); phần còn lại ở persons/personPrivate.
    docs.push({
      path: `memberProfiles/${p.id}`,
      data: {
        displayName: p.name,
        normalizedName: normalized,
        profileVersion: 1,
        schemaVersion: 1,
        ...(year(birth) !== null ? { birthYear: year(birth) } : {}),
        ...(year(death) !== null ? { deathYear: year(death) } : {}),
      },
    });
    if (p.note.trim())
      docs.push({
        path: `personPrivate/${p.id}`,
        data: { note: p.note.trim(), ...base },
      });
  }
  for (const r of model.relations)
    docs.push({
      path: `relations/r-${r.parentId}-${r.childId}`,
      data: {
        parentId: r.parentId,
        childId: r.childId,
        parentRole: r.parentRole,
        relationType: r.relationType,
        lineageTransmission: r.lineageTransmission,
        verificationStatus: "APPROVED",
        version: 1,
        sourceRefs: [`importBatches/${batchId}`],
        ...base,
      },
    });
  for (const u of model.unions)
    docs.push({
      path: `unions/u-${[u.partnerA, u.partnerB].sort().join("-")}`,
      data: {
        partnerIds: [u.partnerA, u.partnerB],
        order: u.order || null,
        status: u.status || null,
        note: u.note || null,
        sourceRefs: [`importBatches/${batchId}`],
        ...base,
      },
    });
  for (const b of model.branches)
    docs.push({
      path: `branches/${b.code}`,
      data: {
        name: b.name,
        founderPersonId: b.founderId || null,
        mergedFrom: b.mergedFrom || null,
        note: b.note || null,
        status: "ACTIVE",
        ...base,
      },
    });
  docs.push({
    path: "graphState/parentage",
    data: { version: 1, schemaVersion: 1 },
  });
  const counts: Record<string, number> = {};
  for (const d of docs) {
    const collection = d.path.split("/")[0];
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  return { batchId, docs, counts };
}

// Các collection mà bản nạp sở hữu (dùng khi --replace trên emulator/dev).
export const IMPORT_COLLECTIONS = [
  "persons",
  "memberProfiles",
  "personPrivate",
  "relations",
  "unions",
  "branches",
  "graphState",
  "importBatches",
];

export type TargetDecision =
  | { ok: true; kind: "emulator" | "dev"; project: string }
  | { ok: false; reason: string };

// Chỉ cho phép emulator cục bộ hoặc project kết thúc bằng -dev. Production bị cấm.
export function decideTarget(
  env: Record<string, string | undefined>,
  project: string | undefined,
): TargetDecision {
  const host = env.FIRESTORE_EMULATOR_HOST;
  if (host) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
      return { ok: false, reason: "FIRESTORE_EMULATOR_HOST phải là loopback." };
    return { ok: true, kind: "emulator", project: project ?? "demo-gia-pha" };
  }
  if (!project)
    return { ok: false, reason: "Thiếu --project (hoặc đặt emulator)." };
  if (/prod/i.test(project) || !/-dev$/.test(project))
    return {
      ok: false,
      reason:
        "Chỉ nạp vào emulator hoặc project dev (-dev). Production bị cấm ở bước này.",
    };
  if (!env.GOOGLE_APPLICATION_CREDENTIALS)
    return {
      ok: false,
      reason: "Thiếu GOOGLE_APPLICATION_CREDENTIALS (khóa để ngoài repo).",
    };
  return { ok: true, kind: "dev", project };
}
