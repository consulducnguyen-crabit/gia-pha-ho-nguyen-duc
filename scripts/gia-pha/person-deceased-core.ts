// Lập kế hoạch chuẩn hóa "Đã mất" hàng loạt theo đời (hàm thuần, không I/O). Dùng cho lệnh gia-pha:person-deceased.
// Quy tắc đã duyệt: mọi thành viên đời 1..maxGeneration (CLAN) và MỌI vợ/chồng của họ (người nằm cùng một union)
// đều đã mất ⇒ đặt persons/{id}.deceased = true và phần tử "đã mất" (9) trong ảnh chụp treeSnapshots/main.
// Đời lấy từ ảnh chụp (nguồn mà giao diện đang hiển thị), đối chiếu HAI CHIỀU với persons doc. Chỉ in mã người, không in tên.
type Doc = Record<string, unknown>;

/** Phải khớp SNAPSHOT_MAX_BYTES ở src/editCore.ts (có test đối chiếu ở tests/personDeceased.test.ts). */
export const SNAPSHOT_MAX_BYTES = 850000;
/** Giao dịch Firestore ghi tối đa 500 tài liệu; chừa chỗ cho ảnh chụp và nhật ký. */
export const MAX_WRITES = 450;
/** Người sinh từ năm này trở đi được báo "có thể còn sống" để người duyệt xem lại (vẫn đánh dấu theo quy tắc đã duyệt). */
export const RECENT_BIRTH_YEAR = 1940;

export type Role = "ANCESTOR" | "SPOUSE";
/** Trạng thái TRƯỚC khi đổi, lưu vào nhật ký để hoàn tác đúng (không ép false). Không có tên. */
export interface Before {
  /** persons.deceased trước đó. */
  deceased: boolean;
  /** Phần tử 9 của bộ trước đó (null = bộ mới 8 phần tử, chưa có). */
  tuple: boolean | null;
  /** persons.profileVersion sau khi lệnh ghi (để phát hiện sửa tay sau đó). */
  afterVersion: number;
}
export interface Change {
  id: string;
  role: Role;
  /** Giá trị "đã mất" sẽ ghi (true khi đánh dấu; khi hoàn tác là giá trị trước đó). */
  to: boolean;
  /** Đặt khi đánh dấu: trạng thái trước + profileVersion sau khi ghi. */
  before?: Before;
  /** profileVersion sẽ ghi (= hiện tại + 1). */
  nextVersion: number;
}
export interface DeceasedStats {
  persons: number;
  /** Người đời 1..maxGeneration (CLAN). */
  ancestors: number;
  /** Vợ/chồng của những người đó (không tính trùng, không tính người đã là đời 1..max). */
  spouses: number;
  /** Trong số trên: đã đánh dấu từ trước (bỏ qua, idempotent). */
  alreadyDeceased: number;
  /** Số người thật sự sẽ đổi. */
  toChange: number;
}
export type DeceasedPlan =
  | {
      json: string;
      editVersion: number;
      stats: DeceasedStats;
      changes: Change[];
      /** Mã cần người xem lại, KHÔNG tự đổi: vợ/chồng thuộc dòng họ (CLAN) đời > giới hạn hoặc loại EXTERNAL. */
      review: string[];
      /** Mã (trong số sẽ đổi) sinh từ RECENT_BIRTH_YEAR: có thể còn sống, nên xem lại bằng --show. */
      recentBirth: string[];
      /** Khi hoàn tác: mã bị bỏ qua vì đã được sửa tay sau lần đánh dấu (profileVersion khác). */
      skippedEdited: string[];
    }
  | { errors: string[] };

const TUPLE_WITH_SEX = 8;

export type UndoRecord = Before & { id: string };

