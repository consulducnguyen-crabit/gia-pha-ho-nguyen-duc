// Rules + lô ghi của đề xuất thêm thành viên (memberProposals, proposalThrottle) trên emulator Firestore (dữ liệu giả).
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { addTargets, applyAdd, type AddOp } from "../src/editAdd";
import { stageWrites, submitProposal, withdrawProposal, decideProposal, commitApproveProposal, type SetTarget } from "../src/editClient";
import { buildProposal, proposalToAddOp, readProposal } from "../src/memberProposal";
import { emptyPerson } from "../src/addForm";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha-proposal",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
}, 30000);
afterAll(async () => {
  await env?.cleanup();
});

const tree = {
  v: 1,
  persons: {
    a: ["Nguyễn Văn A", 1900, 1970, 1, "C", "c1", []],
    b: ["Nguyễn Văn B", null, null, 2, "C", null, []],
    m: ["Mẹ M", null, null, null, "S", null, []],
  },
  relations: [["a", "b", "F", "B", 1]],
  unions: [],
  branches: { c1: ["Chi 1", "a", null, null] },
};
const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
const PID = "p-abcdefghijkl";
const PID2 = "p-mnopqrstuvwx";

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const user = (extra: object = {}) => ({ enabled: true, roleIds: ["member"], accessVersion: 1, schemaVersion: 1, ...extra });
    await setDoc(doc(db, "users", "a1"), user({ canManageMembership: true }));
    await setDoc(doc(db, "users", "a2"), user({ canManageMembership: true }));
    await setDoc(doc(db, "users", "half"), user({ canManageMembership: true })); // có cờ nhưng không có trong sổ
    await setDoc(doc(db, "users", "m1"), user());
    await setDoc(doc(db, "users", "m2"), user());
    await setDoc(doc(db, "users", "off"), user({ enabled: false }));
    await setDoc(doc(db, "accessControl", "admins"), { adminUids: ["a1", "a2"], version: 1, lastTargetUid: "", schemaVersion: 1 });
    await setDoc(doc(db, "treeSnapshots", "main"), { schemaVersion: 1, dataVersion: "fake", data: JSON.stringify(tree) });
    for (const id of ["a", "b", "m"]) {
      await setDoc(doc(db, "persons", id), { displayName: id, normalizedName: id, sex: id === "m" ? "F" : "M", category: id === "m" ? "SPOUSE" : "CLAN", profileVersion: 1 });
      await setDoc(doc(db, "memberProfiles", id), { displayName: id, normalizedName: id, profileVersion: 1, schemaVersion: 1 });
    }
  });
});

const childPayload = (over: object = {}) => ({
  name: "Giả Con", sex: "M", birthYear: 1960, deathYear: null, deceased: false, note: "ghi chú\ndòng hai",
  role: "FATHER", otherParentId: null, adoptive: false, category: "CLAN", branch: "c1", ...over,
});
const spousePayload = (over: object = {}) => ({
  name: "Vợ Giả", sex: "F", birthYear: null, deathYear: null, deceased: false, note: "", category: "SPOUSE", order: "1", ...over,
});
/** Dữ liệu đề xuất thô (đúng hình dạng rules đòi); `now` = thời điểm ghi. */
const raw = (uid: string, over: Record<string, unknown> = {}, now: unknown = serverTimestamp()) => ({
  schemaVersion: 1, kind: "CHILD", anchorId: "a", newId: PID, payload: childPayload(),
  status: "PENDING", authorUid: uid, createdAt: now, updatedAt: now, ...over,
});
/** Gửi thô: đề xuất + throttle trong một lô. */
async function rawSubmit(db: Firestore, uid: string, over: Record<string, unknown> = {}, id = PID, throttle: Record<string, unknown> | null = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "memberProposals", id), raw(uid, { newId: id, ...over }));
  if (throttle) b.set(doc(db, "proposalThrottle", uid), { lastAt: serverTimestamp(), lastProposalId: id, schemaVersion: 1, ...throttle });
  return b.commit();
}
/** Gieo đề xuất có sẵn (bỏ qua rules). */
async function seed(id: string, over: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "memberProposals", id), raw("m1", { newId: id, ...over }, Timestamp.now()));
  });
}
/** Đưa throttle về quá khứ để phép thử chỉ còn lỗi do chính trường đang kiểm. */
const resetThrottle = (uid: string) =>
  env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "proposalThrottle", uid), { lastAt: Timestamp.fromMillis(0), lastProposalId: PID2, schemaVersion: 1 });
  });
const readRaw = async (path: string, id: string) => {
  let d: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (c) => {
    d = (await getDoc(doc(c.firestore(), path, id))).data();
  });
  return d;
};

