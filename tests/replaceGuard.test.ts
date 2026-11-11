import { describe, expect, it } from "vitest";
import { EDIT_EVENTS, evaluateReplace } from "../scripts/gia-pha/replace-guard";

describe("chặn --replace sau khi có sửa trong app", () => {
  it("chưa có sửa: cho phép mọi nơi", () => {
    for (const kind of ["emulator", "dev", "prod"] as const)
      expect(
        evaluateReplace({ kind, editVersion: 0, discardAppEdits: false }).ok,
      ).toBe(true);
  });
  it("prod có sửa: luôn cấm, kể cả --discard-app-edits", () => {
    for (const discardAppEdits of [false, true])
      expect(
        evaluateReplace({ kind: "prod", editVersion: 3, discardAppEdits }).ok,
      ).toBe(false);
  });
  it("dev/emulator có sửa: cần --discard-app-edits", () => {
    expect(
      evaluateReplace({ kind: "dev", editVersion: 3, discardAppEdits: false })
        .ok,
    ).toBe(false);
    expect(
      evaluateReplace({ kind: "dev", editVersion: 3, discardAppEdits: true })
        .ok,
    ).toBe(true);
  });
  it("danh sách sự kiện gồm cả ẩn/khôi phục", () => {
    expect(EDIT_EVENTS).toContain("PERSON_DELETED");
    expect(EDIT_EVENTS).toContain("PERSON_RESTORED");
  });
});
