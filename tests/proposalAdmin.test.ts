import { describe, expect, it } from "vitest";
import { EditError } from "../src/editCore";
import type { ProposalDoc } from "../src/memberProposal";
import type { TreeIndex } from "../src/treeModel";
import {
  adminActions,
  authorInfo,
  authorText,
  decisionErrorMessage,
  isOwnProposal,
  nameKey,
  otherOpenForAnchor,
  proposalMatchesAudit,
  similarExisting,
  similarNames,
  sortOldestFirst,
  verifiedResubmit,
} from "../src/proposalAdmin";

const PID = "p-abcdefghijkl";
const raw = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  kind: "CHILD",
  anchorId: "a",
  newId: PID,
  payload: {
    name: "Giả Con",
    sex: "M",
    birthYear: 1990,
    deathYear: null,
    deceased: false,
    note: "",
    role: "FATHER",
    otherParentId: null,
    adoptive: false,
    category: "CLAN",
    branch: "I",
  },
  status: "APPROVED",
  authorUid: "m1",
  appliedEditVersion: 7,
  ...over,
});
const doc = (over: Partial<ProposalDoc> = {}): ProposalDoc =>
  ({
    id: PID,
    schemaVersion: 1,
    kind: "CHILD",
    anchorId: "a",
    newId: PID,
    payload: {} as never,
    status: "PENDING",
    authorUid: "m1",
    ...over,
  }) as ProposalDoc;

describe("so tên gần giống", () => {
  it("chuẩn hóa bỏ dấu, hoa/thường, khoảng trắng", () => {
    expect(nameKey("  Nguyễn  ĐỨC Thịnh ")).toBe("nguyen duc thinh");
    expect(similarNames("Nguyễn Đức Thịnh", "nguyen duc  thinh")).toBe(true);
  });
  it("tên ngắn nằm trọn trong tên dài (từ 2 từ trở lên) thì gần giống", () => {
    expect(similarNames("Nguyễn Đức Thịnh", "Đức Thịnh")).toBe(true);
    expect(similarNames("Đức Thịnh", "Nguyễn Đức Thịnh")).toBe(true);
  });
  it("một từ đơn lẻ, hoặc khác hẳn, không gần giống; chuỗi con giữa từ không tính", () => {
    expect(similarNames("Thịnh", "Nguyễn Đức Thịnh")).toBe(false);
    expect(similarNames("Giả Văn An", "Giả Văn Bình")).toBe(false);
    expect(similarNames("Văn An", "Giả Văn Ánh")).toBe(false);
    expect(similarNames("", "Giả Văn An")).toBe(false);
  });
  const persons = new Map(
    (
      [
        ["c1", "Giả Văn Con"],
        ["c2", "Giả Thị Khác"],
        ["s1", "Trần Thị Vợ"],
      ] as const
    ).map(([id, name]) => [id, { id, name }]),
  );
  const index = {
    snapshot: { persons },
    children: (id: string) => (id === "a" ? ["c1", "c2", "c1", "gone"] : []),
    spouses: (id: string) => (id === "a" ? ["s1"] : []),
  } as unknown as TreeIndex;
  it("tìm con/vợ chồng hiện có của người gốc trùng tên (bỏ lặp, bỏ người không còn)", () => {
    expect(
      similarExisting(index, { kind: "CHILD", anchorId: "a" }, "giả văn con").map((p) => p.id),
    ).toEqual(["c1"]);
    expect(
      similarExisting(index, { kind: "SPOUSE", anchorId: "a" }, "Trần Thị Vợ").map((p) => p.id),
    ).toEqual(["s1"]);
    // Vợ/chồng không bị tính khi đề xuất là con.
    expect(similarExisting(index, { kind: "CHILD", anchorId: "a" }, "Trần Thị Vợ")).toEqual([]);
    expect(similarExisting(index, { kind: "CHILD", anchorId: "zz" }, "Giả Văn Con")).toEqual([]);
  });
});

