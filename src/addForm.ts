// Logic thuần của biểu mẫu thêm con / thêm vợ chồng: đổi giá trị nhập thành thao tác cho applyAdd.
import { NAME_MAX, NOTE_MAX } from "./editCore";
import { normalizeNameInput, parseYear } from "./editForm";
import type { AddChildOp, AddSpouseOp, NewPerson } from "./editAdd";

export interface PersonFields {
  name: string;
  sex: "" | "M" | "F";
  birthYear: string;
  deathYear: string;
  /** Đã mất mà không rõ năm. */
  deceased: boolean;
  note: string;
}
export interface ChildForm extends PersonFields {
  /** Người đang xem là cha hay mẹ — người dùng chọn rõ, không suy từ giới tính. */
  role: "" | "FATHER" | "MOTHER";
  otherParent: string;
  category: "CLAN" | "EXTERNAL";
  adoptive: boolean;
  branch: string;
}
export interface SpouseForm extends PersonFields {
  kind: "new" | "existing";
  existingId: string;
  category: "SPOUSE" | "EXTERNAL";
  order: string;
}
export type AddErrors = Record<string, string>;

export const emptyPerson: PersonFields = {
  name: "",
  sex: "",
  birthYear: "",
  deathYear: "",
  deceased: false,
  note: "",
};

function toPerson(f: PersonFields, errors: AddErrors): NewPerson | null {
  const before = Object.keys(errors).length;
  const name = normalizeNameInput(f.name);
  if (!name) errors.name = "Nhập họ tên.";
  else if (name.length > NAME_MAX)
    errors.name = `Họ tên tối đa ${NAME_MAX} ký tự.`;
  const birth = parseYear(f.birthYear, "Năm sinh");
  const death = parseYear(f.deathYear, "Năm mất");
  if (typeof birth === "string") errors.birthYear = birth;
  if (typeof death === "string") errors.deathYear = death;
  if (typeof birth === "number" && typeof death === "number" && death < birth)
    errors.deathYear = "Năm mất không được trước năm sinh.";
  if (f.note.trim().length > NOTE_MAX)
    errors.note = `Ghi chú tối đa ${NOTE_MAX} ký tự.`;
  if (Object.keys(errors).length > before) return null;
  return {
    name,
    sex: f.sex || null,
    birthYear: birth as number | null,
    deathYear: death as number | null,
    deceased: f.deceased,
    note: f.note.trim(),
  };
}

export function buildChildOp(
  personId: string,
  f: ChildForm,
  ctx: {
    newId: string;
    /** Người này có thể làm cha truyền dòng không: thuộc dòng họ VÀ đã nối tới thủy tổ. */
    canBeLineageFather: (id: string) => boolean;
  },
): { op: AddChildOp } | { errors: AddErrors } {
  const errors: AddErrors = {};
  if (!f.role) errors.role = "Chọn người này là cha hay mẹ của đứa trẻ.";
  const person = toPerson(f, errors);
  const fatherId =
    f.role === "FATHER"
      ? personId
      : f.role === "MOTHER"
        ? f.otherParent || null
        : null;
  const motherId =
    f.role === "MOTHER"
      ? personId
      : f.role === "FATHER"
        ? f.otherParent || null
        : null;
  if (
    f.category === "CLAN" &&
    f.role &&
    !(fatherId && ctx.canBeLineageFather(fatherId))
  )
    errors.category =
      "Người thuộc dòng họ phải có cha thuộc dòng họ và đã nối tới thủy tổ.";
  if (Object.keys(errors).length || !person) return { errors };
  return {
    op: {
      type: "addChild",
      newId: ctx.newId,
      fatherId,
      motherId,
      adoptive: f.adoptive,
      category: f.category,
      branch: f.category === "CLAN" ? f.branch || null : null,
      child: person,
    },
  };
}

export function buildSpouseOp(
  personId: string,
  f: SpouseForm,
  ctx: { newId: string },
): { op: AddSpouseOp } | { errors: AddErrors } {
  const errors: AddErrors = {};
  const order = f.order.trim();
  if (order.length > 20) errors.order = "Thứ tự tối đa 20 ký tự.";
  if (f.kind === "existing") {
    if (!f.existingId) errors.existingId = "Chọn một người trong cây.";
    if (Object.keys(errors).length) return { errors };
    return {
      op: {
        type: "addSpouse",
        personId,
        order: order || null,
        spouse: { kind: "existing", id: f.existingId },
      },
    };
  }
  const person = toPerson(f, errors);
  if (Object.keys(errors).length || !person) return { errors };
  return {
    op: {
      type: "addSpouse",
      personId,
      order: order || null,
      spouse: {
        kind: "new",
        newId: ctx.newId,
        category: f.category,
        person,
      },
    },
  };
}