describe("tạo đề xuất", () => {
  it("thành viên gửi thêm con và vợ/chồng hợp lệ qua mã client; throttle ghi cùng lô", async () => {
    const db = as("m1");
    const r = buildProposal("CHILD", "a", { ...emptyPerson, name: "Giả Con", note: "ghi\nchú", role: "FATHER", otherParent: "m", category: "CLAN", adoptive: false, branch: "c1" }, { newId: PID, authorUid: "m1", canBeLineageFather: () => true, source: "Sổ họ" });
    if (!("proposal" in r)) throw new Error(JSON.stringify(r));
    await assertSucceeds(submitProposal(db, r.proposal));
    expect(await readRaw("memberProposals", PID)).toMatchObject({ status: "PENDING", authorUid: "m1", kind: "CHILD", source: "Sổ họ" });
    expect(await readRaw("proposalThrottle", "m1")).toMatchObject({ lastProposalId: PID });
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "proposalThrottle", "m1"), { lastAt: Timestamp.fromMillis(Date.now() - 120000), lastProposalId: PID, schemaVersion: 1 });
    });
    const s = buildProposal("SPOUSE", "b", { ...emptyPerson, name: "Vợ Giả", kind: "new", existingId: "", category: "SPOUSE", order: "1" }, { newId: PID2, authorUid: "m1", canBeLineageFather: () => true });
    if (!("proposal" in s)) throw new Error("lỗi");
    await assertSucceeds(submitProposal(db, s.proposal));
  });

  it("ghi chú có xuống dòng và tab qua regex; ký tự điều khiển khác bị chặn", async () => {
    const db = as("m1");
    await assertSucceeds(rawSubmit(db, "m1", { payload: childPayload({ note: "a\n\tb" }) }));
    for (const note of ["a\u0007b", "a\rb", "a\u007fb"]) {
      await resetThrottle("m1");
      await assertFails(rawSubmit(db, "m1", { payload: childPayload({ note }) }, PID2));
    }
  });

  it("giả mạo bị chặn: tác giả, trạng thái, thời gian, khóa thừa, mã sai, quá dài, payload thừa, họ ngoại có chi", async () => {
    const db = as("m1");
    const bad: Array<[string, Record<string, unknown>]> = [
      ["authorUid người khác", { authorUid: "m2" }],
      ["status APPROVED", { status: "APPROVED" }],
      ["khóa thừa ở đề xuất", { decidedBy: "a1" }],
      ["newId khác id", { newId: PID2 }],
      ["kind lạ", { kind: "OTHER" }],
      ["anchorId == newId", { anchorId: PID }],
      ["anchorId có ký tự lạ", { anchorId: "a/b" }],
      ["schemaVersion 2", { schemaVersion: 2 }],
      ["note quá dài", { payload: childPayload({ note: "x".repeat(2001) }) }],
      ["tên quá dài", { payload: childPayload({ name: "x".repeat(121) }) }],
      ["tên có ký tự điều khiển", { payload: childPayload({ name: "a\nb" }) }],
      ["payload thừa khóa", { payload: { ...childPayload(), role2: "x" } }],
      ["payload thiếu khóa", { payload: Object.fromEntries(Object.entries(childPayload()).filter(([k]) => k !== "branch")) }],
      ["họ ngoại có chi", { payload: childPayload({ category: "EXTERNAL", branch: "c1" }) }],
      ["năm ngoài khoảng", { payload: childPayload({ birthYear: 999 }) }],
      ["giới tính lạ", { payload: childPayload({ sex: "X" }) }],
      ["vai trò lạ", { payload: childPayload({ role: "BOSS" }) }],
      ["otherParent == anchor", { payload: childPayload({ otherParentId: "a" }) }],
      ["source quá dài", { source: "x".repeat(301) }],
      ["resubmitOf sai dạng", { resubmitOf: "xyz" }],
      ["payload SPOUSE lẫn kind CHILD", { payload: spousePayload() }],
    ];
    for (const [label, over] of bad) {
      await resetThrottle("m1");
      await assertFails(rawSubmit(db, "m1", over));
      void label;
    }
    // createdAt do client đặt (không phải thời điểm máy chủ).
    await resetThrottle("m1");
    const b = writeBatch(db);
    b.set(doc(db, "memberProposals", PID), raw("m1", {}, Timestamp.fromMillis(0)));
    b.set(doc(db, "proposalThrottle", "m1"), { lastAt: serverTimestamp(), lastProposalId: PID, schemaVersion: 1 });
    await assertFails(b.commit());
    // id không đúng dạng p-[a-z0-9]{12}.
    await resetThrottle("m1");
    await assertFails(rawSubmit(db, "m1", {}, "p-short"));
    await resetThrottle("m1");
    await assertFails(rawSubmit(db, "m1", {}, "P-ABCDEFGHIJKL"));
  });

  it("vợ/chồng: category và order được kiểm tra", async () => {
    const db = as("m1");
    const sp = (p: object) => rawSubmit(db, "m1", { kind: "SPOUSE", anchorId: "b", payload: spousePayload(p) });
    for (const bad of [{ category: "CLAN" }, { order: "x".repeat(21) }, { order: "" }]) {
      await resetThrottle("m1");
      await assertFails(sp(bad));
    }
    await resetThrottle("m1");
    await assertSucceeds(sp({ order: null, category: "EXTERNAL" }));
  });

  it("thiếu hoặc sai throttle bị chặn; một lô không lách được bằng nhiều đề xuất", async () => {
    const db = as("m1");
    await assertFails(rawSubmit(db, "m1", {}, PID, null));
    await resetThrottle("m1");
    await assertFails(rawSubmit(db, "m1", {}, PID, { lastProposalId: PID2 }));
    await resetThrottle("m1");
    await assertFails(rawSubmit(db, "m1", {}, PID, { lastAt: Timestamp.fromMillis(0) }));
    await resetThrottle("m1");
    const b = writeBatch(db);
    b.set(doc(db, "memberProposals", PID), raw("m1"));
    b.set(doc(db, "memberProposals", PID2), raw("m1", { newId: PID2 }));
    b.set(doc(db, "proposalThrottle", "m1"), { lastAt: serverTimestamp(), lastProposalId: PID, schemaVersion: 1 });
    await assertFails(b.commit());
    // Throttle của người khác.
    await resetThrottle("m1");
    const t = writeBatch(db);
    t.set(doc(db, "memberProposals", PID), raw("m1"));
    t.set(doc(db, "proposalThrottle", "m2"), { lastAt: serverTimestamp(), lastProposalId: PID, schemaVersion: 1 });
    await assertFails(t.commit());
  });

  it("hai đề xuất liên tiếp trong 60 giây bị chặn; sau 60 giây thì được", async () => {
    const db = as("m1");
    await assertSucceeds(rawSubmit(db, "m1", {}, PID));
    await assertFails(rawSubmit(db, "m1", {}, PID2));
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "proposalThrottle", "m1"), { lastAt: Timestamp.fromMillis(Date.now() - 59000), lastProposalId: PID, schemaVersion: 1 });
    });
    await assertFails(rawSubmit(db, "m1", {}, PID2));
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "proposalThrottle", "m1"), { lastAt: Timestamp.fromMillis(Date.now() - 61000), lastProposalId: PID, schemaVersion: 1 });
    });
    await assertSucceeds(rawSubmit(db, "m1", {}, PID2));
  });

  it("ẩn danh, tài khoản bị tắt, chưa cấp quyền (không có users) bị chặn", async () => {
    await assertFails(rawSubmit(anon(), "m1"));
    await assertFails(rawSubmit(as("off"), "off"));
    await assertFails(rawSubmit(as("stranger"), "stranger"));
  });

  it("gửi lại: tạo đề xuất mới và rút đề xuất cũ cùng lô; cũ phải của chính mình", async () => {
    await seed(PID2, { status: "NEEDS_INFO" });
    const db = as("m1");
    const b = writeBatch(db);
    b.set(doc(db, "memberProposals", PID), raw("m1", { resubmitOf: PID2 }));
    b.set(doc(db, "proposalThrottle", "m1"), { lastAt: serverTimestamp(), lastProposalId: PID, schemaVersion: 1 });
    b.update(doc(db, "memberProposals", PID2), { status: "WITHDRAWN", updatedAt: serverTimestamp(), withdrawnAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    expect((await readRaw("memberProposals", PID2))?.status).toBe("WITHDRAWN");
    // m2 không rút được đề xuất của m1 trong lô gửi lại.
    await seed("p-qqqqqqqqqqqq", { status: "PENDING" });
    const m2 = as("m2");
    const c = writeBatch(m2);
    c.set(doc(m2, "memberProposals", "p-rrrrrrrrrrrr"), raw("m2", { newId: "p-rrrrrrrrrrrr", resubmitOf: "p-qqqqqqqqqqqq" }));
    c.set(doc(m2, "proposalThrottle", "m2"), { lastAt: serverTimestamp(), lastProposalId: "p-rrrrrrrrrrrr", schemaVersion: 1 });
    c.update(doc(m2, "memberProposals", "p-qqqqqqqqqqqq"), { status: "WITHDRAWN", updatedAt: serverTimestamp(), withdrawnAt: serverTimestamp() });
    await assertFails(c.commit());
  });
});

