// I/O dùng chung cho sao lưu: đọc/kiểm tra thư mục sao lưu, đọc Firestore hiện tại, và đánh giá mức sẵn sàng
// (bản sao lưu hợp lệ + khớp Firestore hiện tại) cho cổng prod. Không chứa dữ liệu thật.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  backupLocationAllowed,
  compareDocSets,
  countDocs,
  decryptBytes,
  docLine,
  parseDocLine,
  verifyManifest,
  type Manifest,
} from "./backup-core.ts";
import type { BackupEvidence } from "./prod-gate.ts";

export class BackupError extends Error {}

export interface LoadedBackup {
  dir: string;
  manifest: Manifest;
  problems: string[];
  collections: Map<string, Map<string, string>>;
}

const readBytes = (path: string) => new Uint8Array(readFileSync(path));

export function loadBackup(
  root: string,
  dirArg: string | undefined,
  passphrase: string | undefined,
): LoadedBackup {
  if (!dirArg) throw new BackupError("thiếu thư mục sao lưu.");
  const dir = resolve(root, dirArg);
  if (!backupLocationAllowed(dir, root))
    throw new BackupError(
      "thư mục sao lưu phải ngoài repo hoặc trong backups/ hoặc private-data/.",
    );
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch {
    throw new BackupError("không đọc được manifest.json của bản sao lưu.");
  }
  const result = verifyManifest(manifest, (name) => {
    try {
      return readBytes(join(dir, name));
    } catch {
      return undefined;
    }
  });
  const problems = [...result.problems];
  const collections = new Map<string, Map<string, string>>();
  if (result.ok) {
    if (manifest.encrypted && !passphrase)
      throw new BackupError(
        "bản sao lưu đã mã hóa; đặt GIA_PHA_BACKUP_PASSPHRASE.",
      );
    for (const file of manifest.files) {
      if (!file.collection) continue;
      let text: string;
      try {
        const raw = readBytes(join(dir, file.name));
        text = Buffer.from(
          manifest.encrypted ? decryptBytes(raw, passphrase!) : raw,
        ).toString("utf8");
      } catch (error) {
        problems.push(`${file.name}: ${(error as Error).message}`);
        continue;
      }
      try {
        const { count } = countDocs(text);
        if (count !== file.documents)
          problems.push(
            `${file.name}: số tài liệu ${count} khác manifest ${file.documents}`,
          );
      } catch (error) {
        problems.push(`${file.name}: ${(error as Error).message}`);
        continue;
      }
      const map = new Map<string, string>();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const doc = parseDocLine(line);
        map.set(doc.id, line);
      }
      collections.set(file.collection, map);
    }
  }
  return { dir, manifest, problems, collections };
}

interface DbLike {
  listCollections(): Promise<
    Array<{
      id: string;
      get(): Promise<{
        docs: Array<{ id: string; data(): Record<string, unknown> }>;
      }>;
    }>
  >;
}

export async function liveCollections(
  db: DbLike,
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  for (const col of await db.listCollections()) {
    const map = new Map<string, string>();
    for (const d of (await col.get()).docs)
      map.set(d.id, docLine({ id: d.id, data: d.data() }));
    out.set(col.id, map);
  }
  return out;
}

/** Tổng số khác biệt giữa bản sao lưu và Firestore hiện tại (0 = khớp). */
export async function countDifferences(
  backup: LoadedBackup,
  db: DbLike,
): Promise<number> {
  const live = await liveCollections(db);
  let bad = 0;
  for (const name of new Set([...backup.collections.keys(), ...live.keys()])) {
    const c = compareDocSets(
      backup.collections.get(name) ?? new Map(),
      live.get(name) ?? new Map(),
    );
    bad += c.missing.length + c.extra.length + c.different.length;
  }
  return bad;
}

/** Bằng chứng sao lưu cho cổng prod: kiểm tra bản sao lưu và so với Firestore hiện tại. */
export async function collectBackupEvidence(
  root: string,
  dir: string,
  passphrase: string | undefined,
  db: DbLike,
): Promise<{ evidence: BackupEvidence; problems: string[] }> {
  const backup = loadBackup(root, dir, passphrase);
  const verified = backup.problems.length === 0;
  const matchesLive = verified
    ? (await countDifferences(backup, db)) === 0
    : false;
  return {
    evidence: {
      project: backup.manifest.project,
      createdAt: backup.manifest.createdAt,
      verified,
      matchesLive,
    },
    problems: backup.problems,
  };
}
