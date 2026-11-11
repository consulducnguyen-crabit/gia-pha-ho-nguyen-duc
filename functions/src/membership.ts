import { createHash, randomBytes } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import {
  Timestamp,
  type Firestore,
  type DocumentData,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

const fail = (
  code: ConstructorParameters<typeof HttpsError>[0],
  message: string,
): never => {
  throw new HttpsError(code, message);
};
function input(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    return fail("invalid-argument", "Thông tin yêu cầu không hợp lệ.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max)
    return fail("invalid-argument", "Thông tin yêu cầu không hợp lệ.");
  return value;
}
const emailKey = (value: string) => value.trim().toLowerCase();
function version(data?: DocumentData): number {
  // Legacy documents may omit the field; explicit null/invalid values are closed.
  const result = data?.accessVersion === undefined ? 0 : data.accessVersion;
  if (
    !Number.isSafeInteger(result) ||
    result < 0 ||
    result >= Number.MAX_SAFE_INTEGER
  )
    return fail("failed-precondition", "Phiên bản quyền không hợp lệ.");
  return result;
}
function manager(data?: DocumentData) {
  if (
    data?.enabled !== true ||
    data?.canManageMembership !== true ||
    (data.schemaVersion !== undefined && data.schemaVersion !== 1)
  )
    fail("permission-denied", "Bạn không có quyền quản lý tài khoản.");
  version(data);
}
function ordinary(data?: DocumentData) {
  if (
    data &&
    ((data.schemaVersion !== undefined && data.schemaVersion !== 1) ||
      typeof data.enabled !== "boolean" ||
      !Array.isArray(data.roleIds) ||
      data.roleIds.length !== 1 ||
      data.roleIds[0] !== "member" ||
      (data.canManageMembership !== undefined &&
        data.canManageMembership !== false) ||
      ["canReviewChanges", "canReviewLineage"].some(
        (capability) =>
          data[capability] !== undefined && data[capability] !== false,
      ))
  )
    fail(
      "permission-denied",
      "Không thể thay đổi tài khoản đặc quyền qua luồng này.",
    );
}
function invitationId(value: unknown) {
  const id = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(id))
    fail("invalid-argument", "Mã lời mời không hợp lệ.");
  return id;
}

export function membershipService(db: Firestore, auth: Auth) {
  async function actor(uid?: string) {
    if (!uid) return fail("unauthenticated", "Vui lòng đăng nhập.");
    try {
      const user = await auth.getUser(uid);
      if (user.disabled || !user.emailVerified || !user.email)
        return fail(
          "permission-denied",
          "Cần tài khoản đăng nhập đã xác minh email.",
        );
      return { uid, email: emailKey(user.email) };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      return fail(
        "permission-denied",
        "Không thể xác minh tài khoản đăng nhập.",
      );
    }
  }
  return {
    async createInvitation(uid: string | undefined, raw: unknown) {
      const data = input(raw, ["email"]);
      const email = emailKey(text(data.email, 254));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return fail("invalid-argument", "Email không hợp lệ.");
      const caller = await actor(uid);
      // Authorize before looking up another identity to avoid an account oracle.
      manager((await db.doc(`users/${caller.uid}`).get()).data());
      const target = await auth
        .getUserByEmail(email)
        .catch(() =>
          fail(
            "failed-precondition",
            "Tài khoản đăng nhập của người được mời chưa sẵn sàng.",
          ),
        );
      if (target.disabled || target.uid === caller.uid)
        return fail("failed-precondition", "Không thể mời tài khoản này.");
      const token = randomBytes(32).toString("base64url");
      const id = createHash("sha256").update(token).digest("hex");
      const invitation = db.doc(`invitations/${id}`);
      await db.runTransaction(async (tx) => {
        const issuer = await tx.get(db.doc(`users/${caller.uid}`));
        const account = await tx.get(db.doc(`users/${target.uid}`));
        manager(issuer.data());
        ordinary(account.data());
        if (account.data()?.enabled === true)
          fail("already-exists", "Tài khoản đã được cấp quyền.");
        const now = Timestamp.now();
        tx.create(invitation, {
          targetUid: target.uid,
          email,
          status: "PENDING",
          issuerUid: caller.uid,
          issuerAccessVersion: version(issuer.data()),
          targetAccessVersion: version(account.data()),
          createdAt: now,
          expiresAt: Timestamp.fromMillis(now.toMillis() + 48 * 60 * 60 * 1000),
          schemaVersion: 1,
        });
        tx.create(db.doc(`auditLogs/invitation-created-${id}`), {
          event: "INVITATION_CREATED",
          actorUid: caller.uid,
          targetUid: target.uid,
          invitationId: id,
          timestamp: now,
          schemaVersion: 1,
        });
      });
      return { invitationId: id, token };
    },

    async acceptInvitation(uid: string | undefined, raw: unknown) {
      const data = input(raw, ["token"]);
      const token = text(data.token, 43);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        return fail("invalid-argument", "Mã lời mời không hợp lệ.");
      const caller = await actor(uid);
      const id = createHash("sha256").update(token).digest("hex");
      await db.runTransaction(async (tx) => {
        const invitation = db.doc(`invitations/${id}`);
        const record = (await tx.get(invitation)).data();
        if (
          !record ||
          record.schemaVersion !== 1 ||
          record.status !== "PENDING" ||
          typeof record.issuerUid !== "string" ||
          !record.issuerUid ||
          record.issuerUid.length > 128 ||
          record.issuerUid.includes("/") ||
          !Number.isSafeInteger(record.issuerAccessVersion) ||
          record.issuerAccessVersion < 0 ||
          !Number.isSafeInteger(record.targetAccessVersion) ||
          record.targetAccessVersion < 0 ||
          record.targetUid !== caller.uid ||
          record.email !== caller.email ||
          !(record.expiresAt instanceof Timestamp) ||
          record.expiresAt.toMillis() <= Date.now()
        )
          fail(
            "failed-precondition",
            "Lời mời không còn hợp lệ hoặc không dành cho bạn.",
          );
        const issuer = await tx.get(db.doc(`users/${record!.issuerUid}`));
        const account = db.doc(`users/${caller.uid}`);
        const current = await tx.get(account);
        manager(issuer.data());
        ordinary(current.data());
        if (
          version(issuer.data()) !== record!.issuerAccessVersion ||
          version(current.data()) !== record!.targetAccessVersion ||
          current.data()?.enabled === true
        )
          fail(
            "failed-precondition",
            "Lời mời không còn phù hợp với phiên bản quyền hiện tại.",
          );
        const now = Timestamp.now();
        if (record!.expiresAt.toMillis() <= now.toMillis())
          fail("failed-precondition", "Lời mời đã hết hạn.");
        tx.set(account, {
          enabled: true,
          roleIds: ["member"],
          accessVersion: version(current.data()) + 1,
          approvedBy: record!.issuerUid,
          approvedAt: now,
          schemaVersion: 1,
        });
        tx.update(invitation, {
          status: "ACCEPTED",
          acceptedBy: caller.uid,
          acceptedAt: now,
        });
        tx.create(db.doc(`auditLogs/invitation-accepted-${id}`), {
          event: "INVITATION_ACCEPTED",
          actorUid: caller.uid,
          targetUid: caller.uid,
          invitationId: id,
          timestamp: now,
          schemaVersion: 1,
        });
      });
      return { accepted: true };
    },

    async revokeInvitation(uid: string | undefined, raw: unknown) {
      const id = invitationId(input(raw, ["invitationId"]).invitationId);
      const caller = await actor(uid);
      return db.runTransaction(async (tx) => {
        const issuer = await tx.get(db.doc(`users/${caller.uid}`));
        const invitation = db.doc(`invitations/${id}`);
        const record = await tx.get(invitation);
        manager(issuer.data());
        if (!record.exists) return fail("not-found", "Không tìm thấy lời mời.");
        if (record.data()?.status !== "PENDING") return { changed: false };
        const now = Timestamp.now();
        tx.update(invitation, {
          status: "REVOKED",
          revokedBy: caller.uid,
          revokedAt: now,
        });
        tx.create(db.doc(`auditLogs/invitation-revoked-${id}`), {
          event: "INVITATION_REVOKED",
          actorUid: caller.uid,
          invitationId: id,
          timestamp: now,
          schemaVersion: 1,
        });
        return { changed: true };
      });
    },

    async disableMembership(uid: string | undefined, raw: unknown) {
      const data = input(raw, ["targetUid", "requestId"]);
      const targetUid = text(data.targetUid, 128);
      const requestId = text(data.requestId, 36);
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          requestId,
        )
      )
        return fail("invalid-argument", "Mã yêu cầu không hợp lệ.");
      if (targetUid.includes("/"))
        return fail("invalid-argument", "Mã tài khoản không hợp lệ.");
      const caller = await actor(uid);
      if (targetUid === caller.uid)
        return fail(
          "permission-denied",
          "Không tự thay đổi quyền quản trị qua luồng này.",
        );
      return db.runTransaction(async (tx) => {
        const issuer = await tx.get(db.doc(`users/${caller.uid}`));
        const target = db.doc(`users/${targetUid}`);
        const current = await tx.get(target);
        const audit = db.doc(`auditLogs/membership-disabled-${requestId}`);
        const receipt = await tx.get(audit);
        manager(issuer.data());
        if (receipt.exists) {
          if (
            receipt.data()?.actorUid !== caller.uid ||
            receipt.data()?.targetUid !== targetUid
          )
            return fail(
              "invalid-argument",
              "Mã yêu cầu đã được dùng cho thao tác khác.",
            );
          return { changed: false };
        }
        ordinary(current.data());
        // Create a tombstone even for a pending account, invalidating its invitations.
        const next = version(current.data()) + 1;
        const now = Timestamp.now();
        tx.set(target, {
          enabled: false,
          roleIds: ["member"],
          accessVersion: next,
          disabledBy: caller.uid,
          disabledAt: now,
          schemaVersion: 1,
        });
        tx.create(audit, {
          event: "MEMBERSHIP_DISABLED",
          actorUid: caller.uid,
          targetUid,
          accessVersion: next,
          timestamp: now,
          schemaVersion: 1,
        });
        return { changed: true };
      });
    },
  };
}
