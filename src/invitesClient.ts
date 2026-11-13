// Lời mời thành viên bằng email qua Firestore client SDK + firestore.rules (PR-A/D). Gói Spark, không Cloud Functions.
// Lời mời CHỈ cấp "Chỉ xem" (VIEWER). Phần dựng dữ liệu (build*) là hàm thuần để kiểm thử.
//  - createInvite: accountInvites/{email viết thường} + auditLogs/invite-{nonce} (inviteKey = sha256(email), không có email).
//  - revokeInvite: PENDING -> REVOKED + auditLogs/invite-{nonce}-revoked-{uid}.
//  - acceptInvitation: người được mời tự tạo users/{uid} + đánh dấu lời mời ACCEPTED + auditLogs/account-{uid}-1.
import {
  Timestamp,
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { SERVER_TIME, validateAccountName } from "./accountsClient";

export { SERVER_TIME };
export type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export type InviteErrorCode =
  | "INVALID_EMAIL"
  | "INVALID_NAME"
  | "ACTIVE_INVITE"
  | "NO_INVITE"
  | "INVITE_UNUSABLE"
  | "UNVERIFIED"
  | "BAD_INVITE";

export class InviteError extends Error {
  constructor(
    public code: InviteErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 86400000;
// Rules đòi expiresAt <= request.time + 7 ngày. Dùng 6 ngày 22 giờ để chịu được đồng hồ máy khách nhanh tới ~2 giờ;
// đồng hồ chậm chỉ làm lời mời ngắn hơn một chút.
export const INVITE_TTL_MS = 6 * DAY + 22 * 3600000;
export const INVITE_LIST_LIMIT = 100;

/** Email chuẩn hóa: viết thường, chỉ ASCII như rules; ném InviteError nếu không hợp lệ. */
export function normalizeInviteEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)
  )
    throw new InviteError(
      "INVALID_EMAIL",
      "Email không hợp lệ (chỉ dùng chữ không dấu, số và . _ % + - trước @).",
    );
  return email;
}