describe("đọc và liệt kê", () => {
  it("tác giả đọc/liệt kê của mình; người khác bị chặn; admin đọc tất cả", async () => {
    await seed(PID);
    await seed(PID2, { authorUid: "m2" });
    await assertSucceeds(getDoc(doc(as("m1"), "memberProposals", PID)));
    await assertFails(getDoc(doc(as("m2"), "memberProposals", PID)));
    await assertFails(getDoc(doc(anon(), "memberProposals", PID)));
    const mine = await assertSucceeds(getDocs(query(collection(as("m1"), "memberProposals"), where("authorUid", "==", "m1"))));
    expect(mine.docs.map((d) => d.id)).toEqual([PID]);
    await assertFails(getDocs(query(collection(as("m1"), "memberProposals"), where("authorUid", "==", "m2"))));
    await assertFails(getDocs(collection(as("m1"), "memberProposals")));
    await assertSucceeds(getDoc(doc(as("a1"), "memberProposals", PID)));
    const all = await assertSucceeds(getDocs(collection(as("a2"), "memberProposals")));
    expect(all.size).toBe(2);
    // admin "nửa vời" (không có trong sổ) không đọc được của người khác.
    await assertFails(getDoc(doc(as("half"), "memberProposals", PID)));
    await assertFails(getDocs(collection(as("half"), "memberProposals")));
  });
  it("proposalThrottle: chỉ đọc của mình", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "proposalThrottle", "m1"), { lastAt: Timestamp.now(), lastProposalId: PID, schemaVersion: 1 });
    });
    await assertSucceeds(getDoc(doc(as("m1"), "proposalThrottle", "m1")));
    await assertFails(getDoc(doc(as("m2"), "proposalThrottle", "m1")));
    await assertFails(getDoc(doc(as("a1"), "proposalThrottle", "m1")));
  });
});

