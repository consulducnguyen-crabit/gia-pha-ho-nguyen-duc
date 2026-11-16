// Đề xuất thêm thành viên của thành viên thường (hàm thuần, không phụ thuộc React/Firebase).
// Thành viên gửi đề xuất (memberProposals/{id}, id == mã người mới); quản trị viên kiểm tra rồi duyệt. Duyệt
// = chạy đúng thao tác thêm người như admin (applyAdd) trong CÙNG lô với việc đánh dấu APPROVED.
// Rules (firestore.rules, khối memberProposals) là ranh giới bảo mật; file này chỉ dựng/kiểm tra phía client.
import { CONTROL, NOTE_MAX, invalid } from "./editCore";
import { buildChildOp, buildSpouseOp } from "./addForm";
import type { ChildForm, SpouseForm } from "./addForm";
import type { AddOp, NewPerson } from "./editAdd";

export type ProposalKind = "CHILD" | "SPOUSE";
export type ProposalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_INFO"
  | "WITHDRAWN";
export type ProposalRole = "author" | "admin";

/** Số đề xuất đang chờ tối đa của một tài khoản (UI chặn; rules chỉ chặn theo tần suất 60 giây). */
export const MAX_PENDING = 5;
/** Khoảng cách tối thiểu giữa hai đề xuất của một tài khoản (giây); phải khớp rules (proposalThrottle). */
export const THROTTLE_SECONDS = 60;
export const SOURCE_MAX = 300;
export const REASON_MAX = 500;
export const BRANCH_MAX = 40;
export const ORDER_MAX = 20;

export const PROPOSAL_ID = /^p-[a-z0-9]{12}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

interface PersonPayload {
  name: string;
  sex: "M" | "F" | null;
  birthYear: number | null;
  deathYear: number | null;
  deceased: boolean;
  note: string;
}
export interface ChildPayload extends PersonPayload {
  role: "FATHER" | "MOTHER";
  otherParentId: string | null;
  adoptive: boolean;
  category: "CLAN" | "EXTERNAL";
  branch: string | null;
}
export interface SpousePayload extends PersonPayload {
  category: "SPOUSE" | "EXTERNAL";
  order: string | null;
}

/** Phần nội dung do client gửi lên (thời gian do máy chủ đặt). */
export interface ProposalInput {
  /** == newId */
  id: string;
  schemaVersion: 1;
  kind: ProposalKind;
  anchorId: string;
  newId: string;
  payload: ChildPayload | SpousePayload;
  source?: string;
  resubmitOf?: string;
  status: "PENDING";
  authorUid: string;
}
/** Tài liệu đã đọc về (đã qua readProposal). */
export interface ProposalDoc extends Omit<ProposalInput, "status"> {
  status: ProposalStatus;
  /** Lần yêu cầu bổ sung (ghi riêng, không bị quyết định cuối ghi đè). */
  infoRequestedBy?: string;
  infoRequestReason?: string;
  decisionReason?: string;
  appliedEditVersion?: number;
}

export type ProposalErrors = Record<string, string>;

export interface ProposalContext {
  newId: string;
  authorUid: string;
  /** Giống addForm: người này có thể làm cha truyền dòng không (chỉ dùng cho CHILD). */
  canBeLineageFather: (id: string) => boolean;
  /** "Nguồn/căn cứ" tùy chọn; chỉ nằm trong đề xuất, không vào hồ sơ chính thức. */
  source?: string;
  resubmitOf?: string;
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  PENDING: "CHỜ DUYỆT",
  APPROVED: "ĐÃ DUYỆT",
  REJECTED: "TỪ CHỐI",
  NEEDS_INFO: "CẦN BỔ SUNG",
  WITHDRAWN: "ĐÃ RÚT",
};
export function statusLabel(status: unknown): string {
  return typeof status === "string" && Object.hasOwn(STATUS_LABEL, status)
    ? STATUS_LABEL[status as ProposalStatus]
    : "KHÔNG RÕ";
}

/** Chuyển trạng thái hợp lệ (khớp rules). Trạng thái cuối không chuyển được nữa. */
const TRANSITIONS: Record<ProposalRole, Record<string, ProposalStatus[]>> = {
  author: { PENDING: ["WITHDRAWN"], NEEDS_INFO: ["WITHDRAWN"] },
  admin: {
    PENDING: ["APPROVED", "REJECTED", "NEEDS_INFO"],
    NEEDS_INFO: ["APPROVED", "REJECTED"],
  },
};
export function canTransition(
  from: ProposalStatus,
  to: ProposalStatus,
  role: ProposalRole,
): boolean {
  const list = TRANSITIONS[role]?.[from];
  return Array.isArray(list) && list.includes(to);
}

