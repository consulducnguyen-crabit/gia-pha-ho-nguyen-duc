import { describe, expect, it } from "vitest";
import { applyEdit, EditError, type EditState } from "../src/editCore";

function state(over: Partial<EditState> = {}): EditState {
  const data = {
    v: 1,
    persons: {
      a: ["Nguyễn Văn A", 1900, 1970, 1, "C", "c1", ["VERIFY", "DUP_NAME"]],
      b: ["Nguyễn Văn B", null, null, 2, "C", null, []],
    },
    relations: [["a", "b", "F", "B", 1]],
    unions: [],
    branches: { c1: ["Chi 1", "a", null, null] },
  };
  return {
    snapshot: {
      schemaVersion: 1,
      dataVersion: "batch-1",
      data: JSON.stringify(data),
    },
    person: { displayName: "Nguyễn Văn A", sex: "M", profileVersion: 1 },
    profile: {
      displayName: "Nguyễn Văn A",
      normalizedName: "nguyen van a",
      profileVersion: 1,
      schemaVersion: 1,
      birthYear: 1900,
      deathYear: 1970,
    },
    priv: { note: "ghi chú cũ" },
    ...over,
  };
}
function run(changes: object, s = state(), expectedVersion = 0, id = "a") {
  return applyEdit(s, {
    op: { type: "updatePerson", personId: id, changes },
    expectedVersion,
    actorUid: "admin",
  });
}
const byPath = (r: ReturnType<typeof run>) =>
  Object.fromEntries(r.writes.map((w) => [w.path, w]));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof EditError) return e.code;
    throw e;
  }
  return "OK";
};

