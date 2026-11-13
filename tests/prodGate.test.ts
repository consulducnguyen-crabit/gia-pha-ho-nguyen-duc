import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideTarget } from "../scripts/gia-pha/import-plan";
import {
  BACKUP_MAX_AGE_MINUTES,
  PROD_PROJECT,
  ackPhrase,
  evaluateProdGate,
  type GateInput,
} from "../scripts/gia-pha/prod-gate";

const now = new Date("2026-11-11T10:00:00.000Z");
const minutesAgo = (m: number) =>
  new Date(now.getTime() - m * 60000).toISOString();
const good = (): GateInput => ({
  action: "NAP DU LIEU THAT",
  project: PROD_PROJECT,
  confirm: PROD_PROJECT,
  ack: ackPhrase("NAP DU LIEU THAT", PROD_PROJECT),
  needsBackup: true,
  backup: {
    project: PROD_PROJECT,
    createdAt: minutesAgo(5),
    verified: true,
    matchesLive: true,
  },
  now,
});

describe("cổng ghi production", () => {
  it("hằng số project prod khớp .firebaserc", () => {
    const rc = JSON.parse(readFileSync(".firebaserc", "utf8"));
    expect(rc.projects.prod).toBe(PROD_PROJECT);
  });
  it("đạt khi đủ xác nhận và sao lưu mới, đã kiểm chứng, khớp hiện tại", () => {
    expect(evaluateProdGate(good())).toEqual({ ok: true, reasons: [] });
  });
  it("từ chối project khác, thiếu confirm hoặc sai câu xác nhận", () => {
    expect(
      evaluateProdGate({ ...good(), project: "gia-pha-nguyen-duc-dev" }).ok,
    ).toBe(false);
    expect(
      evaluateProdGate({ ...good(), confirm: undefined }).reasons.join(),
    ).toMatch(/--confirm/);
    expect(
      evaluateProdGate({ ...good(), ack: "toi dong y" }).reasons.join(),
    ).toMatch(/câu xác nhận/);
    expect(
      evaluateProdGate({ ...good(), ack: ackPhrase("KHOI PHUC", PROD_PROJECT) })
        .ok,
    ).toBe(false);
  });
  it("từ chối khi thiếu, cũ, sai project, chưa verify hoặc không khớp bản sao lưu", () => {
    expect(
      evaluateProdGate({ ...good(), backup: undefined }).reasons.join(),
    ).toMatch(/Thiếu bản sao lưu/);
    const stale = {
      ...good().backup!,
      createdAt: minutesAgo(BACKUP_MAX_AGE_MINUTES + 5),
    };
    expect(
      evaluateProdGate({ ...good(), backup: stale }).reasons.join(),
    ).toMatch(/đã cũ/);
    expect(
      evaluateProdGate({
        ...good(),
        backup: { ...good().backup!, project: "gia-pha-nguyen-duc-dev" },
      }).reasons.join(),
    ).toMatch(/project khác/);
    expect(
      evaluateProdGate({
        ...good(),
        backup: { ...good().backup!, verified: false },
      }).reasons.join(),
    ).toMatch(/verify/);
    expect(
      evaluateProdGate({
        ...good(),
        backup: { ...good().backup!, matchesLive: false },
      }).reasons.join(),
    ).toMatch(/không khớp/);
    expect(
      evaluateProdGate({
        ...good(),
        backup: { ...good().backup!, createdAt: "rac" },
      }).ok,
    ).toBe(false);
    expect(
      evaluateProdGate({
        ...good(),
        backup: { ...good().backup!, createdAt: minutesAgo(-30) },
      }).reasons.join(),
    ).toMatch(/tương lai/);
  });
  it("quản lý tài khoản không cần sao lưu nhưng vẫn cần xác nhận", () => {
    const input: GateInput = {
      action: "QUAN LY TAI KHOAN",
      project: PROD_PROJECT,
      confirm: PROD_PROJECT,
      ack: ackPhrase("QUAN LY TAI KHOAN", PROD_PROJECT),
      needsBackup: false,
      now,
    };
    expect(evaluateProdGate(input).ok).toBe(true);
    expect(evaluateProdGate({ ...input, ack: undefined }).ok).toBe(false);
  });
  it("xóa hẳn tài khoản dùng câu xác nhận riêng, không nhận câu của quản lý tài khoản", () => {
    const input: GateInput = {
      action: "XOA TAI KHOAN",
      project: PROD_PROJECT,
      confirm: PROD_PROJECT,
      ack: ackPhrase("XOA TAI KHOAN", PROD_PROJECT),
      needsBackup: false,
      now,
    };
    expect(evaluateProdGate(input).ok).toBe(true);
    expect(
      evaluateProdGate({
        ...input,
        ack: ackPhrase("QUAN LY TAI KHOAN", PROD_PROJECT),
      }).ok,
    ).toBe(false);
  });
});

describe("chọn đích có cho phép prod", () => {
  const env = { GOOGLE_APPLICATION_CREDENTIALS: "x" };
  it("prod chỉ được chọn khi bật allowProd, đúng tên và có khóa", () => {
    expect(decideTarget(env, PROD_PROJECT)).toMatchObject({ ok: false });
    expect(decideTarget(env, PROD_PROJECT, { allowProd: true })).toMatchObject({
      ok: true,
      kind: "prod",
    });
    expect(decideTarget({}, PROD_PROJECT, { allowProd: true })).toMatchObject({
      ok: false,
    });
    expect(
      decideTarget(env, "project-prod-khac", { allowProd: true }),
    ).toMatchObject({ ok: false });
    expect(
      decideTarget(env, "gia-pha-nguyen-duc-dev", { allowProd: true }),
    ).toMatchObject({ ok: true, kind: "dev" });
  });
  it("emulator luôn thắng và không bao giờ là prod", () => {
    expect(
      decideTarget(
        { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
        PROD_PROJECT,
        { allowProd: true },
      ),
    ).toMatchObject({ ok: true, kind: "emulator" });
  });
});
