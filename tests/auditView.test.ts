import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUDIT_EVENTS,
  EVENT_LABELS,
  classifyRead,
  describeAudit,
  formatVnTime,
  lostAccess,
  matchesFilter,
  pageVersions,
  parseDeletedRows,
  shortUid,
  type PersonLookup,
  type ReadOutcome,
} from "../src/auditView";

const people: Record<string, string> = {
  a: "Giả Văn An",
  b: "Giả Thị Bình",
  c: "Giả Văn Cường",
  "p-new": "Người Mới",
};
const lookup: PersonLookup = (id) =>
  Object.hasOwn(people, id) ? { name: people[id] } : null;
const stamp = { toDate: () => new Date("2026-11-10T07:30:00Z") };
const base = (event: string, extra: object) => ({
  event,
  actorUid: "uid_admin_0001",
  personId: "a",
  target: "persons/a",
  editVersion: 5,
  timestamp: stamp,
  schemaVersion: 1,
  fields: [],
  before: {},
  after: {},
  ...extra,
});
const all = (v: ReturnType<typeof describeAudit>) =>
  [...v.summary, ...v.details].join("\n");

describe("danh sách sự kiện", () => {
  it("khớp danh sách trong firestore.rules (allow get và auditCreateOk)", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    const lists = [...rules.matchAll(/event in \[([^\]]+)\]/g)].map((m) =>
      [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort(),
    );
    const full = lists.filter((l) => l.length === AUDIT_EVENTS.length);
    expect(full.length).toBeGreaterThanOrEqual(2);
    for (const l of full) expect(l).toEqual([...AUDIT_EVENTS].sort());
    expect(AUDIT_EVENTS).toHaveLength(12);
    for (const code of AUDIT_EVENTS) expect(EVENT_LABELS[code]).toBeTruthy();
  });
});