/** Ghi chú/nguồn: chuẩn hóa xuống dòng, cấm ký tự điều khiển trừ \n và \t (khớp proposalStrOk của rules). */
function cleanText(
  raw: string,
  max: number,
  label: string,
  errors: ProposalErrors,
  key: string,
): string {
  const t = raw.replace(/\r\n?/g, "\n").trim();
  if (t.length > max) errors[key] = `${label} tối đa ${max} ký tự.`;
  else if (/[\p{Cc}\p{Cf}]/u.test(t.replace(/[\n\t]/g, "")))
    errors[key] = `${label} có ký tự điều khiển.`;
  return t;
}

/**
 * Dựng đề xuất từ biểu mẫu, kiểm tra như admin thêm trực tiếp (tái dùng buildChildOp/buildSpouseOp).
 * Chỉ nhận NGƯỜI MỚI (vợ/chồng "đã có trong cây" không được hỗ trợ).
 */
export function buildProposal(
  kind: ProposalKind,
  anchorId: string,
  form: ChildForm | SpouseForm,
  ctx: ProposalContext,
): { proposal: ProposalInput } | { errors: ProposalErrors } {
  if (!SAFE_ID.test(anchorId)) return { errors: { form: "Mã người không hợp lệ." } };
  if (!PROPOSAL_ID.test(ctx.newId) || ctx.newId === anchorId)
    return { errors: { form: "Mã người mới không hợp lệ." } };
  if (!ctx.authorUid) return { errors: { form: "Thiếu người gửi." } };
  const errors: ProposalErrors = {};
  let payload: ChildPayload | SpousePayload | null = null;
  const person = (p: NewPerson) => {
    const note = cleanText(p.note, NOTE_MAX, "Ghi chú", errors, "note");
    if (CONTROL.test(p.name)) errors.name = "Họ tên có ký tự điều khiển.";
    return {
      name: p.name,
      sex: p.sex,
      birthYear: p.birthYear,
      deathYear: p.deathYear,
      deceased: p.deceased === true,
      note,
    };
  };
  if (kind === "CHILD") {
    const f = form as ChildForm;
    const r = buildChildOp(anchorId, f, ctx);
    if ("errors" in r) Object.assign(errors, r.errors);
    else {
      const other = f.otherParent || null;
      if (other !== null && (!SAFE_ID.test(other) || other === anchorId))
        errors.otherParent = "Cha/mẹ còn lại không hợp lệ.";
      if (r.op.branch !== null && !/^[A-Za-z0-9_-]{1,40}$/.test(r.op.branch))
        errors.branch = "Chi không hợp lệ.";
      payload = {
        ...person(r.op.child),
        role: f.role as "FATHER" | "MOTHER",
        otherParentId: other,
        adoptive: r.op.adoptive,
        category: r.op.category,
        branch: r.op.branch,
      };
    }
  } else if (kind === "SPOUSE") {
    const f = form as SpouseForm;
    if (f.kind !== "new")
      return { errors: { form: "Chỉ đề xuất thêm người mới." } };
    const r = buildSpouseOp(anchorId, f, ctx);
    if ("errors" in r) Object.assign(errors, r.errors);
    else if (r.op.spouse.kind === "new") {
      const order = r.op.order;
      if (order !== null && (order.length > ORDER_MAX || CONTROL.test(order)))
        errors.order = `Thứ tự tối đa ${ORDER_MAX} ký tự, không có ký tự điều khiển.`;
      payload = {
        ...person(r.op.spouse.person),
        category: r.op.spouse.category,
        order,
      };
    }
  } else return { errors: { form: "Loại đề xuất không hợp lệ." } };

  let source: string | undefined;
  if (ctx.source !== undefined) {
    const s = cleanText(ctx.source, SOURCE_MAX, "Nguồn/căn cứ", errors, "source");
    if (s) source = s;
  }
  if (ctx.resubmitOf !== undefined && !PROPOSAL_ID.test(ctx.resubmitOf))
    errors.form = "Mã đề xuất cũ không hợp lệ.";
  if (Object.keys(errors).length || !payload) return { errors };
  return {
    proposal: {
      id: ctx.newId,
      schemaVersion: 1,
      kind,
      anchorId,
      newId: ctx.newId,
      payload,
      ...(source ? { source } : {}),
      ...(ctx.resubmitOf ? { resubmitOf: ctx.resubmitOf } : {}),
      status: "PENDING",
      authorUid: ctx.authorUid,
    },
  };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const STATUSES = Object.keys(STATUS_LABEL);

/** Đọc tài liệu Firestore (dữ liệu KHÔNG TIN CẬY) thành ProposalDoc; sai hình dạng thì null. */
export function readProposal(id: string, data: unknown): ProposalDoc | null {
  if (!isRec(data) || !PROPOSAL_ID.test(id) || data.newId !== id) return null;
  const { kind, anchorId, payload, status, authorUid } = data;
  if (
    data.schemaVersion !== 1 ||
    (kind !== "CHILD" && kind !== "SPOUSE") ||
    typeof anchorId !== "string" ||
    !SAFE_ID.test(anchorId) ||
    anchorId === id ||
    typeof status !== "string" ||
    !STATUSES.includes(status) ||
    typeof authorUid !== "string" ||
    !authorUid ||
    !isRec(payload)
  )
    return null;
  const p = payload;
  const yearOk = (y: unknown) =>
    y === null || (Number.isInteger(y) && (y as number) >= 1000 && (y as number) <= 2200);
  if (
    typeof p.name !== "string" ||
    (p.sex !== null && p.sex !== "M" && p.sex !== "F") ||
    !yearOk(p.birthYear) ||
    !yearOk(p.deathYear) ||
    typeof p.deceased !== "boolean" ||
    typeof p.note !== "string"
  )
    return null;
  if (kind === "CHILD") {
    if (
      (p.role !== "FATHER" && p.role !== "MOTHER") ||
      (p.otherParentId !== null &&
        !(typeof p.otherParentId === "string" && SAFE_ID.test(p.otherParentId))) ||
      typeof p.adoptive !== "boolean" ||
      (p.category !== "CLAN" && p.category !== "EXTERNAL") ||
      (p.branch !== null && typeof p.branch !== "string")
    )
      return null;
  } else if (
    (p.category !== "SPOUSE" && p.category !== "EXTERNAL") ||
    (p.order !== null && typeof p.order !== "string")
  )
    return null;
  return {
    id,
    schemaVersion: 1,
    kind,
    anchorId,
    newId: id,
    payload: payload as unknown as ChildPayload | SpousePayload,
    ...(typeof data.source === "string" ? { source: data.source } : {}),
    ...(typeof data.resubmitOf === "string" ? { resubmitOf: data.resubmitOf } : {}),
    status: status as ProposalStatus,
    authorUid,
    ...(typeof data.infoRequestedBy === "string"
      ? { infoRequestedBy: data.infoRequestedBy }
      : {}),
    ...(typeof data.infoRequestReason === "string"
      ? { infoRequestReason: data.infoRequestReason }
      : {}),
    ...(typeof data.decisionReason === "string"
      ? { decisionReason: data.decisionReason }
      : {}),
    ...(typeof data.appliedEditVersion === "number"
      ? { appliedEditVersion: data.appliedEditVersion }
      : {}),
  };
}

/**
 * Đề xuất -> thao tác cho applyAdd. `edits` là chỗ quản trị viên sửa nội dung khi duyệt; KHÔNG đổi được
 * anchorId/kind/newId (không nằm trong edits). Dữ liệu vẫn được applyAdd kiểm tra đầy đủ.
 */
export function proposalToAddOp(
  doc: ProposalDoc,
  edits: Partial<ChildPayload & SpousePayload> = {},
): AddOp {
  const p = { ...doc.payload, ...edits } as ChildPayload & SpousePayload;
  const person: NewPerson = {
    name: p.name,
    sex: p.sex,
    birthYear: p.birthYear,
    deathYear: p.deathYear,
    deceased: p.deceased,
    note: p.note,
  };
  if (doc.kind === "CHILD") {
    const father = p.role === "FATHER" ? doc.anchorId : p.otherParentId;
    const mother = p.role === "MOTHER" ? doc.anchorId : p.otherParentId;
    return {
      type: "addChild",
      newId: doc.newId,
      fatherId: father ?? null,
      motherId: mother ?? null,
      adoptive: p.adoptive,
      category: p.category as "CLAN" | "EXTERNAL",
      branch: (p.category as string) === "CLAN" ? (p.branch ?? null) : null,
      child: person,
    };
  }
  return {
    type: "addSpouse",
    personId: doc.anchorId,
    order: p.order ?? null,
    spouse: {
      kind: "new",
      newId: doc.newId,
      category: p.category as "SPOUSE" | "EXTERNAL",
      person,
    },
  };
}

/** Lý do từ chối/yêu cầu bổ sung: bắt buộc 1–500 ký tự, không ký tự điều khiển trừ xuống dòng. */
export function cleanReason(raw: unknown, required: boolean): string | null {
  if (raw === undefined || raw === null || raw === "") {
    if (required) invalid("Nhập lý do (1–500 ký tự).");
    return null;
  }
  if (typeof raw !== "string") invalid("Lý do phải là chữ.");
  const t = raw.replace(/\r\n?/g, "\n").trim();
  if (!t) {
    if (required) invalid("Nhập lý do (1–500 ký tự).");
    return null;
  }
  if (t.length > REASON_MAX) invalid(`Lý do tối đa ${REASON_MAX} ký tự.`);
  if (/[\p{Cc}\p{Cf}]/u.test(t.replace(/[\n\t]/g, "")))
    invalid("Lý do có ký tự điều khiển.");
  return t;
}
