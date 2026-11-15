import { describe, expect, it } from "vitest";
import {
  buildCommandGroups,
  PROD_PROJECT,
  psArg,
} from "../src/accountCommands";

const group = (id: string, emails: string[], prod = false) =>
  buildCommandGroups(emails, prod).find((g) => g.id === id)!;

describe("lệnh quản lý tài khoản", () => {
  it("chưa tick: dùng email mẫu, mỗi nhóm một dòng", () => {
    expect(group("revoke", []).lines).toEqual([
      "npm run gia-pha:accounts -- revoke --email ten@gmail.com --apply",
    ]);
    expect(group("reset", []).lines[0]).toContain("0914222987@gp.nguyenduc");
  });
  it("có tick: mỗi tài khoản một dòng, giữ thứ tự và bỏ trùng", () => {
    const lines = group("revoke", [
      "b@x.vn",
      "a@gmail.com",
      "b@x.vn",
      " ",
    ]).lines;
    expect(lines).toEqual([
      "npm run gia-pha:accounts -- revoke --email b@x.vn --apply",
      "npm run gia-pha:accounts -- revoke --email a@gmail.com --apply",
    ]);
  });
  it("tài khoản điện thoại dùng email ngầm", () => {
    expect(group("reset", ["0914222987@gp.nguyenduc"]).lines).toEqual([
      "npm run gia-pha:accounts -- reset-password --email 0914222987@gp.nguyenduc --apply",
    ]);
  });
  it("xóa hẳn: chạy thử không có --apply; thực hiện kèm --confirm-delete đúng email", () => {
    expect(group("delete-plan", ["a@x.vn"]).lines).toEqual([
      "npm run gia-pha:accounts -- delete --email a@x.vn",
    ]);
    expect(group("delete-apply", ["a@x.vn"]).lines).toEqual([
      "npm run gia-pha:accounts -- delete --email a@x.vn --apply --confirm-delete a@x.vn",
    ]);
  });
  it("nhóm không theo tài khoản giữ nguyên dù có tick", () => {
    expect(group("create", ["a@x.vn"]).lines[0]).toContain("ten@example.com");
    expect(group("list", ["a@x.vn"]).lines).toEqual([
      "npm run gia-pha:accounts -- list",
    ]);
    expect(group("registry", ["a@x.vn"]).lines).toEqual([
      "npm run gia-pha:accounts -- registry --verify",
      "npm run gia-pha:accounts -- registry --rebuild --apply",
    ]);
  });
  it("production: lệnh ghi có project + confirm + ack, lệnh xóa dùng câu XOA, lệnh đọc chỉ có project", () => {
    const p = PROD_PROJECT;
    expect(group("revoke", ["a@x.vn"], true).lines[0]).toBe(
      `npm run gia-pha:accounts -- revoke --email a@x.vn --apply --project ${p} --confirm ${p} --ack "QUAN LY TAI KHOAN ${p}"`,
    );
    expect(group("delete-apply", ["a@x.vn"], true).lines[0]).toContain(
      `--ack "XOA TAI KHOAN ${p}"`,
    );
    expect(group("delete-plan", ["a@x.vn"], true).lines[0]).toBe(
      `npm run gia-pha:accounts -- delete --email a@x.vn --project ${p}`,
    );
    expect(group("list", [], true).lines[0]).toBe(
      `npm run gia-pha:accounts -- list --project ${p}`,
    );
  });
  it("psArg bọc nháy đơn khi email có ký tự lạ (không chèn được lệnh khác)", () => {
    expect(psArg("a.b+c@gmail.com")).toBe("a.b+c@gmail.com");
    expect(psArg("x; calc")).toBe("'x; calc'");
    expect(psArg("it's@x.vn")).toBe("'it''s@x.vn'");
    expect(psArg("$(id)@x.vn")).toBe("'$(id)@x.vn'");
  });
});