describe("describeAudit: 12 sự kiện", () => {
  it("PERSON_EDITED: năm hiện ở tóm tắt, ngày đầy đủ chỉ ở chi tiết, ghi chú chỉ nêu độ dài", () => {
    const v = describeAudit(
      5,
      base("PERSON_EDITED", {
        fields: ["name", "birthYear", "note", "sex", "flags"],
        before: {
          name: "Giả Văn An",
          birthYear: 1927,
          note: { chars: 11 },
          sex: "M",
          flags: ["VERIFY"],
          birth: {
            calendar: "SOLAR",
            year: 1927,
            month: 3,
            day: 15,
            precision: "DAY",
            originalText: "15/3/1927",
          },
        },
        after: {
          name: "Giả Văn Ân",
          birthYear: 1928,
          note: { chars: 20 },
          sex: "F",
          flags: [],
          birth: {
            calendar: "SOLAR",
            year: 1928,
            month: 3,
            day: 15,
            precision: "DAY",
            originalText: "15/3/1928",
          },
        },
      }),
      lookup,
    );
    expect(v.eventLabel).toBe("Sửa hồ sơ");
    const s = v.summary.join("\n");
    expect(s).toContain("Họ tên: Giả Văn An → Giả Văn Ân");
    expect(s).toContain("Năm sinh: 1927 → 1928");
    expect(s).toContain("đã thay đổi (11 → 20 ký tự)");
    expect(s).toContain("Giới tính: nam → nữ");
    expect(s).toContain("Cờ cần kiểm tra:");
    expect(s).not.toContain("15/3");
    expect(v.details.join("\n")).toContain("15/3/1928");
    expect(v.person).toMatchObject({
      id: "a",
      link: true,
      label: "Giả Văn An",
    });
    expect(v.time).toContain("14:30");
    expect(v.time).toContain("10/11/2026");
  });

  it("PERSON_ADDED", () => {
    const v = describeAudit(
      6,
      base("PERSON_ADDED", {
        personId: "p-new",
        createdPersonIds: ["p-new"],
        after: {
          name: "Người Mới",
          category: "CLAN",
          fatherId: "a",
          motherId: "b",
          adoptive: false,
          noteChars: 12,
        },
      }),
      lookup,
    );
    expect(v.eventLabel).toBe("Thêm người con");
    expect(all(v)).toContain("Cha: Giả Văn An");
    expect(all(v)).toContain("Mẹ: Giả Thị Bình");
    expect(all(v)).toContain("con ruột");
    expect(all(v)).toContain("12 ký tự");
  });

  it("SPOUSE_ADDED", () => {
    const v = describeAudit(
      7,
      base("SPOUSE_ADDED", {
        createdPersonIds: ["p-new"],
        after: { spouseId: "p-new", newPerson: true, order: "2" },
      }),
      lookup,
    );
    expect(v.summary[0]).toBe("Thêm vợ/chồng: Người Mới (người mới tạo)");
    expect(v.details).toContain("Thứ tự: 2");
  });

  it("PARENT_CHANGED: đặt mới và thay thế", () => {
    const set = describeAudit(
      8,
      base("PARENT_CHANGED", {
        personId: "c",
        before: { removed: null },
        after: { parentId: "a", role: "FATHER", adoptive: true },
      }),
      lookup,
    );
    expect(set.summary[0]).toBe("Đặt cha: Giả Văn An (con nuôi)");
    const swap = describeAudit(
      9,
      base("PARENT_CHANGED", {
        personId: "c",
        before: { removed: { parentId: "b", role: "FATHER" } },
        after: { parentId: "a", role: "FATHER", adoptive: false },
      }),
      lookup,
    );
    expect(swap.summary[0]).toBe(
      "Thay cha: Giả Thị Bình → Giả Văn An (con ruột)",
    );
  });

  it("PARENT_REVERTED, PARENT_REMOVED, PARENT_REMOVAL_UNDONE", () => {
    const rev = describeAudit(
      10,
      base("PARENT_REVERTED", {
        personId: "c",
        revertsVersion: 8,
        before: { reverted: { parentId: "a", role: "FATHER" } },
        after: { parentId: "b", role: "FATHER", adoptive: false },
      }),
      lookup,
    );
    expect(rev.summary[0]).toBe(
      "Hoàn tác lần thay cha: Giả Văn An → Giả Thị Bình",
    );
    expect(rev.details.join()).toContain("#8");
    const rem = describeAudit(
      11,
      base("PARENT_REMOVED", {
        personId: "c",
        before: { removed: { parentId: "b", role: "MOTHER" } },
        after: { removed: true },
      }),
      lookup,
    );
    expect(rem.summary[0]).toBe("Gỡ mẹ: Giả Thị Bình");
    const undo = describeAudit(
      12,
      base("PARENT_REMOVAL_UNDONE", {
        personId: "c",
        revertsVersion: 11,
        before: { removed: true },
        after: { parentId: "b", role: "MOTHER", adoptive: false },
      }),
      lookup,
    );
    expect(undo.summary[0]).toBe("Khôi phục mẹ: Giả Thị Bình");
    expect(undo.details.join()).toContain("#11");
  });

  it("RELATION_TYPE_CHANGED nêu cha/mẹ lấy từ mã quan hệ", () => {
    const v = describeAudit(
      13,
      base("RELATION_TYPE_CHANGED", {
        personId: "c",
        relationIds: ["r-a-c"],
        before: { relationType: "BIOLOGICAL" },
        after: { relationType: "ADOPTIVE" },
      }),
      lookup,
    );
    expect(v.summary[0]).toBe("Loại con (với Giả Văn An): con ruột → con nuôi");
  });

  it("PERSON_DELETED: người đã ẩn không có link, lấy tên từ rows, kèm (đã ẩn)", () => {
    const v = describeAudit(
      14,
      base("PERSON_DELETED", {
        personId: "gone",
        before: {
          rows: JSON.stringify({
            person: ["Người Đã Ẩn", 1950, null, 3, "C", null, []],
            relations: [["a", "gone", "F", "B", 1]],
            union: ["gone", "b", null],
            moreUnions: [["gone", "c", "2"]],
          }),
        },
        after: { deleted: true },
      }),
      lookup,
    );
    expect(v.eventLabel).toBe("Ẩn người khỏi cây");
    expect(v.person).toMatchObject({
      id: "gone",
      link: false,
      hidden: true,
      label: "Người Đã Ẩn",
    });
    expect(v.details.join()).toContain("1 quan hệ cha/mẹ và 2 liên kết");
    expect(matchesFilter(v, { event: "", text: "da an" })).toBe(true);
  });

  it("PERSON_RESTORED", () => {
    const v = describeAudit(
      15,
      base("PERSON_RESTORED", {
        before: { deleted: true },
        after: { restoredFromVersion: 14 },
      }),
      lookup,
    );
    expect(v.summary[0]).toContain("#14");
  });

  it("UNION_REMOVED và UNION_REMOVAL_UNDONE", () => {
    const rem = describeAudit(
      16,
      base("UNION_REMOVED", {
        before: { removed: { spouseId: "b", order: "1" } },
        after: { removed: true },
      }),
      lookup,
    );
    expect(rem.summary[0]).toBe("Gỡ liên kết vợ/chồng với Giả Thị Bình");
    const undo = describeAudit(
      17,
      base("UNION_REMOVAL_UNDONE", {
        revertsVersion: 16,
        before: { removed: true },
        after: { spouseId: "b", order: "1" },
      }),
      lookup,
    );
    expect(undo.summary[0]).toContain(
      "Khôi phục liên kết vợ/chồng với Giả Thị Bình",
    );
    expect(undo.summary[0]).toContain("#16");
  });

  it("mỗi sự kiện trong danh sách đều có nhãn riêng, không rơi vào 'Sự kiện khác'", () => {
    for (const code of AUDIT_EVENTS) {
      const v = describeAudit(1, base(code, {}), lookup);
      expect(v.known).toBe(true);
      expect(v.eventLabel).toBe(EVENT_LABELS[code]);
      expect(v.summary.length).toBeGreaterThan(0);
    }
  });

  it("sự kiện lạ hiện 'Sự kiện khác (mã)'", () => {
    const v = describeAudit(1, base("INVITATION_CREATED", {}), lookup);
    expect(v.known).toBe(false);
    expect(v.eventLabel).toBe("Sự kiện khác (INVITATION_CREATED)");
  });
});

