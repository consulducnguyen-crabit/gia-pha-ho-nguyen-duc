// Phân tích và kiểm tra file trung gian gia phả (định dạng văn bản gọn).
// File dữ liệu thật nằm ở private-data/ (ngoài git). Module này KHÔNG chứa dữ liệu.
//
// Định dạng: mỗi dòng một bản ghi, các trường ngăn bởi "|", dòng bắt đầu bằng "#" là chú thích.
//   P|id|Họ tên|sx|loại|đời|chi|thuộc tính|ghi chú   (từ "đời" trở đi có thể bỏ trống/bỏ hẳn)
//       thuộc tính: b=sinh;d=mất;ky=kỵ nhật (âm lịch), ngăn bởi ";", đều tùy chọn
//   K|idCha|idMẹ|idCon1[:A],idCon2,...      (idCha hoặc idMẹ là "-" nếu không rõ; :A = con nuôi)
//   U|id1|id2|thứ tự|tình trạng|ghi chú     (vợ chồng không có con ghi trong K)
//   B|mã chi|tên chi|idNgườiKhaiChi|hợp nhất từ|ghi chú
// sx: M/F = văn bản nêu rõ; m/f = suy từ tên (độ tin cậy thấp); ? = chưa rõ.
// loại: CLAN (huyết thống dòng họ), SPOUSE (kết hôn vào), EXTERNAL (con của con gái, không thuộc dòng).