/**
 * mode "mark": đánh dấu đã mất cho đời 1..maxGeneration và vợ/chồng.
 * mode "undo": hoàn tác theo `undo` (lấy từ nhật ký của lần đánh dấu): khôi phục ĐÚNG trạng thái trước đó; người đã được
 * sửa tay sau lần đánh dấu (profileVersion khác) hoặc không còn đúng trạng thái do lệnh ghi thì bỏ qua và báo.
 * Dừng (errors) khi: ảnh chụp hỏng; bộ chưa có giới tính (chạy gia-pha:snapshot-sex trước); người không có persons doc,
 * đã bị ẩn; persons và ảnh chụp lệch nhau về đời/loại (kiểm cả hai chiều); deceased sai kiểu; quá MAX_WRITES; vượt trần.
 */
export function planPersonDeceased(
  snapshot: Doc | null | undefined,
  persons: Map<string, Doc>,
  options:
    | { mode: "mark"; maxGeneration: number }
    | { mode: "undo"; undo: UndoRecord[] },
): DeceasedPlan {
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.data !== "string"
  )
    return { errors: ["treeSnapshots/main thiếu hoặc sai định dạng."] };
  const v = snapshot.editVersion;
  if (
    v !== undefined &&
    (typeof v !== "number" || !Number.isInteger(v) || v < 0)
  )
    return { errors: ["editVersion của ảnh chụp không hợp lệ."] };
  let data: {
    v?: unknown;
    persons?: Record<string, unknown>;
    unions?: unknown;
  };
  try {
    data = JSON.parse(snapshot.data);
  } catch {
    return { errors: ["Ảnh chụp cây không đọc được."] };
  }
  if (
    !data ||
    typeof data !== "object" ||
    data.v !== 1 ||
    !data.persons ||
    typeof data.persons !== "object" ||
    !Array.isArray(data.unions)
  )
    return { errors: ["Ảnh chụp cây sai định dạng."] };
  if (
    options.mode === "mark" &&
    (!Number.isInteger(options.maxGeneration) || options.maxGeneration < 1)
  )
    return { errors: ["maxGeneration phải là số nguyên từ 1."] };

  const errors: string[] = [];
  const tuples = new Map<string, unknown[]>();
  for (const [id, raw] of Object.entries(data.persons)) {
    if (!Array.isArray(raw) || raw.length < 6 || raw.length > 10) {
      errors.push(`BAD_TUPLE: ${id}`);
      continue;
    }
    tuples.set(id, raw);
  }
  const partners = new Map<string, Set<string>>();
  for (const row of data.unions as unknown[]) {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      typeof row[0] !== "string" ||
      typeof row[1] !== "string" ||
      !tuples.has(row[0]) ||
      !tuples.has(row[1])
    ) {
      errors.push("BAD_UNION");
      continue;
    }
    for (const [x, y] of [
      [row[0], row[1]],
      [row[1], row[0]],
    ] as const)
      partners.set(x, (partners.get(x) ?? new Set()).add(y));
  }

  const changes: Change[] = [];
  const review: string[] = [];
  const recentBirth: string[] = [];
  const skippedEdited: string[] = [];
  const stats: DeceasedStats = {
    persons: tuples.size,
    ancestors: 0,
    spouses: 0,
    alreadyDeceased: 0,
    toChange: 0,
  };
  const targets = new Map<string, { role: Role; to: boolean }>();
  const undoById = new Map<string, UndoRecord>();
  if (options.mode === "mark") {
    const max = options.maxGeneration;
    // Đối chiếu hai chiều persons ↔ ảnh chụp cho mọi người DÒNG HỌ đời 1..max (kể cả người chỉ có trong persons).
    for (const [id, doc] of persons) {
      if (
        doc.deleted !== true &&
        doc.category === "CLAN" &&
        typeof doc.generation === "number" &&
        doc.generation >= 1 &&
        doc.generation <= max
      ) {
        const t = tuples.get(id);
        if (!t) errors.push(`PERSON_NOT_IN_SNAPSHOT: ${id}`);
        else if (t[3] !== doc.generation || t[4] !== "C")
          errors.push(`GENERATION_MISMATCH: ${id}`);
      }
    }
    for (const [id, t] of tuples)
      if (
        t[4] === "C" &&
        typeof t[3] === "number" &&
        t[3] >= 1 &&
        t[3] <= max
      ) {
        const doc = persons.get(id);
        if (doc && (doc.generation !== t[3] || doc.category !== "CLAN"))
          errors.push(`GENERATION_MISMATCH: ${id}`);
        targets.set(id, { role: "ANCESTOR", to: true });
      }
    for (const id of [...targets.keys()])
      for (const sp of partners.get(id) ?? []) {
        if (targets.has(sp)) continue;
        const t = tuples.get(sp)!;
        // Chỉ vợ/chồng loại SPOUSE được tự đánh dấu. CLAN (đời > giới hạn hoặc chưa rõ) và EXTERNAL là ca bất thường:
        // không tự đổi, báo để người duyệt xem lại.
        if (t[4] !== "S") {
          if (!review.includes(sp)) review.push(sp);
          continue;
        }
        targets.set(sp, { role: "SPOUSE", to: true });
      }
  } else {
    for (const u of options.undo) {
      if (!tuples.has(u.id)) {
        errors.push(`UNDO_UNKNOWN: ${u.id}`);
        continue;
      }
      undoById.set(u.id, u);
      targets.set(u.id, { role: "ANCESTOR", to: u.deceased });
    }
  }

  for (const [id, target] of targets) {
    const doc = persons.get(id);
    if (!doc) {
      errors.push(`PERSON_DOC_MISSING: ${id}`);
      continue;
    }
    if (doc.deleted === true) {
      errors.push(`PERSON_HIDDEN: ${id}`);
      continue;
    }
    if (doc.deceased !== undefined && typeof doc.deceased !== "boolean") {
      errors.push(`DECEASED_INVALID: ${id}`);
      continue;
    }
    const t = tuples.get(id)!;
    if (t.length < TUPLE_WITH_SEX) {
      errors.push(`NEEDS_SEX_FIRST: ${id}`);
      continue;
    }
    const pv = typeof doc.profileVersion === "number" ? doc.profileVersion : 0;
    const currentDeceased = doc.deceased === true;
    const currentTuple = t.length >= 9 ? (t[8] as boolean) : null;
    if (options.mode === "undo") {
      const u = undoById.get(id)!;
      // Đã sửa tay sau lần đánh dấu, hoặc đã trở về trạng thái cũ: không đụng vào.
      if (pv !== u.afterVersion) {
        skippedEdited.push(id);
        continue;
      }
      if (currentDeceased === u.deceased && currentTuple === (u.tuple ?? false))
        continue;
      stats.ancestors++;
      changes.push({
        id,
        role: "ANCESTOR",
        to: u.deceased,
        nextVersion: pv + 1,
      });
      continue;
    }
    if (target.role === "ANCESTOR") stats.ancestors++;
    else stats.spouses++;
    if (currentDeceased && currentTuple === true) {
      stats.alreadyDeceased++;
      continue;
    }
    changes.push({
      id,
      role: target.role,
      to: true,
      before: {
        deceased: currentDeceased,
        tuple: currentTuple,
        afterVersion: pv + 1,
      },
      nextVersion: pv + 1,
    });
    const birth = t[1];
    if (typeof birth === "number" && birth >= RECENT_BIRTH_YEAR)
      recentBirth.push(id);
  }
  if (errors.length) return { errors: [...new Set(errors)] };
  if (changes.length > MAX_WRITES)
    return {
      errors: [
        `Cần đổi ${changes.length} người, vượt ${MAX_WRITES} tài liệu cho một giao dịch; giảm phạm vi rồi chạy lại.`,
      ],
    };
  for (const c of changes) {
    // Chưa có phần tử ghi chú thì giữ nguyên độ dài 9 (lệnh gia-pha:snapshot-note sẽ nâng lên 10 sau).
    tuples.get(c.id)![8] = c.to;
  }
  stats.toChange = changes.length;
  const json = JSON.stringify(data);
  if (new TextEncoder().encode(json).length > SNAPSHOT_MAX_BYTES)
    return {
      errors: [`Ảnh chụp vượt trần ${SNAPSHOT_MAX_BYTES} byte; không ghi.`],
    };
  return {
    json,
    editVersion: (v as number | undefined) ?? 0,
    stats,
    changes,
    review,
    recentBirth,
    skippedEdited,
  };
}
