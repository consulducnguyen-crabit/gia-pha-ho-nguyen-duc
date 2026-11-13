// Logic thuần cho quản lý tài khoản (không I/O). Dùng bởi scripts/gia-pha/accounts.ts.
// Cấu trúc users/{uid} khớp backend lời mời (functions/src/membership.ts).
import { randomInt } from "node:crypto";

export const ACTOR = "admin-local-script";

export function validateEmail(value: string | undefined): string {
  const email = (value ?? "").trim().toLowerCase();
  if (
    email.length < 5 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new Error("Email không hợp lệ.");
  return email;
}

export function validateName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = value.trim();
  const hasControl = [...name].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!name || name.length > 120 || hasControl)
    throw new Error(
      "Họ tên không hợp lệ (1–120 ký tự, không ký tự điều khiển).",
    );
  return name;
}

// Mật khẩu ngẫu nhiên 16 ký tự, tránh ký tự dễ nhầm (0/O, 1/l/I).
export function generatePassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export interface UserDoc {
  enabled: boolean;
  roleIds: string[];
  accessVersion: number;
  schemaVersion: 1;
  approvedBy?: string;
  approvedAt?: unknown;
  disabledBy?: string;
  disabledAt?: unknown;
  email?: string;
  displayName?: string;
  canManageMembership?: boolean;
  canReviewChanges?: boolean;
  [key: string]: unknown;
}

function version(existing: Record<string, unknown> | undefined): number {
  const v = existing?.accessVersion;
  if (v === undefined) return 0;
  if (!Number.isSafeInteger(v) || (v as number) < 0)
    throw new Error(
      "accessVersion hiện có không hợp lệ; dừng để kiểm tra tay.",
    );
  return v as number;
}

export interface GrantOptions {
  email: string;
  name?: string;
  admin?: boolean;
  reviewer?: boolean;
}

/** Cấp (hoặc cấp lại) quyền truy cập. Không thay đổi cờ đặc quyền nếu không được yêu cầu. */
export function buildGrant(
  existing: Record<string, unknown> | undefined,
  options: GrantOptions,
  now: unknown,
): UserDoc {
  return {
    ...(existing ?? {}),
    enabled: true,
    roleIds: ["member"],
    accessVersion: version(existing) + 1,
    approvedBy: ACTOR,
    approvedAt: now,
    schemaVersion: 1,
    email: options.email,
    ...(options.name ? { displayName: options.name } : {}),
    // Rules đòi canManageMembership là bool tường minh khi quản trị sửa users: luôn ghi bool (giữ giá trị cũ).
    canManageMembership: options.admin
      ? true
      : existing?.canManageMembership === true,
    ...(options.reviewer ? { canReviewChanges: true } : {}),
  } as UserDoc;
}

export function buildRevoke(
  existing: Record<string, unknown> | undefined,
  now: unknown,
): UserDoc {
  return {
    ...(existing ?? {}),
    enabled: false,
    // Bất biến của rules: canManageMembership ⇒ enabled; tài khoản bị thu hồi không còn là quản trị viên.
    canManageMembership: false,
    roleIds: ["member"],
    accessVersion: version(existing) + 1,
    disabledBy: ACTOR,
    disabledAt: now,
    schemaVersion: 1,
  } as UserDoc;
}

export function buildRole(
  existing: Record<string, unknown> | undefined,
  changes: { admin?: boolean; reviewer?: boolean },
): UserDoc {
  if (!existing || existing.enabled !== true)
    throw new Error("Chỉ đổi vai trò cho tài khoản đang được cấp quyền.");
  return {
    ...existing,
    accessVersion: version(existing) + 1,
    canManageMembership:
      changes.admin === undefined
        ? existing.canManageMembership === true
        : changes.admin,
    ...(changes.reviewer === undefined
      ? {}
      : { canReviewChanges: changes.reviewer }),
  } as UserDoc;
}

export function isActiveAdmin(doc: Record<string, unknown> | undefined) {
  return doc?.enabled === true && doc?.canManageMembership === true;
}

/** Không cho thu hồi/hạ quyền quản trị viên cuối cùng (tránh tự khóa hệ thống). */
export function wouldRemoveLastAdmin(
  target: Record<string, unknown> | undefined,
  allUsers: Array<Record<string, unknown>>,
  after: Record<string, unknown>,
): boolean {
  if (!isActiveAdmin(target) || isActiveAdmin(after)) return false;
  return allUsers.filter(isActiveAdmin).length <= 1;
}

