import { describe, expect, it } from "vitest";
import { parseDsl } from "../scripts/gia-pha/dsl";
import {
  buildImportPlan,
  decideTarget,
  lunarAnniversary,
  solarDate,
} from "../scripts/gia-pha/import-plan";

// Dữ liệu hoàn toàn giả.
const text = [
  "P|ts|Cụ Giả Thủy Tổ|M|CLAN|I|I|ky=01/9|Ghi chú riêng giả",
  "P|a|Giả Văn A|M|CLAN|II|I|b=1927;d=1973;ky=14/7|",
  "P|b|Giả Thị B|F|CLAN|II|I|b=26/9/1984|",
  "P|va|Vợ Giả A|F|SPOUSE|||b=1954/1955|",
  "K|ts|-|a,b",
  "K|a|va|c",
  "P|c|Giả Văn C|M|CLAN|III|I||",
  "B|I|Chi giả|ts||Ghi chú chi",
].join("\n");

describe("kế hoạch nạp Firestore", () => {
  const model = parseDsl(text);
  const plan = buildImportPlan(model, "import-test");
  const byPath = (path: string) => plan.docs.find((d) => d.path === path)?.data;

  it("tách dữ liệu: thành viên chỉ thấy tên và năm sinh/mất", () => {
    expect(byPath("memberProfiles/a")).toEqual({
      displayName: "Giả Văn A",
      normalizedName: "gia van a",
      profileVersion: 1,
      schemaVersion: 1,
      birthYear: 1927,
      deathYear: 1973,
    });
    const profile = byPath("memberProfiles/ts")!;
    for (const key of ["note", "kyNhat", "sex", "branchCode", "generation"])
      expect(profile).not.toHaveProperty(key);
    expect(byPath("personPrivate/ts")).toMatchObject({
      note: "Ghi chú riêng giả",
    });
    expect(byPath("personPrivate/a")).toBeUndefined();
  });

  it("không đoán năm khi văn bản mâu thuẫn; giữ nguyên bản gốc", () => {
    expect(byPath("memberProfiles/va")).not.toHaveProperty("birthYear");
    expect(byPath("persons/va")?.birth).toMatchObject({
      precision: "UNKNOWN",
      year: null,
      originalText: "1954/1955",
    });
  });

  it("ngày dương, kỵ nhật âm lịch và đời tự tính", () => {
    expect(solarDate("26/9/1984")).toMatchObject({
      precision: "DAY",
      year: 1984,
      month: 9,
      day: 26,
    });
    expect(solarDate("10/1972")).toMatchObject({
      precision: "MONTH",
      month: 10,
      year: 1972,
    });
    expect(lunarAnniversary("14/7")).toMatchObject({
      calendar: "LUNAR",
      day: 14,
      month: 7,
      precision: "DAY",
    });
    expect(lunarAnniversary("03/Giêng")).toMatchObject({ day: 3, month: 1 });
    expect(lunarAnniversary("không nhớ")).toMatchObject({
      precision: "UNKNOWN",
      originalText: "không nhớ",
    });
    expect(byPath("persons/c")).toMatchObject({
      generation: 3,
      declaredGeneration: 3,
      category: "CLAN",
    });
  });

  it("quan hệ khớp mô hình backend và có mã xác định (idempotent)", () => {
    expect(byPath("relations/r-ts-a")).toEqual({
      parentId: "ts",
      childId: "a",
      parentRole: "FATHER",
      relationType: "BIOLOGICAL",
      lineageTransmission: true,
      verificationStatus: "APPROVED",
      version: 1,
      sourceRefs: ["importBatches/import-test"],
      schemaVersion: 1,
      importBatchId: "import-test",
    });
    expect(byPath("relations/r-va-c")).toMatchObject({
      parentRole: "MOTHER",
      lineageTransmission: false,
    });
    expect(buildImportPlan(model, "import-test").docs).toEqual(plan.docs);
    expect(byPath("graphState/parentage")).toEqual({
      version: 1,
      schemaVersion: 1,
    });
    expect(byPath("branches/I")).toMatchObject({
      founderPersonId: "ts",
      status: "ACTIVE",
    });
  });

  it('giới tính ảnh chụp cùng giá trị persons.sex; "?" thành null', () => {
    const m = parseDsl(
      [
        "P|ts|Cụ Giả|M|CLAN|I|I||",
        "P|u|Người Chưa Rõ|?|CLAN|II|I||",
        "K|ts|-|u",
      ].join("\n"),
    );
    const docs = buildImportPlan(m, "b").docs;
    const get = (path: string) => docs.find((d) => d.path === path)!.data;
    const data = JSON.parse(get("treeSnapshots/main").data as string);
    expect(data.persons.u[7]).toBeNull();
    expect(data.persons.ts[7]).toBe("M");
    expect(get("persons/u").sex).toBeNull();
    expect(get("persons/ts").sex).toBe("M");
  });
  it("ảnh chụp cây chứa tên, năm sinh/mất, đời, chi, cờ, giới tính, quan hệ", () => {
    const snap = byPath("treeSnapshots/main") as {
      schemaVersion: number;
      dataVersion: string;
      data: string;
    };
    expect(snap).toMatchObject({
      schemaVersion: 1,
      dataVersion: "import-test",
    });
    const data = JSON.parse(snap.data);
    expect(data.persons.a).toEqual([
      "Giả Văn A",
      1927,
      1973,
      2,
      "C",
      "I",
      [],
      "M",
    ]);
    expect(data.persons.va).toEqual([
      "Vợ Giả A",
      null,
      null,
      null,
      "S",
      null,
      ["BIRTH_CONFLICT"],
      "F",
    ]);
    expect(data.relations).toContainEqual(["ts", "a", "F", "B", 1]);
    expect(data.relations).toContainEqual(["va", "c", "M", "B", 0]);
    expect(snap.data).not.toContain("Ghi chú riêng giả");
    expect(snap.data).not.toContain("14/7");
    expect(snap.data.length).toBeLessThan(1_000_000);
  });

  it("đếm đúng số tài liệu theo collection", () => {
    expect(plan.counts).toMatchObject({
      persons: 5,
      memberProfiles: 5,
      personPrivate: 1,
      relations: 4,
      unions: 1,
      branches: 1,
      graphState: 1,
      treeSnapshots: 1,
    });
  });
});

describe("chọn đích nạp", () => {
  it("chỉ cho emulator loopback hoặc project -dev, cấm production", () => {
    expect(
      decideTarget({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, undefined),
    ).toMatchObject({
      ok: true,
      kind: "emulator",
    });
    expect(
      decideTarget({ FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }, undefined),
    ).toMatchObject({ ok: false });
    expect(
      decideTarget(
        { GOOGLE_APPLICATION_CREDENTIALS: "x" },
        "gia-pha-nguyen-duc-prod",
      ),
    ).toMatchObject({ ok: false });
    expect(
      decideTarget({ GOOGLE_APPLICATION_CREDENTIALS: "x" }, "bat-ky"),
    ).toMatchObject({ ok: false });
    expect(decideTarget({}, "gia-pha-nguyen-duc-dev")).toMatchObject({
      ok: false,
    });
    expect(
      decideTarget(
        { GOOGLE_APPLICATION_CREDENTIALS: "x" },
        "gia-pha-nguyen-duc-dev",
      ),
    ).toMatchObject({
      ok: true,
      kind: "dev",
    });
  });
});