export type Sex = "M" | "F" | "?";
export type Category = "CLAN" | "SPOUSE" | "EXTERNAL";
export interface Person {
  id: string;
  name: string;
  sex: Sex;
  sexBasis: "TEXT" | "NAME" | "UNKNOWN";
  declaredGeneration: number | null;
  branch: string;
  birth: string;
  death: string;
  kyNhat: string;
  category: Category;
  note: string;
  line: number;
}
export interface Relation {
  id: string;
  parentId: string;
  childId: string;
  parentRole: "FATHER" | "MOTHER";
  relationType: "BIOLOGICAL" | "ADOPTIVE";
  lineageTransmission: boolean;
}
export interface Union {
  id: string;
  partnerA: string;
  partnerB: string;
  order: string;
  status: string;
  note: string;
}
export interface BranchRecord {
  code: string;
  name: string;
  founderId: string;
  mergedFrom: string;
  note: string;
}
export interface Issue {
  severity: "ERROR" | "WARN";
  code: string;
  message: string;
  ref: string;
}
export interface Model {
  persons: Person[];
  relations: Relation[];
  unions: Union[];
  branches: BranchRecord[];
  derivedGeneration: Map<string, number>;
  issues: Issue[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROMAN: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGeneration(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  return ROMAN[value.toUpperCase()] ?? null;
}

export function parseDsl(text: string): Model {
  const issues: Issue[] = [];
  const add = (
    severity: Issue["severity"],
    code: string,
    message: string,
    ref: string,
  ) => issues.push({ severity, code, message, ref });
  const persons: Person[] = [];
  const unions: Union[] = [];
  const branches: BranchRecord[] = [];
  const kids: Array<{
    father: string;
    mother: string;
    children: Array<{ id: string; adoptive: boolean }>;
    line: number;
  }> = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const f = trimmed.split("|").map((part) => part.trim());
    const kind = f[0];
    if (kind === "P") {
      if (f.length < 5 || f.length > 9)
        return add(
          "ERROR",
          "BAD_FIELDS",
          `Dòng P cần từ 5 đến 9 trường (id|tên|sx|loại|đời|chi|thuộc tính|ghi chú), có ${f.length}.`,
          `dòng ${line}`,
        );
      while (f.length < 9) f.push("");
      const [, id, name, sx, cat, gen, chi, attrText, note] = f;
      const attrs = new Map<string, string>();
      for (const part of attrText.split(";")) {
        const [key, ...rest] = part.split("=");
        if (key.trim()) attrs.set(key.trim(), rest.join("=").trim());
      }
      for (const key of attrs.keys())
        if (!["b", "d", "ky"].includes(key))
          add(
            "ERROR",
            "BAD_ATTR",
            `Thuộc tính "${key}" không hợp lệ (b, d, ky).`,
            id,
          );
      const sexValue = sx.toUpperCase();
      const sex: Sex =
        sexValue === "M" || sexValue === "F" ? (sexValue as Sex) : "?";
      if (!["M", "F", "?"].includes(sexValue))
        add("ERROR", "BAD_SEX", `Giới tính "${sx}" không hợp lệ.`, id);
      const category = cat as Category;
      if (!["CLAN", "SPOUSE", "EXTERNAL"].includes(cat))
        add("ERROR", "BAD_CATEGORY", `Loại "${cat}" không hợp lệ.`, id);
      const declaredGeneration = parseGeneration(gen);
      if (gen && declaredGeneration === null)
        add("ERROR", "BAD_GENERATION", `Đời "${gen}" không hợp lệ.`, id);
      persons.push({
        id,
        name,
        sex,
        sexBasis: sex === "?" ? "UNKNOWN" : sx === sexValue ? "TEXT" : "NAME",
        declaredGeneration,
        branch: chi,
        birth: attrs.get("b") ?? "",
        death: attrs.get("d") ?? "",
        kyNhat: attrs.get("ky") ?? "",
        category,
        note,
        line,
      });
    } else if (kind === "K") {
      if (f.length !== 4)
        return add(
          "ERROR",
          "BAD_FIELDS",
          `Dòng K cần 4 trường, có ${f.length}.`,
          `dòng ${line}`,
        );
      const children = f[3]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [id, flag] = part.split(":");
          return {
            id: id.trim(),
            adoptive: flag?.trim().toUpperCase() === "A",
          };
        });
      kids.push({ father: f[1], mother: f[2], children, line });
    } else if (kind === "U") {
      if (f.length < 3 || f.length > 6)
        return add(
          "ERROR",
          "BAD_FIELDS",
          `Dòng U cần từ 3 đến 6 trường (id1|id2|thứ tự|tình trạng|ghi chú), có ${f.length}.`,
          `dòng ${line}`,
        );
      while (f.length < 6) f.push("");
      unions.push({
        id: "",
        partnerA: f[1],
        partnerB: f[2],
        order: f[3],
        status: f[4],
        note: f[5],
      });
    } else if (kind === "B") {
      if (f.length < 3 || f.length > 6)
        return add(
          "ERROR",
          "BAD_FIELDS",
          `Dòng B cần từ 3 đến 6 trường (mã|tên|người khai chi|hợp nhất từ|ghi chú), có ${f.length}.`,
          `dòng ${line}`,
        );
      while (f.length < 6) f.push("");
      branches.push({
        code: f[1],
        name: f[2],
        founderId: f[3],
        mergedFrom: f[4],
        note: f[5],
      });
    } else {
      add(
        "ERROR",
        "BAD_RECORD",
        `Loại bản ghi "${kind}" không hợp lệ.`,
        `dòng ${line}`,
      );
    }
  });

  const byId = new Map<string, Person>();
  for (const person of persons) {
    if (!ID.test(person.id))
      add("ERROR", "BAD_ID", "Mã người chỉ gồm chữ, số, _ và -.", person.id);
    if (byId.has(person.id))
      add("ERROR", "DUP_ID", "Mã người bị trùng.", person.id);
    byId.set(person.id, person);
    if (!person.name)
      add(
        "ERROR",
        "NO_NAME",
        "Thiếu họ tên (dùng ghi chú 'chưa rõ tên').",
        person.id,
      );
  }
  const need = (id: string, where: string) => {
    if (id === "-") return false;
    if (!byId.has(id)) {
      add("ERROR", "UNKNOWN_REF", `Mã "${id}" chưa được khai báo.`, where);
      return false;
    }
    return true;
  };

  const relations: Relation[] = [];
  const pairSeen = new Set<string>();
  const referenced = new Set<string>();
  const slotSeen = new Set<string>();
  const unionKeys = new Set<string>();
  const finalUnions: Union[] = [];
  const addUnion = (u: Omit<Union, "id">) => {
    const key = [u.partnerA, u.partnerB].sort().join("+");
    if (unionKeys.has(key)) return;
    unionKeys.add(key);
    finalUnions.push({ ...u, id: `u${finalUnions.length + 1}` });
  };
  for (const u of unions) {
    const okA = need(u.partnerA, `U ${u.partnerA}+${u.partnerB}`);
    const okB = need(u.partnerB, `U ${u.partnerA}+${u.partnerB}`);
    if (okA) referenced.add(u.partnerA);
    if (okB) referenced.add(u.partnerB);
    if (okA && okB) addUnion(u);
  }
  for (const group of kids) {
    const where = `dòng ${group.line}`;
    const fatherOk = need(group.father, where);
    const motherOk = need(group.mother, where);
    if (fatherOk) referenced.add(group.father);
    if (motherOk) referenced.add(group.mother);
    if (fatherOk && motherOk)
      addUnion({
        partnerA: group.father,
        partnerB: group.mother,
        order: "",
        status: "",
        note: "",
      });
    for (const child of group.children) {
      if (!need(child.id, where)) continue;
      referenced.add(child.id);
      const childPerson = byId.get(child.id)!;
      for (const [parentId, role] of [
        [group.father, "FATHER"],
        [group.mother, "MOTHER"],
      ] as const) {
        if (parentId === "-" || !byId.has(parentId)) continue;
        if (parentId === child.id) {
          add(
            "ERROR",
            "SELF_PARENT",
            "Một người không thể là cha/mẹ của chính mình.",
            child.id,
          );
          continue;
        }
        const relationType = child.adoptive ? "ADOPTIVE" : "BIOLOGICAL";
        const pair = `${parentId}>${child.id}`;
        if (pairSeen.has(pair)) {
          add(
            "ERROR",
            "DUP_PAIR",
            "Quan hệ cha/mẹ–con bị khai báo hai lần.",
            pair,
          );
          continue;
        }
        pairSeen.add(pair);
        const slot = `${child.id}|${relationType}|${role}`;
        if (slotSeen.has(slot))
          add(
            "ERROR",
            "SLOT_CONFLICT",
            `Một người có hai ${role === "FATHER" ? "cha" : "mẹ"} cùng loại ${relationType}.`,
            child.id,
          );
        slotSeen.add(slot);
        const parent = byId.get(parentId)!;
        // Chính sách: chỉ cha thuộc dòng truyền dòng cho con thuộc dòng (kể cả con gái, con nuôi).
        const lineageTransmission =
          role === "FATHER" &&
          parent.category === "CLAN" &&
          childPerson.category === "CLAN";
        relations.push({
          id: `r${relations.length + 1}`,
          parentId,
          childId: child.id,
          parentRole: role,
          relationType,
          lineageTransmission,
        });
      }
    }
  }
  for (const branch of branches) {
    if (branch.founderId && !byId.has(branch.founderId))
      add(
        "ERROR",
        "UNKNOWN_REF",
        `Người khai chi "${branch.founderId}" chưa khai báo.`,
        branch.code,
      );
  }

  // Đồ thị truyền dòng: chu trình, nhiều đường vào, một thủy tổ, tính đời.
  const lineage = relations.filter((r) => r.lineageTransmission);
  const incoming = new Map<string, number>();
  const down = new Map<string, string[]>();
  for (const r of lineage) {
    incoming.set(r.childId, (incoming.get(r.childId) ?? 0) + 1);
    down.set(r.parentId, [...(down.get(r.parentId) ?? []), r.childId]);
  }
  for (const [childId, count] of incoming)
    if (count > 1)
      add(
        "ERROR",
        "MULTI_LINEAGE",
        "Có nhiều đường truyền dòng vào cùng một người.",
        childId,
      );
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      add("ERROR", "CYCLE", "Phát hiện vòng lặp tổ tiên.", id);
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    for (const child of down.get(id) ?? []) visit(child);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of down.keys()) visit(id);
  const roots = [...down.keys()].filter((id) => !incoming.has(id));
  if (roots.length > 1)
    add(
      "ERROR",
      "MULTI_ROOT",
      `Có ${roots.length} gốc truyền dòng chưa nối (${roots.join(", ")}); chính sách yêu cầu một thủy tổ.`,
      roots.join(","),
    );
  const derivedGeneration = new Map<string, number>();
  if (roots.length === 1 && !issues.some((i) => i.code === "CYCLE")) {
    const root = byId.get(roots[0])!;
    const start = root.declaredGeneration ?? 1;
    const queue: string[] = [roots[0]];
    derivedGeneration.set(roots[0], start);
    while (queue.length) {
      const id = queue.shift()!;
      for (const child of down.get(id) ?? []) {
        if (!derivedGeneration.has(child)) {
          derivedGeneration.set(child, derivedGeneration.get(id)! + 1);
          queue.push(child);
        }
      }
    }
    for (const person of persons) {
      const derived = derivedGeneration.get(person.id);
      if (
        derived !== undefined &&
        person.declaredGeneration !== null &&
        person.declaredGeneration !== derived
      )
        add(
          "WARN",
          "GEN_MISMATCH",
          `Đời ghi trong văn bản (${person.declaredGeneration}) khác đời tính theo quan hệ (${derived}).`,
          person.id,
        );
      if (person.category === "CLAN" && derived === undefined)
        add(
          "WARN",
          "CLAN_NOT_CONNECTED",
          "Người thuộc dòng họ chưa nối được tới thủy tổ.",
          person.id,
        );
    }
  }

  // Cảnh báo chất lượng dữ liệu.
  const nameKey = new Map<string, string[]>();
  for (const person of persons) {
    // Chỉ so sánh người có đời đã biết; trùng đúng dấu mới coi là nghi trùng
    // (Tuấn/Tuân là hai tên khác nhau dù khi tìm kiếm không dấu giống nhau).
    if (person.declaredGeneration !== null) {
      const key = `${person.name.normalize("NFC").toLocaleLowerCase("vi").replace(/\s+/g, " ").trim()}|${person.declaredGeneration}`;
      nameKey.set(key, [...(nameKey.get(key) ?? []), person.id]);
    }
    if (!referenced.has(person.id))
      add(
        "WARN",
        "ORPHAN",
        "Người chưa xuất hiện trong quan hệ cha/mẹ–con hay vợ chồng nào.",
        person.id,
      );
    if (person.sexBasis === "NAME")
      add(
        "WARN",
        "SEX_FROM_NAME",
        "Giới tính suy từ tên, cần đối chiếu văn bản.",
        person.id,
      );
  }
  for (const ids of nameKey.values())
    if (ids.length > 1)
      add(
        "WARN",
        "DUP_NAME",
        "Cùng họ tên và cùng đời; xác nhận là hai người khác nhau (không tự gộp).",
        ids.join(", "),
      );

  return {
    persons,
    relations,
    unions: finalUnions,
    branches,
    derivedGeneration,
    issues,
  };
}