/**
 * Kiểm tra tài khoản Auth đã tồn tại trước khi cấp quyền. Chặn kịch bản "đăng ký trước": kẻ khác tự đăng ký
 * email/mật khẩu bằng email của thành viên rồi chờ quản trị viên cấp quyền. Tài khoản mật khẩu hợp lệ do công
 * cụ này tạo luôn có email đã xác minh; tài khoản mật khẩu chưa xác minh là tự đăng ký nên không được tin.
 */
export function assessExistingUser(user: {
  disabled: boolean;
  emailVerified: boolean;
  providerIds: string[];
}): string | null {
  if (user.disabled)
    return "tài khoản Auth đang bị khóa; mở khóa trước khi cấp quyền.";
  if (user.providerIds.includes("password") && !user.emailVerified)
    return "email này đã được tự đăng ký bằng mật khẩu và chưa xác minh; không tin tưởng. Hãy xóa tài khoản đó trong Firebase Console rồi chạy lại grant/create, hoặc dùng reset-password sau khi xác nhận danh tính.";
  return null;
}

// ---- Sổ quản trị viên accessControl/admins (bất biến: uid ∈ adminUids ⇔ enabled && canManageMembership) ----
export const LEDGER_MAX = 20;
export const LEDGER_PATH = "accessControl/admins";

export interface Ledger {
  adminUids: string[];
  version: number;
  lastTargetUid: string;
  schemaVersion: 1;
}

function sortedAdmins(set: Set<string>): string[] {
  const adminUids = [...set].sort();
  if (adminUids.length < 1)
    throw new Error("Sổ quản trị viên không được rỗng (cần ít nhất một).");
  if (adminUids.length > LEDGER_MAX)
    throw new Error(`Sổ quản trị viên tối đa ${LEDGER_MAX} người.`);
  return adminUids;
}

export function ledgerShapeOk(ledger: Ledger): boolean {
  return (
    Array.isArray(ledger.adminUids) &&
    ledger.adminUids.every((u) => typeof u === "string") &&
    Number.isSafeInteger(ledger.version) &&
    ledger.version >= 0
  );
}

/** Sổ mới khi trạng thái quản trị viên của uid đổi; null nếu không đổi (sổ không được ghi). */
export function ledgerAfter(
  ledger: Ledger,
  uid: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): Ledger | null {
  const was = isActiveAdmin(before);
  const now = isActiveAdmin(after);
  if (was === now) return null;
  if (!ledgerShapeOk(ledger))
    throw new Error(
      "sổ accessControl/admins hỏng (adminUids phải là mảng chuỗi, version là số nguyên >= 0); dừng để kiểm tra tay.",
    );
  const set = new Set(ledger.adminUids);
  if (now) set.add(uid);
  else set.delete(uid);
  return {
    adminUids: sortedAdmins(set),
    version: ledger.version + 1,
    lastTargetUid: uid,
    schemaVersion: 1,
  };
}

/** adminUids dựng từ users theo bất biến (đã sắp xếp); ném lỗi nếu rỗng hoặc quá giới hạn. */
export function buildRegistry(
  allUsers: Map<string, Record<string, unknown>>,
): string[] {
  const set = new Set<string>();
  for (const [uid, d] of allUsers) if (isActiveAdmin(d)) set.add(uid);
  return sortedAdmins(set);
}

export interface RegistryDiff {
  missingFromLedger: string[];
  extraInLedger: string[];
  badUsers: Array<{ uid: string; reason: string }>;
  clean: boolean;
}

/** users lệch chuẩn rules: canManageMembership phải là bool và không được true khi enabled != true. */
export function badUserReason(d: Record<string, unknown>): string | null {
  if (typeof d.enabled !== "boolean") return "enabled không phải bool";
  if (
    d.accessVersion !== undefined &&
    (!Number.isSafeInteger(d.accessVersion) || (d.accessVersion as number) < 0)
  )
    return "accessVersion hỏng (cần sửa tay)";
  if (typeof d.canManageMembership !== "boolean")
    return "canManageMembership không phải bool";
  if (d.enabled !== true && d.canManageMembership === true)
    return "enabled không bật nhưng canManageMembership = true";
  return null;
}