describe("hàng đợi và hành động", () => {
  const item = (id: string, anchorId: string, status: ProposalDoc["status"], t: number | null) => ({
    doc: doc({ id, anchorId, status }),
    createdAtMs: t,
  });
  it("đề xuất đang mở khác cùng người gốc", () => {
    const items = [
      item("p-aaaaaaaaaaa1", "a", "PENDING", 3),
      item("p-aaaaaaaaaaa2", "a", "NEEDS_INFO", 1),
      item("p-aaaaaaaaaaa3", "a", "REJECTED", 2),
      item("p-aaaaaaaaaaa4", "b", "PENDING", 4),
    ];
    expect(
      otherOpenForAnchor(items, { id: "p-aaaaaaaaaaa1", anchorId: "a" }).map((i) => i.doc.id),
    ).toEqual(["p-aaaaaaaaaaa2"]);
  });
  it("sắp cũ nhất trước, không rõ thời điểm xuống cuối, không đổi mảng gốc", () => {
    const items = [item("x", "a", "PENDING", null), item("y", "a", "PENDING", 5), item("z", "a", "PENDING", 2)];
    expect(sortOldestFirst(items).map((i) => i.doc.id)).toEqual(["z", "y", "x"]);
    expect(items[0].doc.id).toBe("x");
  });
  it("hành động theo trạng thái (khớp chuyển trạng thái của quản trị viên)", () => {
    expect(adminActions("PENDING")).toEqual({ approve: true, reject: true, needInfo: true });
    expect(adminActions("NEEDS_INFO")).toEqual({ approve: true, reject: true, needInfo: false });
    for (const s of ["APPROVED", "REJECTED", "WITHDRAWN"] as const)
      expect(adminActions(s)).toEqual({ approve: false, reject: false, needInfo: false });
  });
  it("không tự xử lý đề xuất của mình", () => {
    expect(isOwnProposal({ authorUid: "u1" }, "u1")).toBe(true);
    expect(isOwnProposal({ authorUid: "u1" }, "u2")).toBe(false);
  });
});

describe("gửi lại (resubmitOf) phải được giao diện kiểm", () => {
  const cur = doc({ authorUid: "m1", resubmitOf: "p-oldoldoldold" });
  const old = (over: Partial<ProposalDoc> = {}) =>
    doc({ id: "p-oldoldoldold", authorUid: "m1", status: "REJECTED", ...over });
  it("cùng tác giả và ĐÃ RÚT/TỪ CHỐI thì hợp lệ", () => {
    expect(verifiedResubmit(cur, old())?.id).toBe("p-oldoldoldold");
    expect(verifiedResubmit(cur, old({ status: "WITHDRAWN" }))).not.toBeNull();
  });
  it("khác tác giả, trạng thái khác, không có hoặc sai mã thì không", () => {
    expect(verifiedResubmit(cur, old({ authorUid: "m2" }))).toBeNull();
    for (const s of ["PENDING", "NEEDS_INFO", "APPROVED"] as const)
      expect(verifiedResubmit(cur, old({ status: s }))).toBeNull();
    expect(verifiedResubmit(cur, null)).toBeNull();
    expect(verifiedResubmit(cur, old({ id: "p-zzzzzzzzzzzz" }))).toBeNull();
    expect(verifiedResubmit(doc(), old())).toBeNull();
  });
});

describe("đối chiếu đề xuất với nhật ký (chống giả mạo after.proposalId)", () => {
  it("chỉ khớp khi APPROVED và appliedEditVersion bằng phiên bản nhật ký", () => {
    expect(proposalMatchesAudit(PID, raw(), 7)).toBe(true);
  });
  it("sai phiên bản, chưa APPROVED, thiếu appliedEditVersion, không tồn tại, hỏng đều không khớp", () => {
    expect(proposalMatchesAudit(PID, raw(), 8)).toBe(false);
    for (const status of ["PENDING", "NEEDS_INFO", "REJECTED", "WITHDRAWN"])
      expect(proposalMatchesAudit(PID, raw({ status }), 7)).toBe(false);
    expect(proposalMatchesAudit(PID, raw({ appliedEditVersion: undefined }), 7)).toBe(false);
    expect(proposalMatchesAudit(PID, null, 7)).toBe(false);
    expect(proposalMatchesAudit(PID, { status: "APPROVED" }, 7)).toBe(false);
    // Mã trong nhật ký khác mã đề xuất đọc về.
    expect(proposalMatchesAudit("p-zzzzzzzzzzzz", raw(), 7)).toBe(false);
    expect(proposalMatchesAudit(PID, raw(), Number.NaN)).toBe(false);
  });
});

