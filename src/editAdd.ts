// Thêm người mới vào cây (hàm thuần): thêm con và thêm vợ/chồng. Chỉ THÊM, không ghi đè quan hệ cũ.
// Mỗi thao tác là một lô nguyên tử gồm tài liệu mới + treeSnapshots/main (editVersion + 1) + nhật ký
// auditLogs/edit-{n}; firestore.rules kiểm tra lô này (createGate và nhánh PERSON_ADDED/SPOUSE_ADDED).
import {
  CONTROL,
  EditError,
  NAME_MAX,
  NOTE_MAX,
  SERVER_TIME,
  checkYear,
  currentEditVersion,
  exceedsSnapshotLimit,
  invalid,
  yearDate,
  type EditWrite,
} from "./editCore";
import { normalizeName } from "./domain";

type Doc = Record<string, unknown>;

export interface NewPerson {
  name: string;
  sex: "M" | "F" | null;
  birthYear: number | null;
  deathYear: number | null;
  /** Đã mất mà không rõ năm; bỏ trống = chưa mất. */
  deceased?: boolean;
  note: string;
}
export interface AddChildOp {
  type: "addChild";
  newId: string;
  /** Vai trò cha/mẹ do người dùng chỉ định rõ, không suy từ giới tính. */
  fatherId: string | null;
  motherId: string | null;
  adoptive: boolean;
  category: "CLAN" | "EXTERNAL";
  branch: string | null;
  child: NewPerson;
}
export interface AddSpouseOp {
  type: "addSpouse";
  personId: string;
  order: string | null;
  spouse:
    | { kind: "existing"; id: string }
    | {
        kind: "new";
        newId: string;
        category: "SPOUSE" | "EXTERNAL";
        person: NewPerson;
      };
}
export type AddOp = AddChildOp | AddSpouseOp;

export interface AddState {
  /** treeSnapshots/main */
  snapshot: Doc;
  /** persons/{id} của mọi người liên quan; mã người MỚI phải là null (chưa tồn tại). */
  docs: Record<string, Doc | null>;
}
export interface AddInput {
  op: AddOp;
  expectedVersion: number;
  actorUid: string;
}
export interface AddResult {
  writes: EditWrite[];
  nextVersion: number;
  /** Mã người để chuyển tới sau khi lưu. */
  focusId: string;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const CAT_CODE = { CLAN: "C", SPOUSE: "S", EXTERNAL: "E" } as const;

/** Mã người cần đọc (cả người sẽ tạo, để chắc chắn chưa tồn tại). */
export function addTargets(op: AddOp): string[] {
  if (op.type === "addChild")
    return [op.newId, op.fatherId, op.motherId].filter(
      (x): x is string => typeof x === "string",
    );
  return op.spouse.kind === "new"
    ? [op.personId, op.spouse.newId]
    : [op.personId, op.spouse.id];
}

export function newPersonId(
  random: (n: number) => Uint8Array = (n) =>
    globalThis.crypto.getRandomValues(new Uint8Array(n)),
): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return (
    "p-" + Array.from(random(12), (b) => alphabet[b % alphabet.length]).join("")
  );
}

function cleanPerson(p: NewPerson): NewPerson {
  if (!p || typeof p !== "object") invalid("Thiếu thông tin người mới.");
  if (typeof p.name !== "string") invalid("Tên phải là chữ.");
  const name = p.name.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name || name.length > NAME_MAX || CONTROL.test(name))
    invalid(
      `Tên không được trống, tối đa ${NAME_MAX} ký tự, không có ký tự điều khiển.`,
    );
  if (p.sex !== null && p.sex !== "M" && p.sex !== "F")
    invalid("Giới tính không hợp lệ.");
  if (p.deceased !== undefined && typeof p.deceased !== "boolean")
    invalid("Đã mất phải là đúng/sai.");
  checkYear("Năm sinh", p.birthYear);
  checkYear("Năm mất", p.deathYear);
  if (p.birthYear !== null && p.deathYear !== null && p.deathYear < p.birthYear)
    invalid("Năm mất không được trước năm sinh.");
  const note =
    typeof p.note === "string"
      ? p.note.trim()
      : invalid("Ghi chú phải là chữ.");
  if (note.length > NOTE_MAX) invalid(`Ghi chú tối đa ${NOTE_MAX} ký tự.`);
  if (/[\p{Cc}\p{Cf}]/u.test(note.replace(/[\n\t]/g, "")))
    invalid("Ghi chú có ký tự điều khiển.");
  return { ...p, name, note };
}