describe("rút lại", () => {
  it("tác giả rút khi PENDING hoặc NEEDS_INFO; người khác và trạng thái cuối thì không", async () => {
    await seed(PID);
    await assertFails(withdrawProposal(as("m2"), PID));
    await assertFails(withdrawProposal(as("a1"), PID));
    await assertSucceeds(withdrawProposal(as("m1"), PID));
    expect((await readRaw("memberProposals", PID))?.status).toBe("WITHDRAWN");
    await assertFails(withdrawProposal(as("m1"), PID));
    await seed(PID2, { status: "NEEDS_INFO" });
    await assertSucceeds(withdrawProposal(as("m1"), PID2));
    for (const status of ["APPROVED", "REJECTED"]) {
      await seed("p-tttttttttttt", { status });
      await assertFails(withdrawProposal(as("m1"), "p-tttttttttttt"));
    }
  });
  it("rút lại không đổi được nội dung hay trường khác", async () => {
    await seed(PID);
    const db = as("m1");
    const at = serverTimestamp();
    await assertFails(updateDoc(doc(db, "memberProposals", PID), { status: "WITHDRAWN", updatedAt: at, withdrawnAt: at, payload: childPayload({ name: "Sửa" }) }));
    await assertFails(updateDoc(doc(db, "memberProposals", PID), { status: "WITHDRAWN", updatedAt: at, withdrawnAt: at, authorUid: "m2" }));
    await assertFails(updateDoc(doc(db, "memberProposals", PID), { status: "PENDING", updatedAt: at }));
    await assertFails(updateDoc(doc(db, "memberProposals", PID), { payload: childPayload({ name: "Sửa" }), updatedAt: at }));
    await assertFails(updateDoc(doc(db, "memberProposals", PID), { status: "WITHDRAWN", updatedAt: Timestamp.fromMillis(0), withdrawnAt: at }));
  });
  it("không xóa được (kể cả admin)", async () => {
    await seed(PID);
    await assertFails(deleteDoc(doc(as("m1"), "memberProposals", PID)));
    await assertFails(deleteDoc(doc(as("a1"), "memberProposals", PID)));
  });
});