/** sha256 (hex thường) của khóa email: khớp inviteKeyHash(...).lower() trong rules. */
export async function inviteKeyHash(emailKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(emailKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface InviteRecord {
  email: string;
  displayName?: string;
  status: string;
  nonce: string;
  createdBy: string;
  createdAt?: unknown;
  expiresAt?: unknown;
}

const millis = (v: unknown): number | null => {
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const t = v as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : null;
};

/** Trạng thái hiển thị: PENDING quá hạn thành EXPIRED. */
export function inviteStatus(
  data: { status?: unknown; expiresAt?: unknown } | undefined,
  nowMs: number,
): InviteStatus | null {
  if (!data) return null;
  if (data.status === "ACCEPTED" || data.status === "REVOKED")
    return data.status;
  if (data.status !== "PENDING") return null;
  const exp = millis(data.expiresAt);
  return exp !== null && exp > nowMs ? "PENDING" : "EXPIRED";
}

export interface InviteCreate {
  emailKey: string;
  invite: Record<string, unknown>;
  auditId: string;
  audit: Record<string, unknown>;
}

/** Dựng dữ liệu tạo lời mời đúng inviteCreateOk + inviteAuditOk. nonce và nowMs truyền vào để kiểm thử. */
export async function buildInvite(input: {
  actorUid: string;
  email: string;
  displayName?: string;
  nonce: string;
  nowMs: number;
}): Promise<InviteCreate> {
  const emailKey = normalizeInviteEmail(input.email);
  const name = input.displayName?.trim()
    ? validateInviteName(input.displayName)
    : undefined;
  if (!/^[A-Za-z0-9-]{36}$/.test(input.nonce))
    throw new InviteError("BAD_INVITE", "Mã lời mời không hợp lệ.");
  return {
    emailKey,
    invite: {
      email: emailKey,
      role: "VIEWER",
      ...(name ? { displayName: name } : {}),
      status: "PENDING",
      nonce: input.nonce,
      createdBy: input.actorUid,
      createdAt: SERVER_TIME,
      expiresAt: Timestamp.fromMillis(input.nowMs + INVITE_TTL_MS),
      schemaVersion: 1,
    },
    auditId: `invite-${input.nonce}`,
    audit: {
      event: "INVITE_CREATED",
      actorUid: input.actorUid,
      nonce: input.nonce,
      inviteKey: await inviteKeyHash(emailKey),
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
  };
}

function validateInviteName(value: string): string {
  try {
    return validateAccountName(value);
  } catch {
    throw new InviteError(
      "INVALID_NAME",
      "Tên hiển thị phải dài 1–120 ký tự và không chứa ký tự điều khiển.",
    );
  }
}

/** Dựng dữ liệu thu hồi lời mời PENDING. */
export async function buildRevoke(input: {
  actorUid: string;
  invite: { email: string; nonce: string };
}) {
  const emailKey = normalizeInviteEmail(input.invite.email);
  return {
    emailKey,
    patch: {
      status: "REVOKED",
      revokedBy: input.actorUid,
      revokedAt: SERVER_TIME,
    },
    auditId: `invite-${input.invite.nonce}-revoked-${input.actorUid}`,
    audit: {
      event: "INVITE_REVOKED",
      actorUid: input.actorUid,
      nonce: input.invite.nonce,
      inviteKey: await inviteKeyHash(emailKey),
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
  };
}

/** Dựng dữ liệu nhận lời mời đúng acceptOk (keys cố định, email lấy từ token, displayName từ lời mời). */
export function buildAcceptance(input: {
  uid: string;
  email: string;
  emailVerified: boolean;
  invite: Record<string, unknown> | undefined;
  nowMs: number;
}) {
  if (!input.emailVerified)
    throw new InviteError(
      "UNVERIFIED",
      "Email chưa được xác minh. Hãy đăng nhập bằng liên kết gửi qua email hoặc bằng Google.",
    );
  const emailKey = normalizeInviteEmail(input.email);
  const inv = input.invite;
  if (!inv)
    throw new InviteError("NO_INVITE", "Chưa có lời mời nào cho email này.");
  const status = inviteStatus(inv, input.nowMs);
  if (status !== "PENDING" || inv.role !== "VIEWER")
    throw new InviteError(
      "INVITE_UNUSABLE",
      "Lời mời đã hết hạn, bị thu hồi hoặc đã dùng. Nếu bạn chắc là chưa, hãy kiểm tra đồng hồ và múi giờ của thiết bị, rồi nhờ quản trị viên mời lại.",
    );
  if (
    typeof inv.nonce !== "string" ||
    typeof inv.createdBy !== "string" ||
    inv.email !== emailKey
  )
    throw new InviteError("BAD_INVITE", "Lời mời không hợp lệ.");
  const hasName = typeof inv.displayName === "string";
  return {
    emailKey,
    user: {
      enabled: true,
      roleIds: ["member"],
      canManageMembership: false,
      canReviewChanges: false,
      accessVersion: 1,
      schemaVersion: 1,
      email: emailKey,
      ...(hasName ? { displayName: inv.displayName } : {}),
      approvedBy: inv.createdBy,
      approvedAt: SERVER_TIME,
      invitationNonce: inv.nonce,
    },
    invitePatch: {
      status: "ACCEPTED",
      acceptedBy: input.uid,
      acceptedAt: SERVER_TIME,
    },
    auditId: `account-${input.uid}-1`,
    audit: {
      event: "INVITATION_ACCEPTED",
      actorUid: input.uid,
      targetUid: input.uid,
      accessVersion: 1,
      invitationNonce: inv.nonce,
      timestamp: SERVER_TIME,
      schemaVersion: 1,
    },
  };
}

const withTime = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v === SERVER_TIME ? serverTimestamp() : v,
    ]),
  );

/** Tạo (hoặc ghi đè lời mời hết hạn/đã thu hồi/đã dùng). Lời mời còn hiệu lực bị từ chối phía client. */
export async function createInvite(
  db: Firestore,
  actorUid: string,
  input: { email: string; displayName?: string },
) {
  const nonce = crypto.randomUUID();
  const built = await buildInvite({
    actorUid,
    ...input,
    nonce,
    nowMs: Date.now(),
  });
  const ref = doc(db, "accountInvites", built.emailKey);
  const existing = await getDocFromServer(ref);
  if (inviteStatus(existing.data(), Date.now()) === "PENDING")
    throw new InviteError(
      "ACTIVE_INVITE",
      "Email này đang có lời mời còn hiệu lực. Thu hồi lời mời cũ hoặc đợi hết hạn.",
    );
  const batch = writeBatch(db);
  batch.set(ref, withTime(built.invite));
  batch.set(doc(db, "auditLogs", built.auditId), withTime(built.audit));
  await batch.commit();
  return {
    emailKey: built.emailKey,
    expiresAtMs: (built.invite.expiresAt as Timestamp).toMillis(),
  };
}

export async function revokeInvite(
  db: Firestore,
  actorUid: string,
  invite: { email: string; nonce: string },
) {
  const built = await buildRevoke({ actorUid, invite });
  const batch = writeBatch(db);
  batch.update(
    doc(db, "accountInvites", built.emailKey),
    withTime(built.patch),
  );
  batch.set(doc(db, "auditLogs", built.auditId), withTime(built.audit));
  await batch.commit();
}

/**
 * Đọc lời mời của chính mình (cần email đã xác minh). status null = không có lời mời hoặc không được đọc (rules từ chối);
 * lỗi mạng/khác được TRẢ VỀ trong error để giao diện báo đúng nguyên nhân (không nuốt thành "chưa có lời mời").
 */
export async function readOwnInvite(
  db: Firestore,
  user: { email: string | null; emailVerified: boolean },
): Promise<{
  status: InviteStatus | null;
  data: Record<string, unknown> | undefined;
  error?: unknown;
}> {
  if (!user.email || !user.emailVerified)
    return { status: null, data: undefined };
  try {
    const snap = await getDocFromServer(
      doc(db, "accountInvites", normalizeInviteEmail(user.email)),
    );
    return { status: inviteStatus(snap.data(), Date.now()), data: snap.data() };
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "permission-denied")
      return { status: null, data: undefined };
    return { status: null, data: undefined, error };
  }
}