function personWrites(
  id: string,
  p: NewPerson,
  category: "CLAN" | "SPOUSE" | "EXTERNAL",
  branch: string | null,
  generation: number | null,
  actorUid: string,
): EditWrite[] {
  const writes: EditWrite[] = [
    {
      path: `persons/${id}`,
      mode: "create",
      data: {
        displayName: p.name,
        normalizedName: normalizeName(p.name),
        sex: p.sex,
        sexBasis: p.sex ? "MANUAL" : "UNKNOWN",
        category,
        branchCode: branch,
        generation,
        declaredGeneration: null,
        birth: yearDate(p.birthYear),
        death: yearDate(p.deathYear),
        deceased: p.deceased === true,
        kyNhat: null,
        reviewFlags: [],
        profileVersion: 1,
        schemaVersion: 1,
        createdAt: SERVER_TIME,
        createdBy: actorUid,
      },
    },
    {
      path: `memberProfiles/${id}`,
      mode: "create",
      data: {
        displayName: p.name,
        normalizedName: normalizeName(p.name),
        profileVersion: 1,
        schemaVersion: 1,
        ...(p.birthYear !== null ? { birthYear: p.birthYear } : {}),
        ...(p.deathYear !== null ? { deathYear: p.deathYear } : {}),
      },
    },
  ];
  if (p.note)
    writes.push({
      path: `personPrivate/${id}`,
      mode: "create",
      data: { note: p.note, schemaVersion: 1 },
    });
  return writes;
}

