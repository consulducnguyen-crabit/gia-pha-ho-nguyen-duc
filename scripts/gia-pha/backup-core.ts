// Phần lõi thuần của công cụ sao lưu/khôi phục (không I/O Firestore). Không chứa dữ liệu thật.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const BACKUP_FORMAT = 1;

export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
}
export function isTimestampLike(value: unknown): value is TimestampLike {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.seconds === "number" &&
    typeof v.nanoseconds === "number" &&
    typeof v.toDate === "function"
  );
}

/** JSON xác định (khóa sắp xếp) với Timestamp -> {"__ts":"seconds.nanoseconds"}. Kiểu lạ thì báo lỗi, không đoán. */
export function encodeValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Số không hữu hạn.");
    return value;
  }
  if (isTimestampLike(value))
    return {
      __ts: `${value.seconds}.${String(value.nanoseconds).padStart(9, "0")}`,
    };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
      throw new Error(
        `Kiểu dữ liệu chưa hỗ trợ sao lưu: ${proto?.constructor?.name}`,
      );
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, encodeValue((value as Record<string, unknown>)[k])]),
    );
  }
  throw new Error(`Kiểu dữ liệu chưa hỗ trợ sao lưu: ${typeof value}`);
}

export function decodeValue(
  value: unknown,
  makeTimestamp: (seconds: number, nanoseconds: number) => unknown,
): unknown {
  if (Array.isArray(value))
    return value.map((v) => decodeValue(v, makeTimestamp));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length === 1 &&
      keys[0] === "__ts" &&
      typeof record.__ts === "string"
    ) {
      const m = record.__ts.match(/^(-?\d+)\.(\d{9})$/);
      if (!m) throw new Error("Timestamp sao lưu không hợp lệ.");
      return makeTimestamp(Number(m[1]), Number(m[2]));
    }
    return Object.fromEntries(
      keys.map((k) => [k, decodeValue(record[k], makeTimestamp)]),
    );
  }
  return value;
}

export interface BackupDoc {
  id: string;
  data: Record<string, unknown>;
}
export function docLine(doc: BackupDoc): string {
  return JSON.stringify({ id: doc.id, data: encodeValue(doc.data) });
}
export function parseDocLine(line: string): BackupDoc {
  const parsed = JSON.parse(line);
  if (
    !parsed ||
    typeof parsed.id !== "string" ||
    !parsed.id ||
    typeof parsed.data !== "object" ||
    parsed.data === null
  )
    throw new Error("Dòng sao lưu không hợp lệ.");
  return parsed as BackupDoc;
}

export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

// ---- Mã hóa tùy chọn (AES-256-GCM, khóa từ cụm mật khẩu bằng scrypt) ----
const MAGIC = Buffer.from("GPBK1");
export function encryptBytes(plain: Uint8Array, passphrase: string): Buffer {
  if (passphrase.length < 12)
    throw new Error("Cụm mật khẩu sao lưu cần tối thiểu 12 ký tự.");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}
export function decryptBytes(blob: Uint8Array, passphrase: string): Buffer {
  const buf = Buffer.from(blob);
  if (
    buf.length < MAGIC.length + 16 + 12 + 16 ||
    !buf.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error("Tệp mã hóa không hợp lệ.");
  let offset = MAGIC.length;
  const salt = buf.subarray(offset, (offset += 16));
  const iv = buf.subarray(offset, (offset += 12));
  const tag = buf.subarray(offset, (offset += 16));
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(buf.subarray(offset)),
      decipher.final(),
    ]);
  } catch {
    throw new Error("Giải mã thất bại: sai cụm mật khẩu hoặc tệp bị sửa.");
  }
}

// ---- Manifest ----
export interface ManifestFile {
  name: string;
  collection: string | null;
  documents: number;
  /** sha256 của nội dung đã (nếu có) mã hóa, đúng như ghi trên đĩa. */
  sha256: string;
}
export interface Manifest {
  format: number;
  createdAt: string;
  project: string;
  encrypted: boolean;
  files: ManifestFile[];
  note: string;
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
}
/** So khớp manifest với nội dung các tệp (sha256 đúng như trên đĩa). */
export function verifyManifest(
  manifest: Manifest,
  read: (name: string) => Uint8Array | undefined,
): VerifyResult {
  const problems: string[] = [];
  if (manifest.format !== BACKUP_FORMAT)
    problems.push(`Định dạng ${manifest.format} chưa được hỗ trợ.`);
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (seen.has(file.name))
      problems.push(`Tệp bị khai báo trùng: ${file.name}`);
    seen.add(file.name);
    const content = read(file.name);
    if (!content) {
      problems.push(`Thiếu tệp: ${file.name}`);
      continue;
    }
    if (sha256(content) !== file.sha256)
      problems.push(`Sai checksum: ${file.name}`);
  }
  return { ok: problems.length === 0, problems };
}

/** Đếm dòng tài liệu trong nội dung JSONL đã giải mã và kiểm tra đúng cấu trúc. */
export function countDocs(jsonl: string): { count: number; ids: string[] } {
  const ids: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    ids.push(parseDocLine(line).id);
  }
  if (new Set(ids).size !== ids.length)
    throw new Error("Có mã tài liệu bị trùng trong tệp sao lưu.");
  return { count: ids.length, ids };
}

export interface Comparison {
  missing: string[];
  extra: string[];
  different: string[];
}
/** So sánh hai tập tài liệu đã mã hóa (key = id, value = dòng JSON ổn định). Không đưa nội dung vào kết quả. */
export function compareDocSets(
  expected: Map<string, string>,
  actual: Map<string, string>,
): Comparison {
  const missing: string[] = [];
  const different: string[] = [];
  for (const [id, line] of expected) {
    const got = actual.get(id);
    if (got === undefined) missing.push(id);
    else if (got !== line) different.push(id);
  }
  const extra = [...actual.keys()].filter((id) => !expected.has(id));
  return { missing, extra, different };
}

/** Quy tắc nơi lưu sao lưu: trong backups/ hoặc private-data/ của repo, hoặc bất kỳ chỗ nào ngoài repo. */
export function backupLocationAllowed(
  target: string,
  repoRoot: string,
): boolean {
  const rel = relative(repoRoot, resolve(target));
  if (rel === "") return false; // chính thư mục gốc repo
  if (rel.startsWith("..") || isAbsolute(rel)) return true; // ngoài repo (kể cả ổ đĩa khác)
  const first = rel.split(sep)[0];
  return first === "backups" || first === "private-data";
}
