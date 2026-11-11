// Thực thi cổng prod cho các script CLI: thu thập bằng chứng sao lưu, đánh giá và dừng nếu không đạt.
import { BackupError, collectBackupEvidence } from "./backup-io.ts";
import {
  evaluateProdGate,
  type BackupEvidence,
  type ProdAction,
} from "./prod-gate.ts";

export async function enforceProdGate(options: {
  root: string;
  action: ProdAction;
  project: string;
  confirm: string | undefined;
  ack: string | undefined;
  needsBackup: boolean;
  backupDir: string | undefined;
  passphrase: string | undefined;
  db?: Parameters<typeof collectBackupEvidence>[3];
}): Promise<void> {
  let evidence: BackupEvidence | undefined;
  const extra: string[] = [];
  if (options.needsBackup && options.backupDir && options.db) {
    try {
      const collected = await collectBackupEvidence(
        options.root,
        options.backupDir,
        options.passphrase,
        options.db,
      );
      evidence = collected.evidence;
      extra.push(...collected.problems);
    } catch (error) {
      if (!(error instanceof BackupError)) throw error;
      extra.push(error.message);
    }
  }
  const result = evaluateProdGate({
    action: options.action,
    project: options.project,
    confirm: options.confirm,
    ack: options.ack,
    needsBackup: options.needsBackup,
    backup: evidence,
    now: new Date(),
  });
  if (!result.ok || extra.length) {
    console.error("Cổng production KHÔNG ĐẠT:");
    for (const reason of [...result.reasons, ...extra])
      console.error(` - ${reason}`);
    process.exit(2);
  }
  console.log(
    "Cổng production đạt: xác nhận hợp lệ" +
      (options.needsBackup
        ? ", sao lưu mới đã kiểm chứng và khớp Firestore hiện tại."
        : "."),
  );
}
