import { describe, expect, it } from "vitest";
import { EditError } from "../src/editCore";
import {
  buildChanges,
  normalizeNameInput,
  saveErrorMessage,
  syncDupNameFlag,
  type FormValues,
} from "../src/editForm";

const base: FormValues = {
  name: "Nguyễn Văn A",
  birthYear: "1900",
  deathYear: "1970",
  sex: "M",
  branch: "c1",
  note: "ghi chú",
  flags: ["VERIFY", "DUP_NAME"],
  replaceRawDate: false,
};
const change = (over: Partial<FormValues>) =>
  buildChanges(base, { ...base, ...over });

describe("buildChanges", () => {
  it("chỉ gửi trường đã đổi", () => {
    expect(change({ name: "  Nguyễn  Văn An " })).toEqual({
      changes: { name: "Nguyễn Văn An" },
    });
    expect(change({ birthYear: "1901", deathYear: "" })).toEqual({
      changes: { birthYear: 1901, deathYear: null },
    });
    expect(change({ sex: "", branch: "" })).toEqual({
      changes: { sex: null, branch: null },
    });
  });
  it("gỡ và thêm cờ theo thứ tự cố định", () => {
    expect(change({ flags: ["VERIFY", "NAME_UNKNOWN"] })).toEqual({
      changes: { addFlags: ["NAME_UNKNOWN"], removeFlags: ["DUP_NAME"] },
    });
  });
  it("báo lỗi gần trường, giữ nguyên dữ liệu nhập", () => {
    expect(change({ name: " " })).toEqual({ errors: { name: "Nhập họ tên." } });
    const r = change({ birthYear: "abc", deathYear: "99" });
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual([
      "birthYear",
      "deathYear",
    ]);
    expect(change({ birthYear: "1980" })).toMatchObject({
      errors: { deathYear: "Năm mất không được trước năm sinh." },
    });
    expect(change({ note: "x".repeat(2001) })).toHaveProperty("errors.note");
  });
  it("xóa một năm thì kiểm tra thứ tự dùng giá trị mới, không phải giá trị cũ", () => {
    expect(change({ birthYear: "1980", deathYear: "" })).toEqual({
      changes: { birthYear: 1980, deathYear: null },
    });
    expect(change({ birthYear: "", deathYear: "1890" })).toEqual({
      changes: { birthYear: null, deathYear: 1890 },
    });
  });
  it("chỉ đổi giới tính hoặc chi; tên gốc chưa chuẩn hóa không tạo thay đổi giả", () => {
    expect(change({ sex: "F" })).toEqual({ changes: { sex: "F" } });
    expect(change({ branch: "c2" })).toEqual({ changes: { branch: "c2" } });
    const initial = { ...base, name: normalizeNameInput("Nguyễn  Văn A") };
    expect(buildChanges(initial, { ...initial, note: "mới" })).toEqual({
      changes: { note: "mới" },
    });
  });
  it("ghi chú rỗng thay cho ghi chú cũ là thay đổi", () => {
    expect(change({ note: "   " })).toEqual({ changes: { note: "" } });
  });
  it("không có thay đổi thì không cho lưu", () => {
    expect(change({})).toHaveProperty("errors.form");
    expect(change({ note: "  ghi chú " })).toHaveProperty("errors.form");
  });
  it("replaceRawDate đi kèm thay đổi thật nhưng không tự là thay đổi", () => {
    expect(change({ replaceRawDate: true })).toHaveProperty("errors");
    expect(change({ deathYear: "1971", replaceRawDate: true })).toEqual({
      changes: { deathYear: 1971, replaceRawDate: true },
    });
  });
});

describe("saveErrorMessage", () => {
  it("dịch lỗi sang tiếng Việt", () => {
    expect(saveErrorMessage(new EditError("VERSION_CONFLICT", "x"))).toMatch(
      /tải lại/i,
    );
    expect(saveErrorMessage({ code: "permission-denied" })).toMatch(/quyền/);
    expect(saveErrorMessage({ code: "unavailable" })).toMatch(/kết nối/);
    expect(saveErrorMessage({ code: "aborted" })).toMatch(/tải lại/i);
    expect(saveErrorMessage({ code: "failed-precondition" })).toMatch(
      /tải lại/i,
    );
    expect(
      saveErrorMessage(new EditError("INVALID", "Giới tính mới mâu thuẫn")),
    ).toBe("Giới tính mới mâu thuẫn");
    expect(saveErrorMessage(new Error("boom"))).toMatch(/Không lưu được/);
  });
});

describe("syncDupNameFlag", () => {
  const noFlag: FormValues = { ...base, flags: ["VERIFY"] };
  it("gắn cờ khi đổi sang tên trùng", () => {
    const r = syncDupNameFlag(
      base.name,
      { ...noFlag, name: "Nguyễn Văn B" },
      1,
    );
    expect(r.flags).toEqual(["VERIFY", "DUP_NAME"]);
  });
  it("gỡ cờ khi tên mới không còn trùng", () => {
    const r = syncDupNameFlag(base.name, { ...base, name: "Nguyễn Văn C" }, 0);
    expect(r.flags).toEqual(["VERIFY"]);
  });
  it("không đụng tới cờ khi tên không đổi", () => {
    expect(syncDupNameFlag(base.name, noFlag, 2)).toBe(noFlag);
    expect(syncDupNameFlag(base.name, { ...base }, 0).flags).toEqual(
      base.flags,
    );
  });
  it("không đổi gì khi đã đúng trạng thái", () => {
    const v = { ...base, name: "Nguyễn Văn B" };
    expect(syncDupNameFlag(base.name, v, 1)).toBe(v);
  });
});