export function diffRegistry(
  ledger: Ledger | undefined,
  allUsers: Map<string, Record<string, unknown>>,
): RegistryDiff {
  const shapeOk = !!ledger && ledgerShapeOk(ledger);
  const inLedger = new Set(shapeOk ? ledger!.adminUids : []);
  const missingFromLedger: string[] = [];
  const badUsers: RegistryDiff["badUsers"] = [];
  for (const [uid, d] of [...allUsers].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (isActiveAdmin(d) && !inLedger.has(uid)) missingFromLedger.push(uid);
    const reason = badUserReason(d);
    if (reason) badUsers.push({ uid, reason });
  }
  const extraInLedger = [...inLedger]
    .filter((uid) => !isActiveAdmin(allUsers.get(uid)))
    .sort();
  return {
    missingFromLedger,
    extraInLedger,
    badUsers,
    clean:
      shapeOk &&
      !missingFromLedger.length &&
      !extraInLedger.length &&
      !badUsers.length &&
      new Set(ledger!.adminUids).size === ledger!.adminUids.length,
  };
}

/** Chuẩn hóa users lệch (bool thiếu → false; enabled tắt mà canManage true → false); null nếu không cần sửa. */
export function normalizeUser(
  d: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!badUserReason(d)) return null;
  return {
    canManageMembership: false,
    // enabled không phải bool thì rules coi là chưa bật; ghi false cho nhất quán.
    ...(typeof d.enabled === "boolean" ? {} : { enabled: false }),
    accessVersion: version(d) + 1,
  };
}

/** Cảnh báo khi grant (không --admin) cấp lại tài khoản đã thu hồi mà users còn canManageMembership=true cũ. */
export function grantRestoresAdmin(
  existing: Record<string, unknown> | undefined,
  adminFlag: boolean | undefined,
): boolean {
  return (
    !!existing &&
    existing.enabled !== true &&
    existing.canManageMembership === true &&
    !adminFlag
  );
}

export interface RebuildPlan {
  error?: string;
  next?: Ledger;
  fixes: Array<[string, Record<string, unknown>]>;
}

/** Kế hoạch dựng lại sổ: lỗi được TRẢ VỀ (kể cả uid/đường dẫn tài liệu hỏng), không ném. */
export function planRebuild(
  ledger: Ledger | undefined,
  users: Map<string, Record<string, unknown>>,
): RebuildPlan {
  if (ledger && !ledgerShapeOk(ledger))
    return {
      error:
        "accessControl/admins hỏng (adminUids phải là mảng chuỗi, version là số nguyên >= 0); sửa tay tài liệu này rồi chạy lại.",
      fixes: [],
    };
  const fixes: RebuildPlan["fixes"] = [];
  const view = new Map(users);
  for (const [uid, d] of users) {
    try {
      const fix = normalizeUser(d);
      if (fix) {
        fixes.push([uid, fix]);
        view.set(uid, { ...d, ...fix });
      }
    } catch (error) {
      return {
        error: `users/${uid}: ${(error as Error).message}`,
        fixes: [],
      };
    }
  }
  try {
    return {
      next: {
        adminUids: buildRegistry(view),
        version: (ledger?.version ?? 0) + 1,
        lastTargetUid: "registry-rebuild",
        schemaVersion: 1,
      },
      fixes,
    };
  } catch {
    const n = [...view.values()].filter(isActiveAdmin).length;
    return {
      error:
        n === 0
          ? "chưa có quản trị viên đang bật nào (không thể dựng sổ rỗng); cấp quản trị viên đầu tiên bằng `grant --admin`."
          : `có ${n} quản trị viên đang bật, vượt giới hạn ${LEDGER_MAX} của sổ.`,
      fixes: [],
    };
  }
}

/** Mô tả cụ thể vì sao sổ không khớp (sổ hỏng / uid trùng / thiếu-thừa / users lệch). */
export function describeDrift(ledger: Ledger, diff: RegistryDiff): string {
  if (!ledgerShapeOk(ledger))
    return "sổ accessControl/admins hỏng (adminUids phải là mảng chuỗi, version là số nguyên >= 0)";
  const parts: string[] = [];
  if (new Set(ledger.adminUids).size !== ledger.adminUids.length)
    parts.push("uid trùng trong sổ");
  if (diff.missingFromLedger.length)
    parts.push(`thiếu trong sổ: ${diff.missingFromLedger.join(",")}`);
  if (diff.extraInLedger.length)
    parts.push(`thừa trong sổ: ${diff.extraInLedger.join(",")}`);
  if (diff.badUsers.length)
    parts.push(
      `users lệch: ${diff.badUsers.map((b) => `${b.uid} (${b.reason})`).join(", ")}`,
    );
  return `sổ quản trị viên đang lệch với users (${parts.join("; ") || "không rõ"})`;
}