describe("quản trị viên quyết định", () => {
  it("từ chối và yêu cầu bổ sung cần lý do; thành viên thường và admin ngoài sổ không làm được", async () => {
    await seed(PID);
    await assertFails(decideProposal(as("m1"), { proposalId: PID, status: "REJECTED", reason: "x", actorUid: "m1" }));
    await assertFails(decideProposal(as("half"), { proposalId: PID, status: "REJECTED", reason: "x", actorUid: "half" }));
    await expect(decideProposal(as("a1"), { proposalId: PID, status: "REJECTED", reason: "", actorUid: "a1" })).rejects.toThrow(); // chặn ở client
    await assertFails(updateDoc(doc(as("a1"), "memberProposals", PID), { status: "REJECTED", decidedBy: "a1", decidedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as("a1"), "memberProposals", PID), { status: "REJECTED", decidedBy: "a2", decidedAt: serverTimestamp(), decisionReason: "x", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as("a1"), "memberProposals", PID), { status: "REJECTED", decidedBy: "a1", decidedAt: serverTimestamp(), decisionReason: "x", updatedAt: serverTimestamp(), payload: childPayload({ name: "Sửa trộm" }) }));
    await assertSucceeds(decideProposal(as("a1"), { proposalId: PID, status: "NEEDS_INFO", reason: "Cần thêm nguồn", actorUid: "a1" }));
    const asked = await readRaw("memberProposals", PID);
    expect(asked).toMatchObject({ status: "NEEDS_INFO", infoRequestedBy: "a1", infoRequestReason: "Cần thêm nguồn" });
    expect(asked).not.toHaveProperty("decidedBy");
    expect(asked).not.toHaveProperty("decisionReason");
    await assertFails(decideProposal(as("a2"), { proposalId: PID, status: "NEEDS_INFO", reason: "lại", actorUid: "a2" }));
    await assertSucceeds(decideProposal(as("a2"), { proposalId: PID, status: "REJECTED", reason: "Không đủ căn cứ", actorUid: "a2" }));
    // Lịch sử "cần bổ sung" được giữ nguyên, quyết định cuối ghi riêng.
    expect(await readRaw("memberProposals", PID)).toMatchObject({
      status: "REJECTED", infoRequestedBy: "a1", infoRequestReason: "Cần thêm nguồn", decidedBy: "a2", decisionReason: "Không đủ căn cứ",
    });
    // Trạng thái cuối không đổi nữa.
    await assertFails(decideProposal(as("a1"), { proposalId: PID, status: "NEEDS_INFO", reason: "x", actorUid: "a1" }));
    await expect(commitApproveProposal(as("a1"), { proposalId: PID, expectedVersion: 0, actorUid: "a1" })).rejects.toThrow(); // chặn ở client
    await assertFails(withdrawProposal(as("m1"), PID));
  });
  it("NEEDS_INFO chỉ ghi infoRequest*; quyết định cuối không đổi được infoRequest*", async () => {
    const t = () => serverTimestamp();
    const ref = (uid: string) => doc(as(uid), "memberProposals", PID);
    await seed(PID);
    // Yêu cầu bổ sung không được ghi decided*/decisionReason, phải có người, thời gian đúng và lý do.
    await assertFails(updateDoc(ref("a1"), { status: "NEEDS_INFO", infoRequestedBy: "a1", infoRequestedAt: t(), infoRequestReason: "x", decidedBy: "a1", updatedAt: t() }));
    await assertFails(updateDoc(ref("a1"), { status: "NEEDS_INFO", infoRequestedBy: "a1", infoRequestedAt: t(), infoRequestReason: "x", decisionReason: "x", updatedAt: t() }));
    await assertFails(updateDoc(ref("a1"), { status: "NEEDS_INFO", infoRequestedBy: "a1", infoRequestedAt: t(), updatedAt: t() }));
    await assertFails(updateDoc(ref("a1"), { status: "NEEDS_INFO", infoRequestedBy: "a2", infoRequestedAt: t(), infoRequestReason: "x", updatedAt: t() }));
    await assertFails(updateDoc(ref("a1"), { status: "NEEDS_INFO", infoRequestedBy: "a1", infoRequestedAt: Timestamp.fromMillis(0), infoRequestReason: "x", updatedAt: t() }));
    await assertFails(updateDoc(ref("a1"), { status: "NEEDS_INFO", infoRequestedBy: "a1", infoRequestedAt: t(), infoRequestReason: "", updatedAt: t() }));
    await assertFails(updateDoc(ref("m1"), { status: "NEEDS_INFO", infoRequestedBy: "m1", infoRequestedAt: t(), infoRequestReason: "x", updatedAt: t() }));
    await assertSucceeds(decideProposal(as("a1"), { proposalId: PID, status: "NEEDS_INFO", reason: "Cần thêm nguồn", actorUid: "a1" }));
    // Quyết định cuối không được sửa/xóa infoRequest*.
    const rej = { status: "REJECTED", decidedBy: "a2", decidedAt: t(), decisionReason: "x", updatedAt: t() };
    await assertFails(updateDoc(ref("a2"), { ...rej, infoRequestReason: "đổi" }));
    await assertFails(updateDoc(ref("a2"), { ...rej, infoRequestedBy: "a2" }));
    await assertFails(updateDoc(ref("a2"), { ...rej, infoRequestedAt: t() }));
    await assertFails(updateDoc(ref("a2"), { ...rej, infoRequestReason: deleteField() }));
    await assertSucceeds(updateDoc(ref("a2"), rej));
    expect(await readRaw("memberProposals", PID)).toMatchObject({ infoRequestedBy: "a1", infoRequestReason: "Cần thêm nguồn" });
  });
  it("NEEDS_INFO -> APPROVED giữ infoRequest* và không có decisionReason giả", async () => {
    await seed(PID);
    await assertSucceeds(decideProposal(as("a1"), { proposalId: PID, status: "NEEDS_INFO", reason: "Cần thêm nguồn", actorUid: "a1" }));
    await assertSucceeds(commitApproveProposal(as("a2"), { proposalId: PID, expectedVersion: 0, actorUid: "a2" }));
    const d = await readRaw("memberProposals", PID);
    expect(d).toMatchObject({ status: "APPROVED", decidedBy: "a2", infoRequestedBy: "a1", infoRequestReason: "Cần thêm nguồn" });
    expect(d).not.toHaveProperty("decisionReason");
  });
  it("admin không tự duyệt/từ chối đề xuất của chính mình", async () => {
    await seed(PID, { authorUid: "a1" });
    await assertFails(decideProposal(as("a1"), { proposalId: PID, status: "REJECTED", reason: "x", actorUid: "a1" }));
    await assertSucceeds(decideProposal(as("a2"), { proposalId: PID, status: "REJECTED", reason: "x", actorUid: "a2" }));
    await seed(PID2, { authorUid: "a1", newId: PID2 });
    await expect(commitApproveProposal(as("a1"), { proposalId: PID2, expectedVersion: 0, actorUid: "a1" })).rejects.toThrow(); // chặn ở client
    expect((await readRaw("memberProposals", PID2))?.status).toBe("PENDING");
    // Bỏ qua kiểm tra client: ghi thẳng lô duyệt do chính tác giả-admin thực hiện vẫn bị rules chặn.
    const w = await planApprove(as("a1"), PID2, "a1");
    await assertFails(commitApprove(as("a1"), w));
  });
});