describe("thông báo lỗi khi duyệt", () => {
  const e = (code: ConstructorParameters<typeof EditError>[0], m: string) => new EditError(code, m);
  it("xung đột phiên bản, đã xử lý, người gốc bị ẩn, mã trùng, cha không đủ điều kiện", () => {
    expect(decisionErrorMessage(e("VERSION_CONFLICT", "x"))).toContain("tải lại");
    expect(
      decisionErrorMessage(e("BAD_STATE", "Đề xuất này không còn ở trạng thái duyệt được.")),
    ).toContain("đã được xử lý");
    expect(decisionErrorMessage(e("BAD_STATE", "Chưa có ảnh chụp cây."))).toContain("Chưa có ảnh chụp cây.");
    expect(decisionErrorMessage(e("INVALID", "Cha/mẹ không có trong cây."))).toContain("không còn trong cây");
    expect(decisionErrorMessage(e("INVALID", "Người này không có trong cây."))).toContain("không còn trong cây");
    expect(decisionErrorMessage(e("INVALID", "Mã người mới đã tồn tại; hãy thử lại."))).toContain("Từ chối");
    const clan = decisionErrorMessage(e("INVALID", "Người thuộc dòng họ phải có cha thuộc dòng họ."));
    expect(clan).toContain("Họ ngoại");
    expect(decisionErrorMessage(e("NOT_FOUND", "x"))).toContain("Không tìm thấy");
  });
  it("lỗi Firestore: quyền, mạng, tranh chấp, lạ — luôn nói chưa ghi gì", () => {
    for (const code of ["permission-denied", "unavailable", "aborted", "weird"])
      expect(decisionErrorMessage({ code })).toMatch(/chưa có gì được ghi/i);
    expect(decisionErrorMessage(null)).toMatch(/chưa có gì được ghi/i);
  });
});

describe("tên người gửi", () => {
  it("tên, email, thu hồi, không có tài khoản", () => {
    expect(authorText(authorInfo(true, { displayName: "Nguyễn A", enabled: true }))).toBe("Nguyễn A");
    expect(authorText(authorInfo(true, { email: "a@example.test", enabled: false }))).toBe(
      "a@example.test (đã thu hồi)",
    );
    expect(authorText(authorInfo(false, null))).toBe("tài khoản đã thu hồi");
    expect(authorText(authorInfo(true, { enabled: true }))).toBe("tài khoản đã thu hồi");
    expect(authorText({ kind: "error" })).toContain("chưa tra được");
    expect(authorText(undefined)).toContain("đang tra");
  });
  it("cắt độ dài và bỏ ký tự điều khiển", () => {
    const a = authorInfo(true, { displayName: "A\u0007" + "b".repeat(300), enabled: true });
    expect(a.kind === "named" && a.label.length).toBe(120);
    expect(a.kind === "named" && a.label.includes("\u0007")).toBe(false);
  });
});

describe("bỏ cha/mẹ còn lại khi duyệt", () => {
  it("chỉ báo khi đề xuất có cha/mẹ còn lại mà ô biểu mẫu rỗng", async () => {
    const { droppedOtherParent } = await import("../src/proposalAdmin");
    expect(droppedOtherParent({ otherParentId: "b" }, "")).toBe(true);
    expect(droppedOtherParent({ otherParentId: "b" }, "b")).toBe(false);
    expect(droppedOtherParent({ otherParentId: null }, "")).toBe(false);
  });
});