export interface AdminWritePlan {
  error?: string;
  ledgerWrite: Ledger | null;
  warnings: string[];
}

/**
 * Quyết định cách ghi sổ khi users/{uid} đổi từ before sang after (tính trên trạng thái trước + SAU khi ghi).
 * - Không đổi trạng thái admin: luôn cho ghi (cảnh báo nếu sổ thiếu/lệch).
 * - Đổi trạng thái admin: từ chối nếu chưa có sổ (trừ khởi tạo quản trị viên ĐẦU TIÊN khi chưa có admin nào) hoặc
 *   sổ/users đang lệch (phải chạy `registry --rebuild` trước), hoặc kết quả rỗng/quá giới hạn/giao rỗng.
 */
export function planAdminWrite(
  ledger: Ledger | undefined,
  usersBefore: Map<string, Record<string, unknown>>,
  uid: string,
  after: Record<string, unknown>,
): AdminWritePlan {
  const before = usersBefore.get(uid);
  const changes = isActiveAdmin(before) !== isActiveAdmin(after);
  const usersAfter = new Map(usersBefore);
  usersAfter.set(uid, after);
  const fail = (error: string): AdminWritePlan => ({
    error,
    ledgerWrite: null,
    warnings: [],
  });
  if (!ledger) {
    const anyAdmin = [...usersBefore.values()].some(isActiveAdmin);
    if (!changes)
      return {
        ledgerWrite: null,
        warnings: [
          "chưa có sổ accessControl/admins; chạy `registry --rebuild --apply` (sau `registry --verify` và dry-run).",
        ],
      };
    if (!anyAdmin && isActiveAdmin(after))
      return {
        // Khởi tạo: quản trị viên đầu tiên (chưa có admin nào, nên chưa thể rebuild).
        ledgerWrite: {
          adminUids: [uid],
          version: 1,
          lastTargetUid: uid,
          schemaVersion: 1,
        },
        warnings: [
          "đã khởi tạo sổ accessControl/admins với quản trị viên đầu tiên.",
        ],
      };
    return fail(
      anyAdmin
        ? "chưa có sổ accessControl/admins; chạy `registry --verify`, `registry --rebuild` (dry-run) rồi `registry --rebuild --apply` trước khi đổi quyền quản trị."
        : "chưa có quản trị viên nào và thay đổi này không tạo quản trị viên; cấp quản trị viên đầu tiên bằng `grant --admin` trước.",
    );
  }
  const diff = diffRegistry(ledger, usersBefore);
  if (!diff.clean) {
    if (changes)
      return fail(
        `${describeDrift(ledger, diff)}; chạy \`registry --rebuild\` trước khi đổi quyền quản trị.`,
      );
    return {
      ledgerWrite: null,
      warnings: [
        "CẢNH BÁO: sổ quản trị viên đang lệch với users; chạy `registry --verify` rồi `registry --rebuild`.",
      ],
    };
  }
  if (!changes) return { ledgerWrite: null, warnings: [] };
  let next: Ledger | null;
  try {
    next = ledgerAfter(ledger, uid, before, after);
  } catch (error) {
    return fail((error as Error).message);
  }
  // Giao rỗng sau khi ghi: phải còn ít nhất một người vừa ∈ sổ mới vừa đang là quản trị viên trong users mới.
  if (!next || !next.adminUids.some((u) => isActiveAdmin(usersAfter.get(u))))
    return fail("sau thay đổi sẽ không còn quản trị viên nào hoạt động.");
  return { ledgerWrite: next, warnings: [] };
}

export interface DeletePlan {
  ok: boolean;
  /** Lý do chặn (không xóa gì khi còn bất kỳ lý do nào). */
  errors: string[];
  warnings: string[];
  /** Việc sẽ làm (chỉ có nghĩa khi ok). */
  steps: string[];
  uid?: string;
  /** Có hồ sơ users để xóa không (false = chỉ còn tài khoản Auth). */
  hasUserDoc: boolean;
}

/**
 * Kế hoạch xóa HẲN một tài khoản (users + Firebase Auth); thao tác KHÔNG hoàn tác nên chặn chặt:
 * phải tìm thấy Auth; users (nếu có) phải ĐÃ vô hiệu hóa; không phải quản trị viên (users, sổ hoặc canManageMembership);
 * sổ phải khớp users; sau khi xóa vẫn còn quản trị viên hiệu lực nằm trong sổ. Lời mời PENDING chỉ cảnh báo.
 */
