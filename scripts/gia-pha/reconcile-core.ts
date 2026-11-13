// Đối soát treeSnapshots/main với persons, memberProfiles, relations, unions và nhật ký sửa (hàm thuần).
// Rules không phân tích JSON của snapshot nên đây là lớp kiểm cuối. Kết quả CHỈ chứa mã (không chứa tên/ghi chú).
type Doc = Record<string, unknown>;

export interface ReconcileInput {
  snapshot: Doc | null;
  persons: Map<string, Doc>;
  memberProfiles: Map<string, Doc>;
  relations: Map<string, Doc>;
  unions: Map<string, Doc>;
  /** Nhật ký sửa trong app: id tài liệu → editVersion + sự kiện. */
  edits: { id: string; editVersion: unknown; event: unknown }[];
}
export interface Issue {
  code: string;
  ref: string;
}

const CAT: Record<string, string> = {
  C: "CLAN",
  S: "SPOUSE",
  E: "EXTERNAL",
};
const live = (d: Doc | undefined) => !!d && d.deleted !== true;

export function reconcile(input: ReconcileInput): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, ref: string) => issues.push({ code, ref });
  const { snapshot } = input;
  if (!snapshot || typeof snapshot.data !== "string") {
    add("SNAPSHOT_MISSING", "treeSnapshots/main");
    return issues;
  }
  let data: {
    persons?: Record<string, unknown[]>;
    relations?: unknown[][];
    unions?: unknown[][];
  };
  try {
    data = JSON.parse(snapshot.data);
  } catch {
    add("SNAPSHOT_UNREADABLE", "treeSnapshots/main");
    return issues;
  }
  const persons = data.persons ?? {};
  const rels = data.relations ?? [];
  const unions = data.unions ?? [];

  // Người: hai chiều + thông tin hiển thị khớp.
  for (const [id, t] of Object.entries(persons)) {
    const p = input.persons.get(id);
    if (!live(p)) {
      add("SNAPSHOT_PERSON_NOT_LIVE", id);
      continue;
    }
    if (t[0] !== p!.displayName) add("NAME_MISMATCH", id);
    if (CAT[String(t[4])] !== p!.category) add("CATEGORY_MISMATCH", id);
    if ((t[5] ?? null) !== (p!.branchCode ?? null)) add("BRANCH_MISMATCH", id);
    const mp = input.memberProfiles.get(id);
    if (!mp) add("MEMBER_PROFILE_MISSING", id);
    else {
      if (mp.displayName !== p!.displayName) add("MEMBER_NAME_MISMATCH", id);
      if ((t[1] ?? null) !== (mp.birthYear ?? null))
        add("BIRTH_YEAR_MISMATCH", id);
      if ((t[2] ?? null) !== (mp.deathYear ?? null))
        add("DEATH_YEAR_MISMATCH", id);
    }
    // Giới tính trong ảnh chụp (phần tử 8) phải bằng persons.sex; bộ cũ chưa có thì chỉ cảnh báo (reconcileWarnings).
    if (t.length >= 8 && t[7] !== ((p!.sex as unknown) ?? null))
      add("SEX_MISMATCH", id);
    const flags = (Array.isArray(t[6]) ? t[6] : []).map(String).sort();
    const want = (Array.isArray(p!.reviewFlags) ? p!.reviewFlags : [])
      .map(String)
      .sort();
    if (flags.join() !== want.join()) add("FLAGS_MISMATCH", id);
  }
  for (const [id, p] of input.persons)
    if (live(p) && !Object.hasOwn(persons, id))
      add("PERSON_NOT_IN_SNAPSHOT", id);
  for (const id of input.memberProfiles.keys())
    if (!live(input.persons.get(id))) add("MEMBER_PROFILE_FOR_HIDDEN", id);

  // Quan hệ cha/mẹ–con.
  const rowKey = (r: unknown[]) => `r-${String(r[0])}-${String(r[1])}`;
  const rowIds = new Set<string>();
  const roleSeen = new Set<string>();
  for (const r of rels) {
    const id = rowKey(r);
    if (rowIds.has(id)) add("DUP_RELATION_ROW", id);
    rowIds.add(id);
    if (
      !Object.hasOwn(persons, String(r[0])) ||
      !Object.hasOwn(persons, String(r[1]))
    )
      add("RELATION_ENDPOINT_MISSING", id);
    if (r[0] === r[1]) add("SELF_PARENT", id);
    // Khớp quy tắc nạp (dsl.ts): chỉ cấm hai cha/mẹ CÙNG vai trò VÀ CÙNG loại (ruột/nuôi).
    const role = `${String(r[1])}:${String(r[2])}:${String(r[3])}`;
    if (roleSeen.has(role)) add("DUP_PARENT_ROLE", role);
    roleSeen.add(role);
    const d = input.relations.get(id);
    if (!live(d)) {
      add("SNAPSHOT_RELATION_NOT_LIVE", id);
      continue;
    }
    const want = {
      parentRole: r[2] === "F" ? "FATHER" : "MOTHER",
      relationType: r[3] === "A" ? "ADOPTIVE" : "BIOLOGICAL",
      lineageTransmission: r[4] === 1,
    };
    for (const [k, v] of Object.entries(want))
      if (d![k] !== v) add(`RELATION_${k.toUpperCase()}_MISMATCH`, id);
  }
  for (const [id, d] of input.relations)
    if (live(d) && !rowIds.has(id)) add("RELATION_NOT_IN_SNAPSHOT", id);

  // Vòng lặp cha/mẹ.
  const up = new Map<string, string[]>();
  for (const r of rels)
    up.set(String(r[1]), [...(up.get(String(r[1])) ?? []), String(r[0])]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, stack: Set<string>): boolean => {
    if (state.get(id) === 2) return false;
    if (stack.has(id)) return true;
    stack.add(id);
    for (const p of up.get(id) ?? []) if (visit(p, stack)) return true;
    stack.delete(id);
    state.set(id, 2);
    return false;
  };
  for (const id of up.keys())
    if (visit(id, new Set())) {
      add("PARENT_CYCLE", id);
      break;
    }

  // Đời: tính lại theo cạnh truyền dòng từ người dòng họ không có cha theo dòng nhưng có đời.
  const kids = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const r of rels)
    if (r[4] === 1) {
      kids.set(String(r[0]), [...(kids.get(String(r[0])) ?? []), String(r[1])]);
      hasParent.add(String(r[1]));
    }
  const roots = [...kids.keys()].filter(
    (id) =>
      !hasParent.has(id) &&
      persons[id]?.[4] === "C" &&
      typeof persons[id]?.[3] === "number",
  );
  if (roots.length !== 1) add("ROOT_COUNT", String(roots.length));
  else {
    const depth = new Map<string, number>([
      [roots[0], persons[roots[0]][3] as number],
    ]);
    const queue = [roots[0]];
    while (queue.length) {
      const id = queue.shift()!;
      for (const c of kids.get(id) ?? [])
        if (!depth.has(c)) {
          depth.set(c, depth.get(id)! + 1);
          queue.push(c);
        }
    }
    for (const [id, t] of Object.entries(persons)) {
      const want = depth.get(id) ?? null;
      const have = typeof t[3] === "number" ? t[3] : null;
      if (want !== have) add("GENERATION_MISMATCH", id);
    }
  }

  // Vợ/chồng.
  const unionIds = new Set<string>();
  for (const u of unions) {
    const id = `u-${[String(u[0]), String(u[1])].sort().join("-")}`;
    if (unionIds.has(id)) add("SNAPSHOT_UNION_DUPLICATE", id);
    if (u[0] === u[1]) add("UNION_SELF", id);
    unionIds.add(id);
    if (
      !Object.hasOwn(persons, String(u[0])) ||
      !Object.hasOwn(persons, String(u[1]))
    )
      add("UNION_ENDPOINT_MISSING", id);
    const pids = input.unions.get(id)?.partnerIds;
    if (
      Array.isArray(pids) &&
      [...pids].map(String).sort().join() !==
        [String(u[0]), String(u[1])].sort().join()
    )
      add("UNION_PARTNERS_MISMATCH", id);
    const ud = input.unions.get(id);
    if (ud && (ud.order ?? null) !== (u[2] ?? null))
      add("UNION_ORDER_MISMATCH", id);
    if (!live(input.unions.get(id))) add("SNAPSHOT_UNION_NOT_LIVE", id);
  }
  for (const [id, d] of input.unions)
    if (live(d) && !unionIds.has(id)) add("UNION_NOT_IN_SNAPSHOT", id);
  // Liên kết vợ/chồng đã GỠ (UNION_REMOVED) phải ở đúng trạng thái: đã ẩn và không mang dấu "ẩn cùng người",
  // nếu không khôi phục người có thể hồi sinh nhầm liên kết đã gỡ.
  for (const [id, d] of input.unions)
    if (
      d.removedAtVersion !== undefined &&
      d.removedAtVersion !== null &&
      (d.deleted !== true ||
        (d.deletedWith !== undefined && d.deletedWith !== null) ||
        // removedAtVersion phải trỏ tới nhật ký edit-N có sự kiện UNION_REMOVED.
        !input.edits.some(
          (e) =>
            e.editVersion === d.removedAtVersion && e.event === "UNION_REMOVED",
        ))
    )
      add("UNION_REMOVED_BAD_STATE", id);

  // Phiên bản sửa: liên tục từ 1 và khớp snapshot.
  const versions = input.edits
    .map((e) => e.editVersion)
    .filter((v): v is number => typeof v === "number" && Number.isInteger(v));
  if (versions.length !== input.edits.length) add("AUDIT_BAD_VERSION", "all");
  const max = versions.length ? Math.max(...versions) : 0;
  const snapVersion =
    typeof snapshot.editVersion === "number" ? snapshot.editVersion : 0;
  if (snapVersion !== max)
    add("EDIT_VERSION_MISMATCH", `${snapVersion}/${max}`);
  const set = new Set(versions);
  if (set.size !== versions.length) add("AUDIT_DUP_VERSION", "all");
  for (let v = 1; v <= max; v++)
    if (!set.has(v)) {
      add("AUDIT_GAP", String(v));
      break;
    }
  for (const e of input.edits)
    if (typeof e.editVersion === "number" && e.id !== `edit-${e.editVersion}`)
      add("AUDIT_ID_MISMATCH", e.id);
  return issues;
}

