import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  backupLocationAllowed,
  compareDocSets,
  countDocs,
  decodeValue,
  decryptBytes,
  docLine,
  encodeValue,
  encryptBytes,
  parseDocLine,
  sha256,
  verifyManifest,
  type Manifest,
} from "../scripts/gia-pha/backup-core";

// Dữ liệu hoàn toàn giả.
class FakeTs {
  constructor(
    public seconds: number,
    public nanoseconds: number,
  ) {}
  toDate() {
    return new Date(this.seconds * 1000);
  }
}

describe("tuần tự hóa tài liệu", () => {
  it("ổn định theo thứ tự khóa và khứ hồi Timestamp", () => {
    const a = docLine({
      id: "x",
      data: { b: 1, a: { z: [1, "t"], y: new FakeTs(5, 7) } },
    });
    const b = docLine({
      id: "x",
      data: { a: { y: new FakeTs(5, 7), z: [1, "t"] }, b: 1 },
    });
    expect(a).toBe(b);
    expect(a).toContain('"__ts":"5.000000007"');
    const back = decodeValue(
      parseDocLine(a).data,
      (s, n) => new FakeTs(s, n),
    ) as {
      a: { y: FakeTs };
    };
    expect(back.a.y).toBeInstanceOf(FakeTs);
    expect(back.a.y.seconds).toBe(5);
    expect(back.a.y.nanoseconds).toBe(7);
  });
  it("từ chối kiểu lạ và số không hữu hạn thay vì đoán", () => {
    expect(() => encodeValue(new Map())).toThrow();
    expect(() => encodeValue(NaN)).toThrow();
    expect(() => encodeValue(() => 1)).toThrow();
    expect(() => parseDocLine('{"id":"","data":{}}')).toThrow();
    expect(() => parseDocLine('{"id":"a","data":null}')).toThrow();
  });
  it("phát hiện mã trùng và đếm tài liệu", () => {
    const l1 = docLine({ id: "a", data: { n: 1 } });
    const l2 = docLine({ id: "b", data: { n: 2 } });
    expect(countDocs(`${l1}\n${l2}\n`).count).toBe(2);
    expect(countDocs("").count).toBe(0);
    expect(() => countDocs(`${l1}\n${l1}\n`)).toThrow();
  });
});

describe("mã hóa sao lưu", () => {
  const plain = Buffer.from("nội dung giả\nxuống dòng", "utf8");
  it("khứ hồi và phát hiện sai mật khẩu hoặc tệp bị sửa", () => {
    const blob = encryptBytes(plain, "cum-mat-khau-gia-12");
    expect(blob.includes(plain)).toBe(false);
    expect(decryptBytes(blob, "cum-mat-khau-gia-12").equals(plain)).toBe(true);
    expect(() => decryptBytes(blob, "sai-mat-khau-gia-1")).toThrow(
      /sai cụm mật khẩu/,
    );
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptBytes(tampered, "cum-mat-khau-gia-12")).toThrow();
    expect(() =>
      decryptBytes(Buffer.from("rac"), "cum-mat-khau-gia-12"),
    ).toThrow();
  });
  it("từ chối cụm mật khẩu quá ngắn; hai lần mã hóa khác nhau", () => {
    expect(() => encryptBytes(plain, "ngan")).toThrow();
    expect(
      encryptBytes(plain, "cum-mat-khau-gia-12").equals(
        encryptBytes(plain, "cum-mat-khau-gia-12"),
      ),
    ).toBe(false);
  });
});

describe("manifest và đối chiếu", () => {
  const content = Buffer.from("abc");
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    createdAt: "2026-01-01T00:00:00.000Z",
    project: "demo",
    encrypted: false,
    files: [
      {
        name: "a.jsonl",
        collection: "a",
        documents: 1,
        sha256: sha256(content),
      },
    ],
    note: "",
  };
  it("kiểm tra checksum, thiếu tệp, định dạng lạ", () => {
    expect(verifyManifest(manifest, () => content).ok).toBe(true);
    expect(
      verifyManifest(manifest, () => Buffer.from("abd")).problems[0],
    ).toMatch(/checksum/);
    expect(verifyManifest(manifest, () => undefined).problems[0]).toMatch(
      /Thiếu/,
    );
    expect(verifyManifest({ ...manifest, format: 99 }, () => content).ok).toBe(
      false,
    );
  });
  it("so sánh hai tập: thiếu, thừa, khác — không lộ nội dung", () => {
    const expected = new Map([
      ["1", "A"],
      ["2", "B"],
      ["3", "C"],
    ]);
    const actual = new Map([
      ["1", "A"],
      ["2", "X"],
      ["4", "D"],
    ]);
    expect(compareDocSets(expected, actual)).toEqual({
      missing: ["3"],
      extra: ["4"],
      different: ["2"],
    });
    expect(compareDocSets(expected, new Map(expected))).toEqual({
      missing: [],
      extra: [],
      different: [],
    });
  });
});

describe("nơi lưu sao lưu", () => {
  const repo = resolve("/repo-gia");
  it("cho phép backups/, private-data/ và ngoài repo; cấm phần còn lại của repo", () => {
    expect(backupLocationAllowed(resolve(repo, "backups", "x"), repo)).toBe(
      true,
    );
    expect(
      backupLocationAllowed(resolve(repo, "private-data", "bk"), repo),
    ).toBe(true);
    expect(backupLocationAllowed(resolve("/ngoai-repo/bk"), repo)).toBe(true);
    expect(backupLocationAllowed(resolve(repo, "src"), repo)).toBe(false);
    expect(backupLocationAllowed(resolve(repo, "docs", "bk"), repo)).toBe(
      false,
    );
    expect(backupLocationAllowed(repo, repo)).toBe(false);
  });
});
