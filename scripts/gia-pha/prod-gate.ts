// Cổng an toàn cho thao tác GHI vào production (hàm thuần, không I/O).
// Mọi thao tác ghi dữ liệu thật vào prod phải qua cổng này: đúng project prod, xác nhận project,
// câu xác nhận gõ tay, và (với thao tác ghi dữ liệu) một bản sao lưu mới đã kiểm chứng và khớp Firestore hiện tại.

export const PROD_PROJECT = "gia-pha-nguyen-duc-prod";
export const BACKUP_MAX_AGE_MINUTES = 30;

export type ProdAction =
  | "NAP DU LIEU THAT"
  | "KHOI PHUC"
  | "QUAN LY TAI KHOAN"
  | "XOA TAI KHOAN"
  | "DONG BO GIOI TINH"
  | "CONG BO GHI CHU";

/** Câu xác nhận phải gõ nguyên văn bằng --ack. */
export function ackPhrase(action: ProdAction, project: string): string {
  return `${action} ${project}`;
}

export interface BackupEvidence {
  project: string;
  createdAt: string;
  /** Checksum, số lượng và giải mã đều đạt. */
  verified: boolean;
  /** Firestore hiện tại giống hệt bản sao lưu. */
  matchesLive: boolean;
}

export interface GateInput {
  action: ProdAction;
  project: string;
  confirm: string | undefined;
  ack: string | undefined;
  /** Thao tác ghi/xóa dữ liệu cần bản sao lưu mới; quản lý tài khoản thì không. */
  needsBackup: boolean;
  backup?: BackupEvidence;
  now: Date;
  maxAgeMinutes?: number;
}

export interface GateResult {
  ok: boolean;
  reasons: string[];
}

export function evaluateProdGate(input: GateInput): GateResult {
  const reasons: string[] = [];
  if (input.project !== PROD_PROJECT)
    reasons.push(`Cổng prod chỉ áp dụng cho ${PROD_PROJECT}.`);
  if (input.confirm !== input.project)
    reasons.push(`Thiếu hoặc sai --confirm (cần --confirm ${input.project}).`);
  const phrase = ackPhrase(input.action, input.project);
  if (input.ack !== phrase)
    reasons.push(`Thiếu hoặc sai câu xác nhận (cần --ack "${phrase}").`);
  if (input.needsBackup) {
    const b = input.backup;
    if (!b) reasons.push("Thiếu bản sao lưu mới (--backup-dir).");
    else {
      if (b.project !== input.project)
        reasons.push(`Bản sao lưu thuộc project khác (${b.project}).`);
      const created = Date.parse(b.createdAt);
      const age = (input.now.getTime() - created) / 60000;
      const max = input.maxAgeMinutes ?? BACKUP_MAX_AGE_MINUTES;
      if (!Number.isFinite(created))
        reasons.push("Thời điểm sao lưu không hợp lệ.");
      else if (age < -1) reasons.push("Thời điểm sao lưu nằm trong tương lai.");
      else if (age > max)
        reasons.push(
          `Bản sao lưu đã cũ (${Math.round(age)} phút, tối đa ${max}). Hãy sao lưu lại.`,
        );
      if (!b.verified) reasons.push("Bản sao lưu chưa qua kiểm tra (verify).");
      if (!b.matchesLive)
        reasons.push(
          "Firestore hiện tại không khớp bản sao lưu (có thay đổi sau khi sao lưu).",
        );
    }
  }
  return { ok: reasons.length === 0, reasons };
}