describe("describeAudit: dữ liệu độc/rác", () => {
  it("chuỗi giống HTML chỉ là text, bị cắt và bỏ ký tự điều khiển", () => {
    const evil = "<script>alert(1)</script>" + "x".repeat(500) + "\u0007";
    const v = describeAudit(
      2,
      base("PERSON_EDITED", {
        fields: ["name"],
        before: { name: evil },
        after: { name: "ok" },
      }),
      lookup,
    );
    expect(v.summary[0]).toContain("<script>");
    expect(v.summary[0].length).toBeLessThan(260);
    expect(v.summary[0]).not.toContain("\u0007");
  });

  it("kiểu sai ở mọi trường không làm ném lỗi", () => {
    const junk: unknown[] = [
      null,
      undefined,
      42,
      "x",
      [],
      { event: 5 },
      { event: "PERSON_EDITED", fields: "name", before: 1, after: [] },
      {
        event: "PERSON_ADDED",
        after: { name: 5, fatherId: {}, motherId: [], category: "X" },
        createdPersonIds: "p",
      },
      {
        event: "PARENT_CHANGED",
        before: { removed: "x" },
        after: { parentId: 9, role: {} },
      },
      { event: "PERSON_DELETED", before: { rows: 12 } },
      { event: "SPOUSE_ADDED", after: { spouseId: "a/b", order: {} } },
      { event: "RELATION_TYPE_CHANGED", relationIds: [5], personId: [] },
      { event: "UNION_REMOVED", before: { removed: null } },
      { event: "PERSON_EDITED", fields: ["birthYear"], before: {}, after: {} },
      { event: "PERSON_EDITED", timestamp: { toDate: () => 5 } },
      {
        event: "PERSON_EDITED",
        timestamp: {
          toDate: () => {
            throw new Error("x");
          },
        },
      },
    ];
    for (const j of junk) {
      const v = describeAudit(3, j, lookup);
      expect(v.summary.length).toBeGreaterThan(0);
      expect(typeof v.eventLabel).toBe("string");
      expect(v.time).toBe("");
    }
  });

  it("mã không an toàn không có link và không vào bộ lọc theo mã", () => {
    for (const bad of ["a/b", "../x", "a b", "x".repeat(101), "", "a?b"]) {
      const v = describeAudit(
        4,
        base("PERSON_EDITED", { personId: bad, fields: [] }),
        () => ({ name: "Có trong cây" }),
      );
      expect(v.person.link).toBe(false);
      expect(v.person.id).toBeNull();
      expect(v.searchIds).toBe("");
    }
  });

  it("mã an toàn nhưng không có trong cây thì không link, đánh dấu đã ẩn", () => {
    const v = describeAudit(
      4,
      base("PERSON_EDITED", { personId: "zz9" }),
      lookup,
    );
    expect(v.person).toMatchObject({ id: "zz9", link: false, hidden: true });
  });

  it("rows hỏng hoặc quá lớn bị bỏ qua", () => {
    expect(parseDeletedRows("{not json")).toBeNull();
    expect(parseDeletedRows(JSON.stringify([1, 2]))).toBeNull();
    expect(parseDeletedRows("[" + "1,".repeat(60000) + "1]")).toBeNull();
    expect(parseDeletedRows(5)).toBeNull();
    expect(parseDeletedRows('{"person":[5],"relations":"x"}')).toEqual({
      name: null,
      relations: 0,
      unions: 0,
    });
    const v = describeAudit(
      4,
      base("PERSON_DELETED", { personId: "gone", before: { rows: "{oops" } }),
      lookup,
    );
    expect(v.person.label).toBe("gone");
    expect(v.summary[0]).toContain("Ẩn người này");
  });

  it("ghi chú không bao giờ lộ nội dung, kể cả khi bản ghi chứa chuỗi", () => {
    const v = describeAudit(
      4,
      base("PERSON_EDITED", {
        fields: ["note"],
        before: { note: "BÍ MẬT TRƯỚC" },
        after: { note: "BÍ MẬT SAU" },
      }),
      lookup,
    );
    expect(all(v)).not.toContain("BÍ MẬT");
    expect(v.summary[0]).toBe("Ghi chú riêng: đã thay đổi");
    const v2 = describeAudit(
      4,
      base("PERSON_EDITED", {
        fields: ["note"],
        before: { note: { chars: 3 } },
        after: { note: { chars: 9 } },
      }),
      lookup,
    );
    expect(v2.summary[0]).toBe("Ghi chú riêng: đã thay đổi (3 → 9 ký tự)");
  });
});