export function applyAdd(state: AddState, input: AddInput): AddResult {
  const { op } = input;
  if (op.type !== "addChild" && op.type !== "addSpouse")
    invalid("Loại thao tác chưa được hỗ trợ.");
  if (!input.actorUid) invalid("Thiếu người thực hiện.");
  const version = currentEditVersion(state.snapshot);
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion !== version
  )
    throw new EditError(
      "VERSION_CONFLICT",
      "Dữ liệu đã được người khác thay đổi. Hãy tải lại rồi sửa lại.",
    );
  if (
    state.snapshot.schemaVersion !== 1 ||
    typeof state.snapshot.data !== "string"
  )
    throw new EditError("BAD_STATE", "Ảnh chụp cây không hợp lệ.");
  let data: {
    persons: Record<string, unknown[]>;
    relations: unknown[][];
    unions: unknown[][];
    branches?: Record<string, unknown[]>;
  };
  try {
    data = JSON.parse(state.snapshot.data);
  } catch {
    throw new EditError("BAD_STATE", "Ảnh chụp cây không đọc được.");
  }
  if (!data || typeof data !== "object" || (data as { v?: unknown }).v !== 1)
    throw new EditError("BAD_STATE", "Ảnh chụp cây sai định dạng.");
  if (
    !data.persons ||
    !Array.isArray(data.relations) ||
    !Array.isArray(data.unions)
  )
    throw new EditError("BAD_STATE", "Ảnh chụp cây thiếu phần quan hệ.");

  const nextVersion = version + 1;
  const audit = `auditLogs/edit-${nextVersion}`;
  const known = (id: unknown): id is string =>
    typeof id === "string" &&
    ID.test(id) &&
    Object.hasOwn(data.persons, id) &&
    Array.isArray(data.persons[id]);
  const fresh = (id: unknown): id is string => {
    if (typeof id !== "string" || !ID.test(id))
      invalid("Mã người mới không hợp lệ.");
    if (Object.hasOwn(data.persons, id) || state.docs[id] !== null)
      invalid("Mã người mới đã tồn tại; hãy thử lại.");
    return true;
  };
  const writes: EditWrite[] = [];
  let personId: string;
  let created: string[];
  const relationIds: string[] = [];
  let unionId: string | null = null;
  let after: Doc;
  let fields: string[];
  let focusId: string;

  if (op.type === "addChild") {
    fresh(op.newId);
    const child = cleanPerson(op.child);
    if (!op.fatherId && !op.motherId)
      invalid("Cần ghi ít nhất cha hoặc mẹ của người mới.");
    if (op.fatherId && op.fatherId === op.motherId)
      invalid("Cha và mẹ không thể là cùng một người.");
    for (const pid of [op.fatherId, op.motherId])
      if (pid && !known(pid)) invalid("Cha/mẹ không có trong cây.");
    if (state.docs[op.fatherId ?? ""]?.sex === "F")
      invalid("Người được chọn làm cha đang ghi giới tính nữ.");
    if (state.docs[op.motherId ?? ""]?.sex === "M")
      invalid("Người được chọn làm mẹ đang ghi giới tính nam.");
    if (op.category !== "CLAN" && op.category !== "EXTERNAL")
      invalid("Loại người không hợp lệ.");
    if (typeof op.adoptive !== "boolean")
      invalid("Thiếu loại con (nuôi/ruột).");
    const father = op.fatherId ? data.persons[op.fatherId] : null;
    // Chỉ người có cha thuộc dòng họ VÀ đã nối tới thủy tổ (có đời) mới thuộc dòng họ: một thủy tổ duy
    // nhất; cha chưa nối mà có con theo dòng sẽ thành gốc thứ hai và làm trống cây.
    if (op.category === "CLAN") {
      if (!(father && father[4] === "C"))
        invalid("Người thuộc dòng họ phải có cha thuộc dòng họ.");
      if (typeof father[3] !== "number")
        invalid(
          "Cha chưa nối được tới thủy tổ (chưa có đời); hãy nối cha vào cây trước.",
        );
    }
    if (op.category === "EXTERNAL" && op.branch !== null)
      invalid("Người họ ngoại không thuộc chi nào.");
    if (
      op.branch !== null &&
      !(
        typeof op.branch === "string" &&
        Object.hasOwn(data.branches ?? {}, op.branch)
      )
    )
      invalid("Chi không tồn tại.");
    const lineage = op.category === "CLAN";
    const fatherGen =
      father && typeof father[3] === "number" ? father[3] : null;
    const generation = lineage && fatherGen !== null ? fatherGen + 1 : null;
    writes.push(
      ...personWrites(
        op.newId,
        child,
        op.category,
        op.branch,
        generation,
        input.actorUid,
      ),
    );
    const roles: Array<["FATHER" | "MOTHER", string]> = [];
    if (op.fatherId) roles.push(["FATHER", op.fatherId]);
    if (op.motherId) roles.push(["MOTHER", op.motherId]);
    for (const [role, parentId] of roles) {
      const lineageTransmission = role === "FATHER" && lineage;
      const rid = `r-${parentId}-${op.newId}`;
      relationIds.push(rid);
      writes.push({
        path: `relations/${rid}`,
        mode: "create",
        data: {
          parentId,
          childId: op.newId,
          parentRole: role,
          relationType: op.adoptive ? "ADOPTIVE" : "BIOLOGICAL",
          lineageTransmission,
          verificationStatus: "APPROVED",
          version: 1,
          schemaVersion: 1,
          sourceRefs: [audit],
          createdAt: SERVER_TIME,
        },
      });
      data.relations.push([
        parentId,
        op.newId,
        role === "FATHER" ? "F" : "M",
        op.adoptive ? "A" : "B",
        lineageTransmission ? 1 : 0,
      ]);
    }
    data.persons[op.newId] = [
      child.name,
      child.birthYear,
      child.deathYear,
      generation,
      CAT_CODE[op.category],
      op.branch,
      [],
      child.sex,
      child.deceased === true,
    ];
    personId = op.newId;
    focusId = op.newId;
    created = [op.newId];
    fields = ["child", "relations"];
    after = {
      name: child.name,
      category: op.category,
      fatherId: op.fatherId,
      motherId: op.motherId,
      adoptive: op.adoptive,
      noteChars: child.note.length,
    };
  } else {
    if (!known(op.personId)) invalid("Người này không có trong cây.");
    let spouseId: string;
    created = [];
    if (op.spouse.kind === "existing") {
      if (!known(op.spouse.id)) invalid("Vợ/chồng không có trong cây.");
      spouseId = op.spouse.id;
    } else {
      fresh(op.spouse.newId);
      if (op.spouse.category !== "SPOUSE" && op.spouse.category !== "EXTERNAL")
        invalid("Loại người không hợp lệ.");
      const person = cleanPerson(op.spouse.person);
      spouseId = op.spouse.newId;
      writes.push(
        ...personWrites(
          spouseId,
          person,
          op.spouse.category,
          null,
          null,
          input.actorUid,
        ),
      );
      data.persons[spouseId] = [
        person.name,
        person.birthYear,
        person.deathYear,
        null,
        CAT_CODE[op.spouse.category],
        null,
        [],
        person.sex,
        person.deceased === true,
      ];
      created = [spouseId];
    }
    if (spouseId === op.personId)
      invalid("Một người không thể là vợ/chồng của chính mình.");
    if (
      data.unions.some(
        (u) =>
          (u[0] === op.personId && u[1] === spouseId) ||
          (u[0] === spouseId && u[1] === op.personId),
      )
    )
      invalid("Hai người này đã có quan hệ vợ/chồng.");
    const order = op.order === null ? null : String(op.order).trim() || null;
    if (order !== null && (order.length > 20 || CONTROL.test(order)))
      invalid("Thứ tự tối đa 20 ký tự, không có ký tự điều khiển.");
    unionId = `u-${[op.personId, spouseId].sort().join("-")}`;
    writes.push({
      path: `unions/${unionId}`,
      mode: "create",
      data: {
        partnerIds: [op.personId, spouseId],
        order,
        status: null,
        note: null,
        sourceRefs: [audit],
        schemaVersion: 1,
        createdAt: SERVER_TIME,
      },
    });
    data.unions.push([op.personId, spouseId, order]);
    personId = op.personId;
    focusId = op.personId;
    fields = ["union"];
    after = { spouseId, newPerson: created.length > 0, order };
  }

  const json = JSON.stringify(data);
  if (exceedsSnapshotLimit(json))
    invalid("Ảnh chụp cây đã quá lớn; không thể thêm người.");
  writes.push({
    path: "treeSnapshots/main",
    mode: "merge",
    data: { data: json, editVersion: nextVersion },
  });
  writes.push({
    path: audit,
    mode: "create",
    data: {
      event: op.type === "addChild" ? "PERSON_ADDED" : "SPOUSE_ADDED",
      actorUid: input.actorUid,
      target: `persons/${personId}`,
      personId,
      createdPersonIds: created,
      relationIds,
      unionId,
      editVersion: nextVersion,
      fields,
      before: {},
      after,
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
  });
  return { writes, nextVersion, focusId };
}
