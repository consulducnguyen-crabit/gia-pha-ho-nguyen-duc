// Cấp quyền/sửa/vô hiệu hóa tài khoản ĐÃ CÓ bằng Firestore client SDK, qua firestore.rules (PR-A).
// Phần dựng dữ liệu (buildAccountUpdate) là hàm thuần để kiểm thử; updateAccount nối với Firestore trong MỘT giao dịch:
// đọc users/{target} và accessControl/admins rồi ghi giá trị CỤ THỂ (không increment/arrayUnion) + sổ + nhật ký.
import {
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

/** Dấu thay bằng serverTimestamp(); rules đòi updatedAt/approvedAt/disabledAt/timestamp == request.time. */
export const SERVER_TIME = { __serverTime: true } as const;
export const NAME_MAX = 120;
export const LEDGER_MAX = 20;

export type AccountErrorCode =
  | "SELF"
  | "NO_CHANGE"
  | "INVALID_NAME"
  | "INVALID_STATE"
  | "LEDGER_MISSING"
  | "LEDGER_ACTOR"
  | "LEDGER_FULL"
  | "NOT_FOUND"
  | "CONFLICT";

export class AccountError extends Error {
  constructor(
    public code: AccountErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AccountPatch {
  admin?: boolean;
  enabled?: boolean;
  displayName?: string;
}

export interface Ledger {
  adminUids: string[];
  version: number;
}

export interface AccountUpdate {
  userId: string;
  userPatch: Record<string, unknown>;
  ledgerWrite: {
    adminUids: string[];
    version: number;
    lastTargetUid: string;
  } | null;
  auditId: string;
  audit: Record<string, unknown>;
  accessVersion: number;
}

/** Tên hiển thị hợp lệ: 1–120 ký tự, không ký tự điều khiển (khớp nameOk của rules). */
export function validateAccountName(value: string): string {
  const name = value.trim();
  const control = [...name].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!name || [...name].length > NAME_MAX || control)
    throw new AccountError(
      "INVALID_NAME",
      "Tên hiển thị phải dài 1–120 ký tự và không chứa ký tự điều khiển.",
    );
  return name;
}

export function ledgerShapeOk(l: unknown): l is Ledger {
  const x = l as Ledger | undefined;
  return (
    !!x &&
    Array.isArray(x.adminUids) &&
    x.adminUids.every((u) => typeof u === "string") &&
    new Set(x.adminUids).size === x.adminUids.length &&
    Number.isSafeInteger(x.version) &&
    x.version >= 0
  );
}

const isAdminDoc = (d: Record<string, unknown> | undefined) =>
  d?.enabled === true && d?.canManageMembership === true;

/**
 * Dựng dữ liệu ghi thỏa firestore.rules:
 * - users: chỉ enabled/canManageMembership/displayName/accessVersion/updatedBy/updatedAt/approvedBy-At/disabledBy-At;
 *   accessVersion + 1; canManageMembership ⇒ enabled (vô hiệu hóa quản trị viên cũng hạ quyền quản trị).
 * - sổ: khi trạng thái quản trị viên đổi, ghi adminUids cụ thể (thêm cuối / bỏ đúng một uid), version + 1, lastTargetUid.
 * - nhật ký account-{uid}-{accessVersion mới}: ACCOUNT_UPDATED, before/after chỉ có enabled/admin (không tên, không email).
 */
export function buildAccountUpdate(input: {
  actorUid: string;
  targetUid: string;
  before: Record<string, unknown> | undefined;
  ledger: unknown;
  patch: AccountPatch;
}): AccountUpdate {
  const { actorUid, targetUid, before, patch } = input;
  if (actorUid === targetUid)
    throw new AccountError("SELF", "Không tự đổi quyền của chính mình.");
  if (!before)
    throw new AccountError("NOT_FOUND", "Không tìm thấy tài khoản này.");
  if (!ledgerShapeOk(input.ledger))
    throw new AccountError(
      "LEDGER_MISSING",
      "Sổ quản trị chưa được khởi tạo hoặc đang lệch; chạy gia-pha:accounts registry --rebuild.",
    );
  const ledger = input.ledger;
  if (!ledger.adminUids.includes(actorUid))
    throw new AccountError(
      "LEDGER_ACTOR",
      "Sổ quản trị không chứa tài khoản của bạn; chạy gia-pha:accounts registry --rebuild.",
    );
  const av = before.accessVersion === undefined ? 0 : before.accessVersion;
  if (
    typeof before.enabled !== "boolean" ||
    !Number.isSafeInteger(av) ||
    (av as number) < 0
  )
    throw new AccountError(
      "INVALID_STATE",
      "Dữ liệu tài khoản không hợp lệ; chạy gia-pha:accounts registry --rebuild hoặc kiểm tra tay.",
    );
  const wasEnabled = before.enabled;
  const wasAdmin = isAdminDoc(before);
  const newEnabled = patch.enabled ?? wasEnabled;
  // Bật lại không tự khôi phục quyền quản trị (kể cả dữ liệu kiểu cũ còn canManageMembership = true).
  let newAdmin =
    patch.admin ??
    (!wasEnabled && newEnabled ? false : before.canManageMembership === true);
  if (patch.admin === true && !newEnabled)
    throw new AccountError(
      "INVALID_STATE",
      "Tài khoản đã vô hiệu hóa không thể là quản trị viên; hãy bật lại trước.",
    );
  if (!newEnabled) newAdmin = false;
  const nowAdmin = newEnabled && newAdmin;
  const name =
    patch.displayName === undefined
      ? undefined
      : validateAccountName(patch.displayName);
  const nameChanged =
    name !== undefined &&
    name !==
      (typeof before.displayName === "string"
        ? before.displayName.trim()
        : null);
  const enabledChanged = newEnabled !== wasEnabled;
  const adminChanged = nowAdmin !== wasAdmin;
  if (!nameChanged && !enabledChanged && !adminChanged)
    throw new AccountError("NO_CHANGE", "Chưa có thay đổi nào để lưu.");

  const accessVersion = (av as number) + 1;
  const userPatch: Record<string, unknown> = {
    // Luôn ghi bool tường minh (rules đòi bool sau khi sửa).
    enabled: newEnabled,
    canManageMembership: newAdmin,
    accessVersion,
    updatedBy: actorUid,
    updatedAt: SERVER_TIME,
  };
  if (nameChanged) userPatch.displayName = name;
  if (enabledChanged && !newEnabled) {
    userPatch.disabledBy = actorUid;
    userPatch.disabledAt = SERVER_TIME;
  }
  if (enabledChanged && newEnabled) {
    userPatch.approvedBy = actorUid;
    userPatch.approvedAt = SERVER_TIME;
  }

  let ledgerWrite: AccountUpdate["ledgerWrite"] = null;
  if (adminChanged) {
    const has = ledger.adminUids.includes(targetUid);
    if (nowAdmin && has)
      throw new AccountError(
        "INVALID_STATE",
        "Sổ quản trị đang lệch; chạy gia-pha:accounts registry --rebuild.",
      );
    if (!nowAdmin && !has)
      throw new AccountError(
        "INVALID_STATE",
        "Sổ quản trị đang lệch; chạy gia-pha:accounts registry --rebuild.",
      );
    const adminUids = nowAdmin
      ? [...ledger.adminUids, targetUid]
      : ledger.adminUids.filter((u) => u !== targetUid);
    if (adminUids.length > LEDGER_MAX)
      throw new AccountError(
        "LEDGER_FULL",
        `Chỉ có tối đa ${LEDGER_MAX} quản trị viên.`,
      );
    ledgerWrite = {
      adminUids,
      version: ledger.version + 1,
      lastTargetUid: targetUid,
    };
  }
  const fields = [
    ...(enabledChanged ? ["enabled"] : []),
    ...(adminChanged ? ["admin"] : []),
    ...(nameChanged ? ["displayName"] : []),
  ];
  return {
    userId: targetUid,
    userPatch,
    ledgerWrite,
    auditId: `account-${targetUid}-${accessVersion}`,
    audit: {
      event: "ACCOUNT_UPDATED",
      actorUid,
      targetUid,
      accessVersion,
      fields,
      before: { enabled: wasEnabled, admin: wasAdmin },
      after: { enabled: newEnabled, admin: nowAdmin },
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
    accessVersion,
  };
}

const withServerTime = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v === SERVER_TIME ? serverTimestamp() : v,
    ]),
  );