describe("formatVnTime", () => {
  it("dùng giờ Việt Nam, không phụ thuộc múi giờ máy", () => {
    const s = formatVnTime(new Date("2026-11-10T17:05:00Z"));
    expect(s).toContain("00:05");
    expect(s).toContain("11/11/2026");
    expect(formatVnTime(stamp)).toContain("14:30");
  });
  it("giá trị sai kiểu trả chuỗi rỗng", () => {
    for (const v of [null, undefined, 5, "x", {}, new Date("nope")])
      expect(formatVnTime(v)).toBe("");
  });
});

describe("pageVersions", () => {
  it("giảm dần theo trang và dừng ở 1", () => {
    expect(pageVersions(45, 20)).toEqual(
      Array.from({ length: 20 }, (_, i) => 45 - i),
    );
    expect(pageVersions(25, 20)[19]).toBe(6);
    expect(pageVersions(5, 20)).toEqual([5, 4, 3, 2, 1]);
    expect(pageVersions(1, 20)).toEqual([1]);
    expect(pageVersions(0, 20)).toEqual([]);
    expect(pageVersions(-3, 20)).toEqual([]);
    expect(pageVersions(1.5, 20)).toEqual([]);
    expect(pageVersions(5, 0)).toEqual([]);
  });
  it("các trang nối nhau đủ từ n tới 1, không trùng, không sót", () => {
    const seen: number[] = [];
    let next = 47;
    while (next >= 1) {
      const page = pageVersions(next, 20);
      seen.push(...page);
      next = page[page.length - 1] - 1;
    }
    expect(seen).toEqual(Array.from({ length: 47 }, (_, i) => 47 - i));
  });
});