export async function acceptInvitation(
  db: Firestore,
  user: { uid: string; email: string | null; emailVerified: boolean },
) {
  if (!user.email)
    throw new InviteError("UNVERIFIED", "Tài khoản đăng nhập không có email.");
  const key = normalizeInviteEmail(user.email);
  const snap = await getDocFromServer(doc(db, "accountInvites", key)).catch(
    () => undefined,
  );
  const built = buildAcceptance({
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    invite: snap?.data(),
    nowMs: Date.now(),
  });
  const batch = writeBatch(db);
  batch.set(doc(db, "users", user.uid), withTime(built.user));
  batch.update(
    doc(db, "accountInvites", built.emailKey),
    withTime(built.invitePatch),
  );
  batch.set(doc(db, "auditLogs", built.auditId), withTime(built.audit));
  await batch.commit();
}

/** Danh sách lời mời, mới nhất trước, tối đa 100 (chỉ quản trị viên trong sổ đọc được). */
export async function listInvites(db: Firestore) {
  const snap = await getDocsFromServer(
    query(
      collection(db, "accountInvites"),
      orderBy("createdAt", "desc"),
      limit(INVITE_LIST_LIMIT),
    ),
  );
  return snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));
}

/** Thông báo tiếng Việt. context cho biết thao tác để lời giải thích đúng nguyên nhân thường gặp. */
export function inviteErrorMessage(
  error: unknown,
  context: "create" | "revoke" | "accept" | "list" = "create",
): string {
  if (error instanceof InviteError) return error.message;
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "permission-denied") {
    if (context === "accept")
      return "Không nhận được lời mời: lời mời đã hết hạn, bị thu hồi hoặc đã dùng, email chưa được xác minh, tài khoản này đã có hồ sơ, hoặc người mời không còn là quản trị viên. Hãy nhờ quản trị viên mời lại.";
    if (context === "revoke")
      return "Không thu hồi được: lời mời đã đổi trạng thái hoặc quyền của bạn đã thay đổi. Hãy tải lại và thử lại.";
    if (context === "list")
      return "Không tải được danh sách lời mời. Kiểm tra quyền quản trị và sổ quản trị.";
    return "Không tạo được lời mời: lời mời cũ còn hiệu lực hoặc quyền của bạn đã thay đổi. Hãy tải lại và thử lại.";
  }
  if (code === "not-found")
    return "Không tìm thấy lời mời. Hãy tải lại và thử lại.";
  if (code === "aborted" || code === "failed-precondition")
    return "Dữ liệu vừa được người khác thay đổi. Hãy tải lại và thử lại.";
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  return "Không hoàn tất được thao tác. Hãy tải lại và thử lại.";
}
