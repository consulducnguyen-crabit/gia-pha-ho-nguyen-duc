import { describe, expect, it } from "vitest";
import {
  canResubmit,
  canWithdraw,
  countPending,
  payloadToChildForm,
  payloadToSpouseForm,
  pendingFull,
  lostOtherParent,
  proposalErrorMessage,
  withdrawErrorMessage,
  resubmitSource,
  sortNewestFirst,
  throttleLeft,
} from "../src/proposalView";
import type { ProposalDoc } from "../src/memberProposal";

const doc = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({
  id: "p-abcdefghijkl",
  schemaVersion: 1,
  kind: "CHILD",
  anchorId: "a",
  newId: "p-abcdefghijkl",
  payload: {
    name: "Giả Con",
    sex: "M",
    birthYear: 1990,
    deathYear: null,
    deceased: false,
    note: "n",
    role: "FATHER",
    otherParentId: "m1",
    adoptive: false,
    category: "CLAN",
    branch: "I",
  },
  status: "NEEDS_INFO",
  authorUid: "u1",
  ...over,
});

describe("proposalView", () => {
  it("chỉ đếm PENDING và chặn khi đủ 5", () => {
    const items = [
      { status: "PENDING" as const },
      { status: "PENDING" as const },
      { status: "NEEDS_INFO" as const },
      { status: "WITHDRAWN" as const },
    ];
    expect(countPending(items)).toBe(2);
    expect(pendingFull(4)).toBe(false);
    expect(pendingFull(5)).toBe(true);
  });
  it("đếm ngược 60 giây, không âm, có trần", () => {
    expect(throttleLeft(null, 1000)).toBe(0);
    expect(throttleLeft(0, 0)).toBe(60);
    expect(throttleLeft(0, 59_001)).toBe(1);
    expect(throttleLeft(0, 60_000)).toBe(0);
    expect(throttleLeft(0, 120_000)).toBe(0);
    // đồng hồ máy chậm hơn nhiều: không vượt 60 giây
    expect(throttleLeft(10_000_000, 0)).toBe(60);
  });
  it("quyền rút / gửi lại theo trạng thái", () => {
    expect(canWithdraw("PENDING")).toBe(true);
    expect(canWithdraw("NEEDS_INFO")).toBe(true);
    expect(canWithdraw("APPROVED")).toBe(false);
    expect(canWithdraw("REJECTED")).toBe(false);
    expect(canWithdraw("WITHDRAWN")).toBe(false);
    expect(canResubmit("NEEDS_INFO")).toBe(true);
    expect(canResubmit("REJECTED")).toBe(true);
    expect(canResubmit("PENDING")).toBe(false);
    expect(canResubmit("APPROVED")).toBe(false);
  });
  it("sắp mới nhất trước, không rõ thời điểm xuống cuối", () => {
    const r = sortNewestFirst([
      { id: "x", createdAtMs: null },
      { id: "a", createdAtMs: 1 },
      { id: "b", createdAtMs: 5 },
    ]);
    expect(r.map((i) => i.id)).toEqual(["b", "a", "x"]);
  });
  it("điền sẵn biểu mẫu con; cha/mẹ còn lại không còn là vợ/chồng thì bỏ", () => {
    const p = doc().payload as never;
    const f = payloadToChildForm(p, ["m1"]);
    expect(f).toMatchObject({
      name: "Giả Con",
      sex: "M",
      birthYear: "1990",
      deathYear: "",
      role: "FATHER",
      otherParent: "m1",
      branch: "I",
    });
    expect(payloadToChildForm(p, []).otherParent).toBe("");
  });
  it("điền sẵn biểu mẫu vợ/chồng luôn là người mới", () => {
    const f = payloadToSpouseForm({
      name: "Giả Dâu",
      sex: null,
      birthYear: null,
      deathYear: 1980,
      deceased: true,
      note: "",
      category: "SPOUSE",
      order: null,
    });
    expect(f).toMatchObject({
      kind: "new",
      sex: "",
      birthYear: "",
      deathYear: "1980",
      order: "",
    });
  });
  it("chỉ gửi lại từ đề xuất của chính mình, cùng người/loại, trạng thái phù hợp", () => {
    const d = doc();
    expect(resubmitSource(d, "u1", "a", "CHILD")).toBe(d);
    expect(resubmitSource(d, "u2", "a", "CHILD")).toBeNull();
    expect(resubmitSource(d, "u1", "b", "CHILD")).toBeNull();
    expect(resubmitSource(d, "u1", "a", "SPOUSE")).toBeNull();
    expect(
      resubmitSource(doc({ status: "PENDING" }), "u1", "a", "CHILD"),
    ).toBeNull();
    expect(resubmitSource(undefined, "u1", "a", "CHILD")).toBeNull();
  });
  it("thông báo lỗi thân thiện, không lộ mã kỹ thuật", () => {
    expect(proposalErrorMessage({ code: "permission-denied" })).toContain(
      "60 giây",
    );
    expect(proposalErrorMessage({ code: "unavailable" })).toContain("kết nối");
    expect(proposalErrorMessage(new Error("boom"))).not.toContain("boom");
  });
  it("lỗi gửi lại nhắc kiểm tra đề xuất cũ; lỗi rút KHÔNG nói về 60 giây", () => {
    const denied = { code: "permission-denied" };
    expect(proposalErrorMessage(denied, { resubmit: true })).toContain(
      "đề xuất cũ",
    );
    const w = withdrawErrorMessage(denied);
    expect(w).toContain("quản trị viên xử lý");
    expect(w).toContain("tải lại");
    expect(w).not.toContain("60");
    expect(withdrawErrorMessage({ code: "unavailable" })).toContain("kết nối");
    expect(withdrawErrorMessage(new Error("boom"))).not.toContain("boom");
  });
  it("nhận biết cha/mẹ còn lại không còn trong danh sách vợ/chồng", () => {
    const p = doc().payload as never;
    expect(lostOtherParent(p, ["m1"])).toBe(false);
    expect(lostOtherParent(p, [])).toBe(true);
    expect(
      lostOtherParent({ ...(p as object), otherParentId: null } as never, []),
    ).toBe(false);
  });
});