describe("classifyRead / lostAccess", () => {
  const ok = {
    status: "fulfilled",
    value: { exists: true, data: { a: 1 } },
  } as const;
  const denied = {
    status: "rejected",
    reason: { code: "permission-denied" },
  } as const;
  const net = { status: "rejected", reason: { code: "unavailable" } } as const;
  it("phân loại đúng", () => {
    expect(classifyRead(3, ok)).toEqual({
      version: 3,
      status: "ok",
      data: { a: 1 },
    });
    expect(
      classifyRead(3, {
        status: "fulfilled",
        value: { exists: false, data: null },
      }),
    ).toEqual({ version: 3, status: "missing" });
    expect(classifyRead(3, denied).status).toBe("denied");
    expect(classifyRead(3, net).status).toBe("failed");
    expect(
      classifyRead(3, { status: "rejected", reason: new Error("x") }).status,
    ).toBe("failed");
    expect(classifyRead(3, { status: "rejected", reason: null }).status).toBe(
      "failed",
    );
  });
  it("mất quyền chỉ khi cả loạt bị từ chối; một bản thiếu rải rác thì không", () => {
    const d = (v: number): ReadOutcome => ({ version: v, status: "denied" });
    const o = (v: number): ReadOutcome => ({
      version: v,
      status: "ok",
      data: {},
    });
    const f = (v: number): ReadOutcome => ({ version: v, status: "failed" });
    expect(lostAccess([d(3), d(2), d(1)])).toBe(true);
    expect(lostAccess([o(3), d(2), o(1)])).toBe(false);
    expect(lostAccess([d(3), f(2)])).toBe(false);
    expect(lostAccess([d(1)])).toBe(false);
    expect(lostAccess([])).toBe(false);
  });
});

describe("matchesFilter", () => {
  const views = [
    describeAudit(
      3,
      base("SPOUSE_ADDED", {
        personId: "a",
        createdPersonIds: ["p-new"],
        after: { spouseId: "b", newPerson: true },
      }),
      lookup,
    ),
    describeAudit(
      2,
      base("PARENT_CHANGED", {
        personId: "c",
        before: { removed: { parentId: "b", role: "MOTHER" } },
        after: { parentId: "a", role: "MOTHER", adoptive: false },
      }),
      lookup,
    ),
    describeAudit(
      1,
      base("UNION_REMOVED", {
        personId: "c",
        before: { removed: { spouseId: "b" } },
        after: { removed: true },
      }),
      lookup,
    ),
  ];
  const pick = (f: { event: string; text: string }) =>
    views.filter((v) => matchesFilter(v, f)).map((v) => v.version);
  it("không điều kiện thì khớp tất cả", () => {
    expect(pick({ event: "", text: "  " })).toEqual([3, 2, 1]);
  });
  it("theo sự kiện", () => {
    expect(pick({ event: "PARENT_CHANGED", text: "" })).toEqual([2]);
    expect(pick({ event: "KHONG_CO", text: "" })).toEqual([]);
  });
  it("theo mã: personId, createdPersonIds, spouseId, removed.parentId/spouseId, after.parentId", () => {
    expect(pick({ event: "", text: "p-new" })).toEqual([3]);
    expect(pick({ event: "", text: "B" })).toEqual([3, 2, 1]);
    expect(pick({ event: "", text: "c" })).toEqual([2, 1]);
  });
  it("theo tên, không cần dấu", () => {
    expect(pick({ event: "", text: "nguoi moi" })).toEqual([3]);
    expect(pick({ event: "", text: "thi binh" })).toEqual([3, 2, 1]);
  });
  it("không khớp chuỗi ghép tên của hai người khác nhau", () => {
    const lk: PersonLookup = (id) =>
      ({ x: { name: "Nguyễn An" }, y: { name: "Lê Bình" } })[id] ?? null;
    const v = describeAudit(
      9,
      base("SPOUSE_ADDED", { personId: "x", after: { spouseId: "y" } }),
      lk,
    );
    const hit = (text: string) => matchesFilter(v, { event: "", text });
    expect(hit("an")).toBe(true);
    expect(hit("le binh")).toBe(true);
    expect(hit("an le")).toBe(false);
    expect(hit("an binh")).toBe(false);
  });
  it("kết hợp sự kiện và tên", () => {
    expect(pick({ event: "UNION_REMOVED", text: "cuong" })).toEqual([1]);
    expect(pick({ event: "UNION_REMOVED", text: "nguoi moi" })).toEqual([]);
  });
});

describe("shortUid", () => {
  it("rút gọn uid dài", () => {
    expect(shortUid("abcdefghijklmnop")).toBe("abcd…mnop");
    expect(shortUid("abc")).toBe("abc");
  });
});
