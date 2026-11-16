import { describe, expect, it } from "vitest";
import {
  MAX_PENDING,
  buildProposal,
  canTransition,
  cleanReason,
  proposalToAddOp,
  readProposal,
  statusLabel,
  type ProposalStatus,
} from "../src/memberProposal";
import { emptyPerson, type ChildForm, type SpouseForm } from "../src/addForm";
import { EditError } from "../src/editCore";

const ctx = (over: object = {}) => ({
  newId: "p-abcdefghijkl",
  authorUid: "u1",
  canBeLineageFather: () => true,
  ...over,
});
const childForm = (over: Partial<ChildForm> = {}): ChildForm => ({
  ...emptyPerson,
  name: "  Giả   Văn Con ",
  role: "FATHER",
  otherParent: "",
  category: "CLAN",
  adoptive: false,
  branch: "c1",
  ...over,
});
const spouseForm = (over: Partial<SpouseForm> = {}): SpouseForm => ({
  ...emptyPerson,
  name: "Vợ Giả",
  kind: "new",
  existingId: "",
  category: "SPOUSE",
  order: " 1 ",
  ...over,
});
const errs = (r: object) => ("errors" in r ? (r.errors as Record<string, string>) : {});

describe("buildProposal", () => {
  it("CHILD hợp lệ: chuẩn hóa tên, đủ khóa payload, mã đề xuất == mã người mới", () => {
    const r = buildProposal("CHILD", "a", childForm({ note: "ghi\r\nchú", birthYear: "1960" }), ctx({ source: " Gia phả cũ " }));
    if (!("proposal" in r)) throw new Error(JSON.stringify(r));
    const p = r.proposal;
    expect(p).toMatchObject({
      id: "p-abcdefghijkl",
      newId: "p-abcdefghijkl",
      kind: "CHILD",
      anchorId: "a",
      status: "PENDING",
      authorUid: "u1",
      source: "Gia phả cũ",
    });
    expect(p.payload).toEqual({
      name: "Giả Văn Con",
      sex: null,
      birthYear: 1960,
      deathYear: null,
      deceased: false,
      note: "ghi\nchú",
      role: "FATHER",
      otherParentId: null,
      adoptive: false,
      category: "CLAN",
      branch: "c1",
    });
  });

  it("CHILD họ ngoại không có chi; nguồn rỗng thì bỏ", () => {
    const r = buildProposal("CHILD", "a", childForm({ category: "EXTERNAL", branch: "c1" }), ctx({ source: "  " }));
    if (!("proposal" in r)) throw new Error("lỗi");
    expect(r.proposal.payload).toMatchObject({ category: "EXTERNAL", branch: null });
    expect("source" in r.proposal).toBe(false);
  });

  it("CHILD lỗi: thiếu vai trò, tên trống, năm sai, ghi chú dài, cha/mẹ còn lại trùng, không phải cha dòng họ", () => {
    expect(errs(buildProposal("CHILD", "a", childForm({ role: "" }), ctx()))).toHaveProperty("role");
    expect(errs(buildProposal("CHILD", "a", childForm({ name: " " }), ctx()))).toHaveProperty("name");
    expect(errs(buildProposal("CHILD", "a", childForm({ birthYear: "12" }), ctx()))).toHaveProperty("birthYear");
    expect(errs(buildProposal("CHILD", "a", childForm({ note: "x".repeat(2001) }), ctx()))).toHaveProperty("note");
    expect(errs(buildProposal("CHILD", "a", childForm({ otherParent: "a" }), ctx()))).toHaveProperty("otherParent");
    expect(errs(buildProposal("CHILD", "a", childForm(), ctx({ canBeLineageFather: () => false })))).toHaveProperty("category");
    expect(errs(buildProposal("CHILD", "a", childForm({ note: "a\u0007b" }), ctx()))).toHaveProperty("note");
    expect(errs(buildProposal("CHILD", "a", childForm({ name: "a​b" }), ctx()))).toHaveProperty("name");
  });

  it("SPOUSE hợp lệ; 'người đã có' và mã sai bị từ chối", () => {
    const r = buildProposal("SPOUSE", "b", spouseForm(), ctx());
    if (!("proposal" in r)) throw new Error("lỗi");
    expect(r.proposal.payload).toMatchObject({ category: "SPOUSE", order: "1", name: "Vợ Giả" });
    expect(errs(buildProposal("SPOUSE", "b", spouseForm({ kind: "existing", existingId: "x" }), ctx()))).toHaveProperty("form");
    expect(errs(buildProposal("SPOUSE", "b", spouseForm({ order: "x".repeat(21) }), ctx()))).toHaveProperty("order");
    expect(errs(buildProposal("SPOUSE", "b", spouseForm(), ctx({ newId: "bad" })))).toHaveProperty("form");
    expect(errs(buildProposal("SPOUSE", "p-abcdefghijkl", spouseForm(), ctx()))).toHaveProperty("form");
    expect(errs(buildProposal("SPOUSE", "b", spouseForm(), ctx({ authorUid: "" })))).toHaveProperty("form");
    expect(errs(buildProposal("SPOUSE", "b", spouseForm(), ctx({ resubmitOf: "xx" })))).toHaveProperty("form");
    expect(errs(buildProposal("SPOUSE", "b", spouseForm(), ctx({ source: "s".repeat(301) })))).toHaveProperty("source");
  });

  it("gửi lại: giữ resubmitOf hợp lệ", () => {
    const r = buildProposal("SPOUSE", "b", spouseForm(), ctx({ resubmitOf: "p-zzzzzzzzzzzz" }));
    if (!("proposal" in r)) throw new Error("lỗi");
    expect(r.proposal.resubmitOf).toBe("p-zzzzzzzzzzzz");
  });
});