const CONFLICT_MESSAGE =
  "Người khác vừa sửa tài khoản này; đã tải lại dữ liệu mới.";
// Sau permission-denied vì người khác vừa ghi, các lỗi này nghĩa là thay đổi đã vô nghĩa hoặc xung đột với dữ liệu mới.
const STALE_CODES: AccountErrorCode[] = [
  "NO_CHANGE",
  "INVALID_STATE",
  "LEDGER_ACTOR",
  "LEDGER_FULL",
  "NOT_FOUND",
  "SELF",
];
export const UPDATE_MAX_RETRIES = 2;

/**
 * Sửa/vô hiệu hóa/bật lại một tài khoản đã có. Ném AccountError hoặc lỗi Firestore (dùng accountErrorMessage).
 * Hai quản trị viên sửa cùng lúc có thể khiến rules thấy accessVersion/version sổ đã đổi (permission-denied). Khi đó đọc
 * lại users/target và sổ ngoài giao dịch: nếu version đã khác lần đọc trước thì chạy lại (tối đa 2 lần, dựng lại từ dữ
 * liệu mới, không dùng cờ cũ); nếu không đổi thì báo lỗi như cũ; nếu thay đổi trở nên vô nghĩa/xung đột thì báo CONFLICT.
 */
export async function updateAccount(
  db: Firestore,
  actorUid: string,
  targetUid: string,
  patch: AccountPatch,
): Promise<{ accessVersion: number }> {
  const ledgerRef = doc(db, "accessControl", "admins");
  const userRef = doc(db, "users", targetUid);
  for (let attempt = 0; ; attempt++) {
    let seen = "";
    try {
      return await runTransaction(db, async (tx) => {
        const [ledgerSnap, userSnap] = await Promise.all([
          tx.get(ledgerRef),
          tx.get(userRef),
        ]);
        seen = versionKey(userSnap.data(), ledgerSnap.data());
        const update = buildAccountUpdate({
          actorUid,
          targetUid,
          before: userSnap.exists() ? userSnap.data() : undefined,
          ledger: ledgerSnap.exists() ? ledgerSnap.data() : undefined,
          patch,
        });
        tx.update(userRef, withServerTime(update.userPatch));
        if (update.ledgerWrite) tx.update(ledgerRef, update.ledgerWrite);
        tx.set(
          doc(db, "auditLogs", update.auditId),
          withServerTime(update.audit),
        );
        return { accessVersion: update.accessVersion };
      });
    } catch (error) {
      if (
        attempt > 0 &&
        error instanceof AccountError &&
        STALE_CODES.includes(error.code)
      )
        throw new AccountError("CONFLICT", CONFLICT_MESSAGE);
      if (
        (error as { code?: string } | null)?.code !== "permission-denied" ||
        attempt >= UPDATE_MAX_RETRIES
      )
        throw error;
      const fresh = await Promise.all([
        getDocFromServer(userRef),
        getDocFromServer(ledgerRef),
      ]).then(
        ([u, l]) => versionKey(u.data(), l.data()),
        () => seen,
      );
      if (fresh === seen) throw error; // dữ liệu không đổi: lỗi quyền thật
    }
  }
}

const versionKey = (
  user: Record<string, unknown> | undefined,
  ledger: Record<string, unknown> | undefined,
) => `${String(user?.accessVersion)}|${String(ledger?.version)}`;

/** Thông báo tiếng Việt cho lỗi của updateAccount. */
export function accountErrorMessage(error: unknown): string {
  if (error instanceof AccountError) return error.message;
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "permission-denied")
    return "Không thực hiện được: quyền đã thay đổi hoặc dữ liệu vừa được người khác sửa. Hãy tải lại và thử lại.";
  if (code === "aborted" || code === "failed-precondition")
    return "Dữ liệu vừa được người khác thay đổi. Hãy tải lại danh sách rồi thử lại.";
  if (code === "not-found") return "Không tìm thấy tài khoản này.";
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  return "Không lưu được thay đổi. Hãy tải lại và thử lại.";
}
