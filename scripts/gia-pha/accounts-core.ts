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
    ...(options.admin ? { canManageMembership: true } : {}),
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
    ...(changes.admin === undefined
      ? {}
      : { canManageMembership: changes.admin }),
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

export type Command =
  "list" | "grant" | "create" | "revoke" | "role" | "reset-password";
export const COMMANDS: Command[] = [
  "list",
  "grant",
  "create",
  "revoke",
  "role",
  "reset-password",
];