describe("proposalToAddOp / readProposal", () => {
  const doc = (r: ReturnType<typeof buildProposal>) => {
    if (!("proposal" in r)) throw new Error("lỗi");
    const { id, ...rest } = r.proposal;
    return readProposal(id, { ...rest, createdAt: 1 })!;
  };
  it("CHILD: cha/mẹ theo vai trò đã chọn, không suy từ giới tính", () => {
    const f = doc(buildProposal("CHILD", "a", childForm({ role: "FATHER", otherParent: "b" }), ctx()));
    expect(proposalToAddOp(f)).toMatchObject({ type: "addChild", newId: "p-abcdefghijkl", fatherId: "a", motherId: "b", category: "CLAN", branch: "c1" });
    const m = doc(buildProposal("CHILD", "b", childForm({ role: "MOTHER", otherParent: "a" }), ctx()));
    expect(proposalToAddOp(m)).toMatchObject({ fatherId: "a", motherId: "b" });
  });
  it("SPOUSE -> addSpouse người mới; edits sửa nội dung nhưng không đổi neo", () => {
    const d = doc(buildProposal("SPOUSE", "b", spouseForm(), ctx()));
    const op = proposalToAddOp(d, { name: "Tên đã sửa", order: null });
    expect(op).toMatchObject({ type: "addSpouse", personId: "b", order: null });
    if (op.type !== "addSpouse" || op.spouse.kind !== "new") throw new Error("sai");
    expect(op.spouse.person.name).toBe("Tên đã sửa");
    expect(op.spouse.newId).toBe("p-abcdefghijkl");
    expect(proposalToAddOp(d, { anchorId: "zzz" } as never)).toMatchObject({ personId: "b" });
  });
  it("readProposal từ chối dữ liệu sai hình dạng", () => {
    const ok = {
      schemaVersion: 1, kind: "SPOUSE", anchorId: "b", newId: "p-abcdefghijkl", status: "PENDING", authorUid: "u1",
      payload: { name: "A", sex: null, birthYear: null, deathYear: null, deceased: false, note: "", category: "SPOUSE", order: null },
    };
    expect(readProposal("p-abcdefghijkl", ok)).not.toBeNull();
    expect(readProposal("p-other0000000", ok)).toBeNull();
    expect(readProposal("p-abcdefghijkl", { ...ok, status: "X" })).toBeNull();
    expect(readProposal("p-abcdefghijkl", { ...ok, kind: "OTHER" })).toBeNull();
    expect(readProposal("p-abcdefghijkl", { ...ok, payload: { ...ok.payload, category: "CLAN" } })).toBeNull();
    expect(readProposal("p-abcdefghijkl", null)).toBeNull();
  });
});

describe("canTransition / statusLabel / cleanReason", () => {
  const all: ProposalStatus[] = ["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO", "WITHDRAWN"];
  it("bảng chuyển trạng thái", () => {
    const admin = all.flatMap((a) => all.filter((b) => canTransition(a, b, "admin")).map((b) => `${a}>${b}`));
    expect(admin.sort()).toEqual(["NEEDS_INFO>APPROVED", "NEEDS_INFO>REJECTED", "PENDING>APPROVED", "PENDING>NEEDS_INFO", "PENDING>REJECTED"]);
    const author = all.flatMap((a) => all.filter((b) => canTransition(a, b, "author")).map((b) => `${a}>${b}`));
    expect(author.sort()).toEqual(["NEEDS_INFO>WITHDRAWN", "PENDING>WITHDRAWN"]);
  });
  it("nhãn tiếng Việt", () => {
    expect(all.map(statusLabel)).toEqual(["CHỜ DUYỆT", "ĐÃ DUYỆT", "TỪ CHỐI", "CẦN BỔ SUNG", "ĐÃ RÚT"]);
    expect(statusLabel("???")).toBe("KHÔNG RÕ");
    expect(MAX_PENDING).toBe(5);
  });
  it("lý do: bắt buộc 1–500, chặn ký tự điều khiển", () => {
    expect(cleanReason(" cần thêm nguồn ", true)).toBe("cần thêm nguồn");
    expect(cleanReason("", false)).toBeNull();
    expect(() => cleanReason("  ", true)).toThrow(EditError);
    expect(() => cleanReason("x".repeat(501), true)).toThrow(EditError);
    expect(() => cleanReason("a\u0007", true)).toThrow(EditError);
    expect(cleanReason("dòng 1\ndòng 2", true)).toBe("dòng 1\ndòng 2");
  });
});
