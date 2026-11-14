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
  it("từ chối số sai độ dài, sai đầu số, chữ cái, rỗng", () => {
    for (const bad of [
      "",
      "091422298",
      "09142229871",
      "0214222987",
      "0114222987",
      "09142229a7",
      "abc",
      "+849142229",
      "8491422298",
    ])
      expect(normalizeVnPhone(bad)).toBeNull();
  });
});

describe("phoneToEmail / emailToPhone", () => {
  it("ghép email ngầm gp.nguyenduc", () => {
    expect(phoneToEmail("0914 222 987")).toBe("0914222987@gp.nguyenduc");
    expect(phoneToEmail("+84914222987")).toBe("0914222987@gp.nguyenduc");
  });
  it("trả null khi số không hợp lệ", () => {
    expect(phoneToEmail("123")).toBeNull();
  });
  it("đổi ngược chỉ với email ngầm hợp lệ", () => {
    expect(emailToPhone("0914222987@gp.nguyenduc")).toBe("0914222987");
    expect(emailToPhone("0914222987@gmail.com")).toBeNull();
    expect(emailToPhone("abc@gp.nguyenduc")).toBeNull();
  });
});

describe("loginInputToEmail", () => {
  it("số điện thoại → email ngầm; có @ → email viết thường; sai → null", () => {
    expect(loginInputToEmail("0914 222 987")).toBe("0914222987@gp.nguyenduc");
    expect(loginInputToEmail(" A.B@Example.TEST ")).toBe("a.b@example.test");
    expect(loginInputToEmail("khong hop le")).toBeNull();
    expect(loginInputToEmail("a b@c.d")).toBeNull();
    expect(loginInputToEmail("")).toBeNull();
  });
});