export function planDelete(input: {
  authUser: { uid: string } | null;
  userDoc: Record<string, unknown> | undefined;
  ledger: Ledger | undefined;
  allUsers: Map<string, Record<string, unknown>>;
  invite: Record<string, unknown> | undefined;
  nowMs: number;
}): DeletePlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const steps: string[] = [];
  const { authUser, userDoc, ledger, allUsers } = input;
  if (!authUser)
    return {
      ok: false,
      errors: ["Không tìm thấy tài khoản Auth theo email này (có thể đã xóa)."],
      warnings,
      steps,
      hasUserDoc: false,
    };
  const uid = authUser.uid;
  if (userDoc) {
    if (userDoc.enabled === true)
      errors.push(
        "Tài khoản còn đang bật. Vô hiệu hóa trước trong #/users (hoặc lệnh revoke), rồi mới xóa.",
      );
    if (
      isActiveAdmin(userDoc) ||
      userDoc.canManageMembership === true ||
      !!ledger?.adminUids?.includes(uid)
    )
      errors.push(
        "Đây là quản trị viên (users hoặc sổ accessControl/admins). Hạ quyền quản trị trước rồi mới xóa.",
      );
  } else {
    warnings.push(
      "Không có hồ sơ users cho tài khoản này; chỉ xóa tài khoản Firebase Auth.",
    );
  }
  const diff = diffRegistry(ledger, allUsers);
  if (!diff.clean)
    errors.push(
      ledger
        ? `${describeDrift(ledger, diff)}; chạy \`registry --rebuild\` trước khi xóa.`
        : "Chưa có sổ accessControl/admins; chạy `registry --rebuild --apply` trước khi xóa.",
    );
  else {
    const remaining = ledger!.adminUids.filter(
      (u) => u !== uid && isActiveAdmin(allUsers.get(u)),
    );
    if (!remaining.length)
      errors.push("Sau khi xóa sẽ không còn quản trị viên hiệu lực nào.");
  }
  const status = inviteStatusOf(input.invite, input.nowMs);
  if (status === "PENDING")
    // Sau khi xóa users + Auth, người này đăng nhập lại cùng email (uid mới) sẽ NHẬN LẠI quyền qua chính lời mời đang chờ.
    errors.push(
      "Còn lời mời ĐANG CHỜ cho email này. Thu hồi lời mời trong #/users trước: nếu không, người này đăng nhập lại cùng email sẽ nhận lại quyền qua chính lời mời đó.",
    );
  else if (status)
    warnings.push(`Lời mời cho email này ở trạng thái ${status} (không đổi).`);
  if (userDoc)
    steps.push(
      "Xóa hồ sơ users và ghi nhật ký ACCOUNT_DELETED (không có email/tên).",
    );
  else steps.push("Ghi nhật ký ACCOUNT_DELETED (không có email/tên).");
  steps.push(
    "Thu hồi phiên đăng nhập rồi xóa tài khoản Firebase Auth (KHÔNG hoàn tác).",
  );
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    steps,
    uid,
    hasUserDoc: !!userDoc,
  };
}

/**
 * Kiểm lại ngay trước khi xóa (trong giao dịch): trạng thái có thể đã đổi giữa lúc lập kế hoạch và lúc xóa
 * (bật lại, nâng quyền, sổ lệch, lời mời mới...). Trả về lý do chặn hoặc null nếu vẫn hợp lệ.
 */
export function recheckDelete(
  plannedUid: string,
  current: Omit<Parameters<typeof planDelete>[0], "authUser">,
): string | null {
  const again = planDelete({ ...current, authUser: { uid: plannedUid } });
  return again.ok ? null : again.errors.join(" ");
}

function inviteStatusOf(
  invite: Record<string, unknown> | undefined,
  nowMs: number,
): string | null {
  if (!invite) return null;
  if (invite.status === "ACCEPTED" || invite.status === "REVOKED")
    return invite.status;
  if (invite.status !== "PENDING") return null;
  const t = invite.expiresAt as { toMillis?: () => number } | undefined;
  const exp = t && typeof t.toMillis === "function" ? t.toMillis() : null;
  return exp !== null && exp > nowMs ? "PENDING" : "EXPIRED";
}

export type Command =
  | "list"
  | "grant"
  | "create"
  | "revoke"
  | "role"
  | "reset-password"
  | "registry"
  | "delete";
export const COMMANDS: Command[] = [
  "list",
  "registry",
  "grant",
  "create",
  "revoke",
  "role",
  "reset-password",
  "delete",
];
