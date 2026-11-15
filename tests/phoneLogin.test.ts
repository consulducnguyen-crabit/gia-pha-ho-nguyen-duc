import { describe, expect, it } from "vitest";
import {
  emailToPhone,
  loginInputToEmail,
  normalizeVnPhone,
  phoneToEmail,
} from "../src/phoneLogin";

describe("normalizeVnPhone", () => {
  it("giữ số 10 chữ số hợp lệ", () => {
    expect(normalizeVnPhone("0914222987")).toBe("0914222987");
  });
  it("số 11 chữ số cũng hợp lệ (giữ nguyên, kể cả định dạng có tiền tố)", () => {
    expect(normalizeVnPhone("01691234567")).toBe("01691234567");
    expect(normalizeVnPhone(" 0169 123 4567 ")).toBe("01691234567");
    expect(normalizeVnPhone("+841691234567")).toBe("01691234567");
    expect(normalizeVnPhone("841691234567")).toBe("01691234567");
    expect(normalizeVnPhone("00841691234567")).toBe("01691234567");
    expect(normalizeVnPhone("0210 3123 456")).toBe("02103123456");
  });
  it("bỏ khoảng trắng, dấu chấm, gạch ngang, ngoặc", () => {
    expect(normalizeVnPhone(" 0914 222 987 ")).toBe("0914222987");
    expect(normalizeVnPhone("0914.222.987")).toBe("0914222987");
    expect(normalizeVnPhone("(091) 4222-987")).toBe("0914222987");
  });
  it("đổi tiền tố +84 / 84 / 0084 về 0", () => {
    expect(normalizeVnPhone("+84914222987")).toBe("0914222987");
    expect(normalizeVnPhone("+84 914 222 987")).toBe("0914222987");
    expect(normalizeVnPhone("84914222987")).toBe("0914222987");
    expect(normalizeVnPhone("0084914222987")).toBe("0914222987");
  });
  it("từ chối số sai độ dài (ngoài 10–11 chữ số), sai tiền tố, chữ cái, rỗng", () => {
    for (const bad of [
      "",
      "091422298", // 9 chữ số
      "091422298712", // 12 chữ số
      "0014222987", // 00 là tiền tố quốc tế
      "09142229a7",
      "abc",
      "+849142229",
      "8491422298",
      "1914222987", // thiếu số 0 đầu
    ])
      expect(normalizeVnPhone(bad)).toBeNull();
  });
  it("10 hoặc 11 chữ số đều hợp lệ, độ dài khác thì sai", () => {
    for (const n of [10, 11])
      expect(normalizeVnPhone("09" + "1".repeat(n - 2))).not.toBeNull();
    for (const n of [9, 12])
      expect(normalizeVnPhone("09" + "1".repeat(n - 2))).toBeNull();
  });
});

describe("phoneToEmail / emailToPhone", () => {
  it("ghép email ngầm gp.nguyenduc", () => {
    expect(phoneToEmail("0914 222 987")).toBe("0914222987@gp.nguyenduc");
    expect(phoneToEmail("+84914222987")).toBe("0914222987@gp.nguyenduc");
    expect(phoneToEmail("0169 123 4567")).toBe("01691234567@gp.nguyenduc");
  });
  it("trả null khi số không hợp lệ", () => {
    expect(phoneToEmail("123")).toBeNull();
  });
  it("đổi ngược chỉ với email ngầm hợp lệ", () => {
    expect(emailToPhone("0914222987@gp.nguyenduc")).toBe("0914222987");
    expect(emailToPhone("01691234567@gp.nguyenduc")).toBe("01691234567");
    expect(emailToPhone("091422298@gp.nguyenduc")).toBeNull();
    expect(emailToPhone("091422298712@gp.nguyenduc")).toBeNull();
    expect(emailToPhone("0914222987@gmail.com")).toBeNull();
    expect(emailToPhone("abc@gp.nguyenduc")).toBeNull();
  });
});

describe("loginInputToEmail", () => {
  it("số điện thoại → email ngầm; có @ → email viết thường; sai → null", () => {
    expect(loginInputToEmail("0914 222 987")).toBe("0914222987@gp.nguyenduc");
    expect(loginInputToEmail("0169 123 4567")).toBe("01691234567@gp.nguyenduc");
    expect(loginInputToEmail(" A.B@Example.TEST ")).toBe("a.b@example.test");
    expect(loginInputToEmail("khong hop le")).toBeNull();
    expect(loginInputToEmail("a b@c.d")).toBeNull();
    expect(loginInputToEmail("")).toBeNull();
  });
});