// ---- duyệt: lô ghi người + đánh dấu APPROVED ---------------------------------------------------------------------
type Writes = ReturnType<typeof applyAdd>["writes"];
interface Plan {
  writes: Writes;
  nextVersion: number;
  id: string;
}
async function planApprove(db: Firestore, id: string, actor: string, opOverride?: AddOp, proposalId: string | null = id): Promise<Plan> {
  const p = readProposal(id, (await getDoc(doc(db, "memberProposals", id))).data())!;
  const op = opOverride ?? proposalToAddOp(p);
  const docs: Record<string, Record<string, unknown> | null> = {};
  for (const t of addTargets(op)) {
    const d = await getDoc(doc(db, "persons", t));
    docs[t] = d.exists() ? d.data() : null;
  }
  const snap = await getDoc(doc(db, "treeSnapshots", "main"));
  const r = applyAdd({ snapshot: snap.data()!, docs }, { op, expectedVersion: 0, actorUid: actor, ...(proposalId ? { proposalId } : {}) });
  return { writes: r.writes, nextVersion: r.nextVersion, id };
}
function commitApprove(db: Firestore, plan: Plan, tweak: Record<string, unknown> = {}, skipMark = false) {
  const b = writeBatch(db);
  stageWrites(db, b as unknown as SetTarget, plan.writes);
  if (!skipMark)
    b.update(doc(db, "memberProposals", plan.id), {
      status: "APPROVED", decidedBy: "a1", decidedAt: serverTimestamp(), appliedEditVersion: plan.nextVersion, updatedAt: serverTimestamp(), ...tweak,
    });
  return b.commit();
}