describe("applyEdit", () => {
  it("đổi tên: cập nhật đồng bộ persons, memberProfiles, ảnh chụp và nhật ký", () => {
    const r = run({ name: "  Nguyễn  Văn  An " });
    const w = byPath(r);
    expect(r.nextVersion).toBe(1);
    expect(w["persons/a"].data).toMatchObject({
      displayName: "Nguyễn Văn An",
      normalizedName: "nguyen van an",
      profileVersion: 2,
    });
    expect(w["memberProfiles/a"].data).toMatchObject({
      displayName: "Nguyễn Văn An",
      profileVersion: 2,
      birthYear: 1900,
      deathYear: 1970,
    });
    const snap = JSON.parse(w["treeSnapshots/main"].data.data as string);
    expect(snap.persons.a[0]).toBe("Nguyễn Văn An");
    expect(snap.persons.b).toEqual([
      "Nguyễn Văn B",
      null,
      null,
      2,
      "C",
      null,
      [],
    ]);
    expect(snap.relations).toHaveLength(1);
    expect(w["treeSnapshots/main"].data.editVersion).toBe(1);
    expect(w["auditLogs/edit-1"]).toMatchObject({
      mode: "create",
      data: {
        event: "PERSON_EDITED",
        actorUid: "admin",
        target: "persons/a",
        editVersion: 1,
        fields: ["name"],
        before: { name: "Nguyễn Văn A" },
        after: { name: "Nguyễn Văn An" },
      },
    });
    expect(w["personPrivate/a"]).toBeUndefined();
  });

  it("đổi năm: bỏ năm mất thì memberProfiles không còn deathYear", () => {
    const w = byPath(run({ birthYear: 1901, deathYear: null }));
    expect(w["memberProfiles/a"].data.birthYear).toBe(1901);
    expect("deathYear" in w["memberProfiles/a"].data).toBe(false);
    expect(w["persons/a"].data.death).toBeNull();
    expect(w["persons/a"].data.birth).toMatchObject({
      year: 1901,
      precision: "YEAR",
    });
  });

  it("ghi chú ghi vào personPrivate, kể cả khi chưa có tài liệu", () => {
    const w = byPath(run({ note: " mới " }, state({ priv: null })));
    expect(w["personPrivate/a"].data).toMatchObject({ note: "mới" });
  });

  it("gỡ cờ (đã xác minh) và thêm cờ, giữ thứ tự cố định", () => {
    const w = byPath(
      run({ removeFlags: ["DUP_NAME"], addFlags: ["NAME_UNKNOWN"] }),
    );
    const snap = JSON.parse(w["treeSnapshots/main"].data.data as string);
    expect(snap.persons.a[6]).toEqual(["VERIFY", "NAME_UNKNOWN"]);
    expect(w["persons/a"].data.reviewFlags).toEqual(["VERIFY", "NAME_UNKNOWN"]);
  });

  it("chi phải tồn tại; giới tính chỉ M/F/null", () => {
    expect(code(() => run({ branch: "zzz" }))).toBe("INVALID");
    expect(run({ branch: null }).changedFields).toEqual(["branch"]);
    expect(code(() => run({ sex: "X" as "M" }))).toBe("INVALID");
    // a là cha của b: không được đổi thành nữ (mâu thuẫn phả hệ); b không có con nên được.
    expect(code(() => run({ sex: "F" }))).toBe("INVALID");
    expect(run({ sex: "F" }, state(), 0, "b").changedFields).toEqual(["sex"]);
    expect(run({ sex: null }).changedFields).toEqual(["sex"]);
  });

  it("từ chối đầu vào xấu", () => {
    expect(code(() => run({ name: "   " }))).toBe("INVALID");
    expect(code(() => run({ name: "a".repeat(121) }))).toBe("INVALID");
    expect(code(() => run({ name: "A\u0000B" }))).toBe("INVALID");
    expect(code(() => run({ birthYear: 99 }))).toBe("INVALID");
    expect(code(() => run({ birthYear: 1900.5 }))).toBe("INVALID");
    expect(code(() => run({ deathYear: 1800 }))).toBe("INVALID");
    expect(code(() => run({ note: "x".repeat(2001) }))).toBe("INVALID");
    expect(code(() => run({ addFlags: ["NOPE"] }))).toBe("INVALID");
    expect(
      code(() => run({ addFlags: ["VERIFY"], removeFlags: ["VERIFY"] })),
    ).toBe("INVALID");
    expect(code(() => run({ role: "admin" }))).toBe("INVALID");
    expect(code(() => run({ name: "x" }, state(), 0, "../x"))).toBe("INVALID");
  });

  it("không thay đổi gì thì báo NO_CHANGE", () => {
    expect(code(() => run({ name: "Nguyễn Văn A", birthYear: 1900 }))).toBe(
      "NO_CHANGE",
    );
    expect(code(() => run({}))).toBe("NO_CHANGE");
  });

  it("khóa phiên bản: lệch thì từ chối, và phiên bản tăng đúng một", () => {
    const s = state();
    s.snapshot.editVersion = 4;
    expect(code(() => run({ name: "X" }, s, 3))).toBe("VERSION_CONFLICT");
    expect(code(() => run({ name: "X" }, s, 0))).toBe("VERSION_CONFLICT");
    expect(run({ name: "X" }, s, 4).nextVersion).toBe(5);
    s.snapshot.editVersion = -1;
    expect(code(() => run({ name: "X" }, s, -1))).toBe("BAD_STATE");
  });

  it("người không có trong cây hoặc thiếu hồ sơ", () => {
    expect(code(() => run({ name: "X" }, state(), 0, "zzz"))).toBe("NOT_FOUND");
    expect(code(() => run({ name: "X" }, state({ profile: null })))).toBe(
      "NOT_FOUND",
    );
  });

  it("giữ tháng/ngày của ngày gốc khi đổi năm; nhật ký giữ nguyên ngày cũ", () => {
    const s = state();
    s.person!.birth = {
      calendar: "SOLAR",
      year: 1900,
      month: 3,
      day: 12,
      precision: "DAY",
      approximate: false,
      originalText: "12/3/1900",
    };
    const w = byPath(run({ birthYear: 1901 }, s));
    expect(w["persons/a"].data.birth).toMatchObject({
      year: 1901,
      month: 3,
      day: 12,
      precision: "DAY",
      originalText: "12/3/1901",
    });
    expect(w["auditLogs/edit-1"].data.before).toMatchObject({
      birth: { originalText: "12/3/1900" },
    });
  });

  it("ngày gốc không rõ/mâu thuẫn chỉ bị thay khi có xác nhận", () => {
    const s = state();
    s.person!.death = {
      calendar: "SOLAR",
      year: null,
      precision: "UNKNOWN",
      originalText: "1970 hoặc 1972",
    };
    expect(code(() => run({ deathYear: 1971 }, s))).toBe("INVALID");
    const w = byPath(run({ deathYear: 1971, replaceRawDate: true }, s));
    expect(w["persons/a"].data.death).toMatchObject({
      year: 1971,
      precision: "YEAR",
    });
    expect(w["auditLogs/edit-1"].data.before).toMatchObject({
      death: { originalText: "1970 hoặc 1972" },
    });
  });

  it("chi không nhận khóa kế thừa từ prototype hay giá trị không phải chuỗi", () => {
    for (const branch of ["toString", "constructor", "__proto__", 5])
      expect(code(() => run({ branch: branch as string }))).toBe("INVALID");
  });

  it("chuẩn hóa NFC cho tên; nhật ký không chứa nguyên văn ghi chú; đổi giới tính ghi sexBasis", () => {
    const nfd = "Nguyễn Văn An".normalize("NFD");
    const r = run({ name: nfd, note: "bí mật", sex: null });
    const w = byPath(r);
    expect(w["persons/a"].data.displayName).toBe("Nguyễn Văn An");
    expect(w["persons/a"].data.sexBasis).toBe("MANUAL");
    const audit = JSON.stringify(w["auditLogs/edit-1"].data);
    expect(audit).not.toContain("bí mật");
    expect(audit).not.toContain("ghi chú cũ");
    expect(w["auditLogs/edit-1"].data.after).toMatchObject({
      note: { chars: 6 },
    });
    expect(w["auditLogs/edit-1"].data.personId).toBe("a");
  });

  it("thiếu profileVersion thì báo BAD_STATE", () => {
    const s = state();
    delete s.profile!.profileVersion;
    expect(code(() => run({ name: "X" }, s))).toBe("BAD_STATE");
  });

  it("không sửa trạng thái đầu vào", () => {
    const s = state();
    const before = JSON.stringify(s);
    run({ name: "X" }, s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("exceedsSnapshotLimit", () => {
  it("đúng ngưỡng 850000 byte", async () => {
    const { SNAPSHOT_MAX_BYTES, exceedsSnapshotLimit } =
      await import("../src/editCore");
    expect(SNAPSHOT_MAX_BYTES).toBe(850000);
    expect(exceedsSnapshotLimit("a".repeat(850000))).toBe(false);
    expect(exceedsSnapshotLimit("a".repeat(850001))).toBe(true);
  });
  it("đếm theo byte UTF-8, không theo ký tự", async () => {
    const { exceedsSnapshotLimit } = await import("../src/editCore");
    // "ệ" = 3 byte: 283334 ký tự = 850002 byte nhưng chỉ ~283k ký tự.
    expect(exceedsSnapshotLimit("ệ".repeat(283333))).toBe(false);
    expect(exceedsSnapshotLimit("ệ".repeat(283334))).toBe(true);
  });
});

describe("giới tính trong ảnh chụp", () => {
  const tupleOf = (r: ReturnType<typeof run>, id = "a") =>
    JSON.parse(byPath(r)["treeSnapshots/main"].data.data as string).persons[id];
  it("đổi giới tính ghi phần tử thứ 8; sửa trường khác cũng đồng bộ theo persons.sex", () => {
    // "b" là con (không giữ vai cha/mẹ) nên đổi giới tính không vướng kiểm tra mâu thuẫn quan hệ.
    expect(tupleOf(run({ sex: "F" }, state(), 0, "b"), "b")[7]).toBe("F");
    expect(tupleOf(run({ sex: null }, state(), 0, "b"), "b")[7]).toBeNull();
    // fixture persons.a.sex = "M"
    expect(tupleOf(run({ name: "Tên Mới" }))[7]).toBe("M");
  });
  it("bộ 6 phần tử được nâng lên 9, không tạo mảng thưa", () => {
    const s = state();
    const d = JSON.parse(s.snapshot.data as string);
    d.persons.b = d.persons.b.slice(0, 6);
    s.snapshot.data = JSON.stringify(d);
    const t = tupleOf(run({ sex: "F" }, s, 0, "b"), "b");
    expect(t).toHaveLength(9);
    expect(t[6]).toEqual([]);
    expect(t[7]).toBe("F");
    expect(t[8]).toBe(false);
  });
  it("người khác giữ nguyên bộ dữ liệu của họ", () => {
    const s = state();
    const d = JSON.parse(s.snapshot.data as string);
    d.persons.b.push("F");
    s.snapshot.data = JSON.stringify(d);
    expect(tupleOf(run({ name: "Tên Mới" }, s), "b")).toEqual(d.persons.b);
  });
});

describe("Đã mất", () => {
  const tupleOf = (r: ReturnType<typeof run>, id = "a") =>
    JSON.parse(byPath(r)["treeSnapshots/main"].data.data as string).persons[id];
  it("bật: ghi persons.deceased, phần tử thứ 9 và nhật ký", () => {
    const r = run({ deceased: true }, state(), 0, "b");
    const w = byPath(r);
    expect(r.changedFields).toEqual(["deceased"]);
    expect(w["persons/b"].data.deceased).toBe(true);
    expect(tupleOf(r, "b")[8]).toBe(true);
    expect(w["auditLogs/edit-1"].data).toMatchObject({
      fields: ["deceased"],
      before: { deceased: false },
      after: { deceased: true },
    });
  });
  it("không đổi (false → false) là NO_CHANGE; kiểu sai bị từ chối", () => {
    expect(code(() => run({ deceased: false }))).toBe("NO_CHANGE");
    expect(code(() => run({ deceased: "true" as unknown as boolean }))).toBe(
      "INVALID",
    );
  });
  it("sửa trường khác đồng bộ phần tử 9 theo persons.deceased, giữ giới tính", () => {
    const s = state({
      person: { displayName: "A", sex: "M", profileVersion: 1, deceased: true },
    });
    const t = tupleOf(run({ name: "Tên Mới" }, s));
    expect(t[7]).toBe("M");
    expect(t[8]).toBe(true);
  });
  it("tắt: false được ghi, bộ 6 phần tử được nâng lên 9", () => {
    const s = state({
      person: {
        displayName: "B",
        sex: null,
        profileVersion: 1,
        deceased: true,
      },
    });
    const d = JSON.parse(s.snapshot.data as string);
    d.persons.b = d.persons.b.slice(0, 6);
    s.snapshot.data = JSON.stringify(d);
    const r = run({ deceased: false }, s, 0, "b");
    const t = tupleOf(r, "b");
    expect(t).toHaveLength(9);
    expect(t[8]).toBe(false);
    expect(byPath(r)["persons/b"].data.deceased).toBe(false);
  });
});
