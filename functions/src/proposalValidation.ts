import { HttpsError } from "firebase-functions/v2/https";

function bad(message = "Dữ liệu đề xuất không hợp lệ."): never {
  throw new HttpsError("invalid-argument", message);
}
function conflict(message: string): never {
  throw new HttpsError("failed-precondition", message);
}
export function objectInput(
  raw: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(raw, key))
  )
    return bad();
  return raw as Record<string, unknown>;
}
export function safeId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw))
    return bad();
  return raw;
}
export function requestId(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      raw,
    )
  )
    return bad();
  return raw;
}
function integer(raw: unknown, minimum: number): number {
  if (
    !Number.isSafeInteger(raw) ||
    (raw as number) < minimum ||
    (raw as number) >= Number.MAX_SAFE_INTEGER
  )
    return bad();
  return raw as number;
}
export const positiveRevision = (raw: unknown) => integer(raw, 1);
function text(raw: unknown, max: number, empty = false): string {
  if (
    typeof raw !== "string" ||
    raw.length > max ||
    (!empty && !raw.trim()) ||
    [...raw].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    return bad();
  return raw.trim();
}
export interface PersonOperation {
  kind: "PERSON_BASIC";
  personId: string;
  baseVersion: number;
  displayName: string;
  evidence: string;
}
export interface RelationOperation {
  kind: "RELATION_CREATE";
  relationId: string;
  parentId: string;
  childId: string;
  parentRole: "FATHER" | "MOTHER";
  relationType: "BIOLOGICAL" | "ADOPTIVE";
  lineageTransmission: boolean;
  lineageReason: string;
  evidence: string;
}
export type Operation = PersonOperation | RelationOperation;
export function parseOperation(raw: unknown): Operation {
  const kind =
    raw && typeof raw === "object" && "kind" in raw ? raw.kind : undefined;
  if (kind === "PERSON_BASIC") {
    const d = objectInput(raw, [
      "kind",
      "personId",
      "baseVersion",
      "displayName",
      "evidence",
    ]);
    return {
      kind,
      personId: safeId(d.personId),
      baseVersion: integer(d.baseVersion, 0),
      displayName: text(d.displayName, 160),
      evidence: text(d.evidence, 1000),
    };
  }
  if (kind === "RELATION_CREATE") {
    const d = objectInput(raw, [
      "kind",
      "relationId",
      "parentId",
      "childId",
      "parentRole",
      "relationType",
      "lineageTransmission",
      "lineageReason",
      "evidence",
    ]);
    if (
      (d.parentRole !== "FATHER" && d.parentRole !== "MOTHER") ||
      (d.relationType !== "BIOLOGICAL" && d.relationType !== "ADOPTIVE") ||
      typeof d.lineageTransmission !== "boolean"
    )
      return bad();
    const parentId = safeId(d.parentId),
      childId = safeId(d.childId);
    if (parentId === childId)
      return bad("Một người không thể là cha/mẹ của chính mình.");
    // Chính sách 2026-11-11: dòng họ nội truyền theo nam (vai trò cha được chỉ
    // định rõ, không suy từ họ hay giới tính). Con nuôi cũng tính đời theo dòng.
    if (d.lineageTransmission && d.parentRole !== "FATHER")
      return bad("Chỉ quan hệ với người cha mới truyền dòng họ nội.");
    return {
      kind,
      relationId: safeId(d.relationId),
      parentId,
      childId,
      parentRole: d.parentRole as RelationOperation["parentRole"],
      relationType: d.relationType as RelationOperation["relationType"],
      lineageTransmission: d.lineageTransmission,
      lineageReason: text(d.lineageReason, 1000, true),
      evidence: text(d.evidence, 1000),
    };
  }
  return bad();
}
// Chính sách 2026-11-11: mọi thay đổi, kể cả truyền dòng, cần một người duyệt
// (khác người đề xuất). Kiểu 1 | 2 giữ lại để đọc được bản ghi cũ.
export function requiredApprovals(): 1 {
  return 1;
}
export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .trim();
}

export function assertGraphCanAdd(
  records: Array<Record<string, unknown>>,
  op: RelationOperation,
) {
  if (records.length >= 200)
    conflict(
      "Đã đạt giới hạn đồ thị thử nghiệm 200 quan hệ; cần kiểm tra riêng trước khi mở rộng.",
    );
  const edges = records.map((d) => {
    try {
      if (d.schemaVersion !== 1 || d.verificationStatus !== "APPROVED")
        throw Error();
      positiveRevision(d.version);
      const parentId = safeId(d.parentId),
        childId = safeId(d.childId);
      if (
        parentId === childId ||
        (d.parentRole !== "FATHER" && d.parentRole !== "MOTHER") ||
        (d.relationType !== "BIOLOGICAL" && d.relationType !== "ADOPTIVE") ||
        typeof d.lineageTransmission !== "boolean"
      )
        throw Error();
      return {
        parentId,
        childId,
        parentRole: d.parentRole,
        relationType: d.relationType,
        lineageTransmission: d.lineageTransmission,
      };
    } catch {
      return conflict(
        "Đồ thị có quan hệ cũ chưa được phân loại hoặc sai cấu trúc; cần kiểm chứng riêng.",
      );
    }
  });
  const pairs = new Set<string>(),
    slots = new Set<string>(),
    lineage = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const edge of [...edges, op]) {
    const pair = JSON.stringify([edge.parentId, edge.childId]);
    const slot = JSON.stringify([
      edge.childId,
      edge.relationType,
      edge.parentRole,
    ]);
    if (pairs.has(pair))
      conflict("Quan hệ cha/mẹ–con đã tồn tại; không tự gộp hoặc ghi đè.");
    if (slots.has(slot))
      conflict("Có xung đột vai trò cha/mẹ; cần xác minh trước khi thay đổi.");
    if (edge.lineageTransmission && lineage.has(edge.childId))
      conflict(
        "Có nhiều đường truyền dòng vào cùng một người; cần xác minh riêng.",
      );
    pairs.add(pair);
    slots.add(slot);
    if (edge.lineageTransmission) lineage.add(edge.childId);
    adjacency.set(edge.parentId, [
      ...(adjacency.get(edge.parentId) ?? []),
      edge.childId,
    ]);
  }
  // Chính sách 2026-11-11: một thủy tổ duy nhất. Gốc truyền dòng = người có con
  // theo dòng nhưng không có cha truyền dòng. Người kết hôn vào (không có cạnh
  // truyền dòng) không được tính. Chỉ kiểm tra trạng thái sau khi thêm, nên
  // việc nối hai gốc thành một vẫn hợp lệ.
  const lineageEdges = [...edges, op].filter(
    (edge) => edge.lineageTransmission,
  );
  const lineageChildren = new Set(lineageEdges.map((edge) => edge.childId));
  const lineageRoots = new Set(
    lineageEdges
      .map((edge) => edge.parentId)
      .filter((id) => !lineageChildren.has(id)),
  );
  if (lineageRoots.size > 1)
    conflict(
      "Dòng họ chỉ có một thủy tổ: quan hệ này tạo thêm một gốc chưa nối. Hãy nối từ thủy tổ xuống hoặc nối gốc hiện có lên.",
    );
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id))
      conflict(
        "Quan hệ tạo vòng lặp tổ tiên hoặc đồ thị hiện tại đã có vòng lặp.",
      );
    if (done.has(id)) return;
    visiting.add(id);
    for (const child of adjacency.get(id) ?? []) visit(child);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of adjacency.keys()) visit(id);
}