describe("duyệt: chỉ trong lô ghi người", () => {
  it("thêm con có hai quan hệ + ghi chú: duyệt qua mã client, nhật ký ghi proposalId", async () => {
    await seed(PID, { payload: childPayload({ role: "FATHER", otherParentId: "m", note: "ghi chú riêng" }) });
    const db = as("a1");
    const replay = await planApprove(as("a2"), PID, "a2"); // lô dựng sẵn trước khi đề xuất được duyệt
    const res = await assertSucceeds(commitApproveProposal(db, { proposalId: PID, expectedVersion: 0, actorUid: "a1", reason: "Đã đối chiếu" }));
    expect(res.nextVersion).toBe(1);
    expect((await getDoc(doc(db, "persons", PID))).exists()).toBe(true);
    expect((await getDoc(doc(db, "relations", `r-a-${PID}`))).exists()).toBe(true);
    expect((await getDoc(doc(db, "relations", `r-m-${PID}`))).data()?.parentRole).toBe("MOTHER");
    expect((await getDoc(doc(db, "personPrivate", PID))).data()?.note).toBe("ghi chú riêng");
    expect((await getDoc(doc(db, "auditLogs", "edit-1"))).data()).toMatchObject({ event: "PERSON_ADDED", after: { proposalId: PID } });
    expect(await readRaw("memberProposals", PID)).toMatchObject({ status: "APPROVED", decidedBy: "a1", appliedEditVersion: 1, decisionReason: "Đã đối chiếu" });
    // Duyệt lần hai và rút sau khi đã duyệt đều bị chặn.
    await expect(commitApproveProposal(as("a2"), { proposalId: PID, expectedVersion: 1, actorUid: "a2" })).rejects.toThrow(); // chặn ở client
    await assertFails(commitApprove(as("a2"), replay)); // phát lại lô cũ: rules chặn
    await assertFails(withdrawProposal(as("m1"), PID));
    await assertFails(decideProposal(as("a2"), { proposalId: PID, status: "REJECTED", reason: "x", actorUid: "a2" }));
  });

  it("thêm vợ/chồng mới: người, union, đề xuất APPROVED; admin sửa nội dung khi duyệt", async () => {
    await seed(PID, { kind: "SPOUSE", anchorId: "b", payload: spousePayload() });
    const db = as("a2");
    await assertSucceeds(commitApproveProposal(db, { proposalId: PID, expectedVersion: 0, actorUid: "a2", edits: { name: "Tên đã sửa" } }));
    expect((await getDoc(doc(db, "persons", PID))).data()?.displayName).toBe("Tên đã sửa");
    const unionId = `u-${["b", PID].sort().join("-")}`;
    expect((await getDoc(doc(db, "unions", unionId))).exists()).toBe(true);
    expect((await getDoc(doc(db, "auditLogs", "edit-1"))).data()).toMatchObject({ event: "SPOUSE_ADDED", personId: "b", after: { proposalId: PID } });
    // Nội dung đề xuất không đổi.
    expect((await readRaw("memberProposals", PID))?.payload).toMatchObject({ name: "Vợ Giả" });
  });

  it("APPROVED không kèm lô ghi người bị chặn; lô ghi người không đánh dấu thì đề xuất vẫn chờ", async () => {
    await seed(PID);
    const plan = await planApprove(as("a1"), PID, "a1");
    await assertFails(commitApprove(as("a1"), { ...plan, writes: [] }));
    await assertFails(updateDoc(doc(as("a1"), "memberProposals", PID), { status: "APPROVED", decidedBy: "a1", decidedAt: serverTimestamp(), appliedEditVersion: 1, updatedAt: serverTimestamp() }));
    await assertSucceeds(commitApprove(as("a1"), plan, {}, true)); // người được thêm như admin thường, đề xuất chưa đánh dấu
    expect((await readRaw("memberProposals", PID))?.status).toBe("PENDING");
    // Sau đó đánh dấu APPROVED riêng lẻ (hai bước) bị rules hiện hành chặn.
    await assertFails(updateDoc(doc(as("a1"), "memberProposals", PID), { status: "APPROVED", decidedBy: "a1", decidedAt: serverTimestamp(), appliedEditVersion: 1, updatedAt: serverTimestamp() }));
  });

  it("lô sai bị chặn: newId khác, sự kiện khác, neo khác, thiếu proposalId, appliedEditVersion sai, người duyệt giả", async () => {
    await seed(PID);
    const a1 = as("a1");
    // Thêm người KHÁC (PID2) nhưng đánh dấu đề xuất PID.
    await seed(PID2, { newId: PID2 });
    const otherPerson = await planApprove(a1, PID2, "a1");
    await assertFails(commitApprove(a1, { ...otherPerson, id: PID }));
    // Sự kiện khác: lô thêm vợ/chồng mới (đúng PID) cho đề xuất thêm con.
    const spouseOp: AddOp = { type: "addSpouse", personId: "a", order: null, spouse: { kind: "new", newId: PID, category: "SPOUSE", person: { name: "X", sex: null, birthYear: null, deathYear: null, note: "" } } };
    await assertFails(commitApprove(a1, await planApprove(a1, PID, "a1", spouseOp)));
    // Neo khác: con của b thay vì a.
    const wrongAnchor: AddOp = { type: "addChild", newId: PID, fatherId: "b", motherId: null, adoptive: false, category: "CLAN", branch: "c1", child: { name: "X", sex: null, birthYear: null, deathYear: null, note: "" } };
    await assertFails(commitApprove(a1, await planApprove(a1, PID, "a1", wrongAnchor)));
    // Nhật ký thiếu proposalId.
    await assertFails(commitApprove(a1, await planApprove(a1, PID, "a1", undefined, null)));
    const good = await planApprove(a1, PID, "a1");
    await assertFails(commitApprove(a1, good, { appliedEditVersion: 7 }));
    await assertFails(commitApprove(a1, good, { decidedBy: "a2" }));
    await assertFails(commitApprove(a1, good, { decisionReason: "" }));
    await assertFails(commitApprove(a1, good, { decisionReason: "x".repeat(501) }));
    await assertFails(commitApprove(a1, good, { status: "REJECTED" }));
    await assertFails(commitApprove(a1, good, { payload: childPayload({ name: "Đổi" }) }));
    await assertFails(commitApprove(a1, good, { anchorId: "b" }));
    await assertFails(commitApprove(a1, good, { kind: "SPOUSE" }));
    // Đúng thì qua.
    await assertSucceeds(commitApprove(a1, good));
  });

  it("đề xuất SPOUSE: neo và union sai bị chặn", async () => {
    await seed(PID, { kind: "SPOUSE", anchorId: "b", payload: spousePayload() });
    const a1 = as("a1");
    const wrongAnchor: AddOp = { type: "addSpouse", personId: "a", order: null, spouse: { kind: "new", newId: PID, category: "SPOUSE", person: { name: "X", sex: null, birthYear: null, deathYear: null, note: "" } } };
    await assertFails(commitApprove(a1, await planApprove(a1, PID, "a1", wrongAnchor)));
    const childOp: AddOp = { type: "addChild", newId: PID, fatherId: "b", motherId: null, adoptive: false, category: "CLAN", branch: null, child: { name: "X", sex: null, birthYear: null, deathYear: null, note: "" } };
    await assertFails(commitApprove(a1, await planApprove(a1, PID, "a1", childOp)));
    await assertSucceeds(commitApprove(a1, await planApprove(a1, PID, "a1")));
  });

  it("duyệt sau khi đã rút bị chặn; duyệt từ NEEDS_INFO được; thành viên thường và admin ngoài sổ không duyệt được", async () => {
    await seed(PID);
    await assertSucceeds(withdrawProposal(as("m1"), PID));
    await assertFails(commitApprove(as("a1"), await planApprove(as("a1"), PID, "a1")));
    await seed(PID2, { newId: PID2, status: "NEEDS_INFO" });
    await assertFails(commitApprove(as("m1"), await planApprove(as("a1"), PID2, "m1")));
    await assertFails(commitApprove(as("half"), await planApprove(as("a1"), PID2, "half")));
    await assertSucceeds(commitApproveProposal(as("a2"), { proposalId: PID2, expectedVersion: 0, actorUid: "a2" }));
    expect((await readRaw("memberProposals", PID2))?.status).toBe("APPROVED");
  });

  it("phát lại cùng phiên bản và người đã tồn tại bị chặn", async () => {
    await seed(PID);
    await seed(PID2, { newId: PID2 });
    const a1 = as("a1");
    const first = await planApprove(a1, PID, "a1");
    const second = await planApprove(a1, PID2, "a1");
    await assertSucceeds(commitApprove(a1, first));
    await assertFails(commitApprove(a1, second));
  });

  it("đề xuất có mã trùng người đã tồn tại không duyệt được (cô lập điều kiện !exists(persons))", async () => {
    await seed(PID);
    const a1 = as("a1");
    const valid = await planApprove(a1, PID, "a1"); // lô hợp lệ ở editVersion 0, dựng trước khi người xuất hiện
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "persons", PID), { displayName: "có sẵn", normalizedName: "co san", sex: null, category: "SPOUSE", profileVersion: 1 });
    });
    await assertFails(commitApprove(a1, valid));
    expect((await readRaw("memberProposals", PID))?.status).toBe("PENDING");
    // Đối chứng: không có người trùng thì chính lô đó hợp lệ.
    await env.withSecurityRulesDisabled(async (c) => {
      await deleteDoc(doc(c.firestore(), "persons", PID));
    });
    await assertSucceeds(commitApprove(a1, valid));
  });
});