const MAX_DEPTH = 500;

// Cảnh báo (KHÔNG làm đối soát thất bại): người CLAN thuộc cây con của người khai chi X nhưng branchCode khác chi của X.
// Đi ngược theo cha/mẹ có lineageTransmission (con nuôi tính như ruột), dừng ở tầng gần nhất có người khai chi.
// Không suy chi từ họ/giới tính; SPOUSE/EXTERNAL bị bỏ qua. Chỉ trả mã + mã người (không tên).
export function reconcileWarnings(input: ReconcileInput): Issue[] {
  const out: Issue[] = [];
  const { snapshot } = input;
  if (!snapshot || typeof snapshot.data !== "string") return out;
  let data: {
    persons?: Record<string, unknown[]>;
    relations?: unknown[][];
    branches?: Record<string, unknown>;
  };
  try {
    data = JSON.parse(snapshot.data);
  } catch {
    return out;
  }
  if (!data || typeof data !== "object") return out;
  const persons = data.persons ?? {};
  // Ảnh chụp chưa có giới tính (bộ < 8 phần tử): chạy gia-pha:snapshot-sex để đồng bộ. Chỉ in mã người.
  for (const [id, t] of Object.entries(persons))
    if (Array.isArray(t) && t.length < 8 && live(input.persons.get(id)))
      out.push({ code: "SEX_NOT_IN_SNAPSHOT", ref: id });
  // founderId → các mã chi mà người đó khai.
  const founded = new Map<string, Set<string>>();
  for (const [code, v] of Object.entries(data.branches ?? {})) {
    const fid = Array.isArray(v) ? v[1] : null;
    if (typeof fid !== "string") continue;
    if (!founded.has(fid)) founded.set(fid, new Set());
    founded.get(fid)!.add(code);
  }
  if (!founded.size) return out;
  const up = new Map<string, string[]>();
  for (const r of data.relations ?? []) {
    if (r[4] !== 1) continue;
    const d = input.relations.get(`r-${String(r[0])}-${String(r[1])}`);
    if (d && d.deleted === true) continue;
    up.set(String(r[1]), [...(up.get(String(r[1])) ?? []), String(r[0])]);
  }
  for (const [id, t] of Object.entries(persons)) {
    if (t[4] !== "C" || !live(input.persons.get(id))) continue;
    const have = typeof t[5] === "string" ? t[5] : null;
    // Người khai chi: chi của họ phải thuộc các chi họ khai (chi lồng nhau); không so với tổ tiên.
    const own = founded.get(id);
    if (own) {
      if (have === null || !own.has(have))
        out.push({ code: "BRANCH_FOUNDER_MISMATCH", ref: id });
      continue;
    }
    // BFS theo tầng (có visited + giới hạn độ sâu nên vòng lặp không treo); lấy tầng gần nhất có người khai chi.
    const seen = new Set<string>([id]);
    let level = [id];
    for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
      const next: string[] = [];
      const want = new Set<string>();
      for (const c of level)
        for (const p of up.get(c) ?? []) {
          if (seen.has(p)) continue;
          seen.add(p);
          next.push(p);
          for (const code of founded.get(p) ?? []) want.add(code);
        }
      if (want.size) {
        if (have === null || !want.has(have))
          out.push({ code: "BRANCH_FOUNDER_MISMATCH", ref: id });
        break;
      }
      level = next;
    }
  }
  return out;
}