describe("tấn công trực tiếp bằng SDK", () => {
  it("setDoc đè lên đề xuất đang chờ của người khác, xóa throttle bị chặn", async () => {
    await seed(PID);
    await assertFails(setDoc(doc(as("m2"), "memberProposals", PID), raw("m2", { newId: PID })));
    await assertFails(setDoc(doc(as("m1"), "memberProposals", PID), raw("m1", { newId: PID, payload: childPayload({ name: "Sửa" }) })));
    await resetThrottle("m1");
    await assertFails(deleteDoc(doc(as("m1"), "proposalThrottle", "m1")));
    await assertFails(setDoc(doc(as("m2"), "proposalThrottle", "m1"), { lastAt: serverTimestamp(), lastProposalId: PID, schemaVersion: 1 }));
  });
  it("kiểu dữ liệu và ký tự bị chặn: năm số thực, payload không phải map, source rỗng, ký tự ẩn", async () => {
    const db = as("m1");
    const ch = String.fromCharCode;
    const bad: Array<Record<string, unknown>> = [
      { payload: childPayload({ birthYear: 1960.5 }) },
      { payload: childPayload({ birthYear: "1960" }) },
      { payload: [1, 2] },
      { payload: null },
      { source: "" },
      { source: "ok" + ch(0x202e) + "x" },
      { payload: childPayload({ name: "Nguyễn" + ch(0x200b) + "A" }) },
      { payload: childPayload({ name: "Nguyễn" + ch(0x85) + "A" }) },
      { payload: childPayload({ name: ch(0x2066) + "A" }) },
      { payload: childPayload({ note: "ghi" + ch(0x200f) + "chú" }) },
      { payload: childPayload({ note: "ghi" + ch(0x9f) + "chú" }) },
    ];
    for (const over of bad) {
      await resetThrottle("m1");
      await assertFails(rawSubmit(db, "m1", over));
    }
    // Đối chứng: tiếng Việt có dấu và xuống dòng vẫn qua.
    await resetThrottle("m1");
    await assertSucceeds(rawSubmit(db, "m1", { payload: childPayload({ name: "Nguyễn Thị Ánh", note: "dòng 1\ndòng 2" }) }));
  });
});
