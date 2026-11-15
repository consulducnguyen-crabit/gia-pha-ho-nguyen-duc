// Quyền chỉ đăng nhập bằng Gmail (không mật khẩu). Quản trị viên ghi sẵn emailGrants/{gmail}; khi thành viên đăng nhập
// Google lần đầu, app nhận quyền MỘT lần: tạo users/{uid} (Chỉ xem) + xóa grant + auditLogs/account-{uid}-1 trong một batch.
// Mọi kiểm tra bảo mật nằm ở firestore.rules (email đã xác minh, nhà cung cấp google.com, đúng @gmail.com).
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { validateAccountName } from "./accountsClient";

export class GmailGrantError extends Error {
  constructor(
    public code: "INVALID_EMAIL" | "FAILED",
    message: string,
  ) {
    super(message);
  }
}

/** Chuẩn hóa Gmail (viết thường). Chỉ nhận @gmail.com, tối đa 64 ký tự, khớp luật rules. */
export function normalizeGmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(email) || email.length > 64)
    throw new GmailGrantError(
      "INVALID_EMAIL",
      "Chỉ nhận địa chỉ Gmail dạng ten@gmail.com (viết đúng địa chỉ Gmail thành viên dùng để đăng nhập).",
    );
  return email;
}

export function buildGrant(input: {
  actorUid: string;
  email: string;
  displayName: string;
}) {
  const name = input.displayName.trim()
    ? validateAccountName(input.displayName)
    : undefined;
  return {
    id: input.email,
    data: {
      email: input.email,
      ...(name ? { displayName: name } : {}),
      createdBy: input.actorUid,
      schemaVersion: 1,
    } as Record<string, unknown>,
  };
}

/** Dữ liệu người nhận quyền ghi theo rules (gmailClaimOk + ACCOUNT_CLAIMED). */
export function buildClaimWrite(input: {
  uid: string;
  email: string;
  grant: { displayName?: unknown; createdBy: string };
}) {
  const name =
    typeof input.grant.displayName === "string" && input.grant.displayName
      ? input.grant.displayName
      : undefined;
  return {
    user: {
      enabled: true,
      roleIds: ["member"],
      canManageMembership: false,
      accessVersion: 1,
      schemaVersion: 1,
      email: input.email,
      ...(name ? { displayName: name } : {}),
      approvedBy: input.grant.createdBy,
      createdVia: "google",
    } as Record<string, unknown>,
    auditId: `account-${input.uid}-1`,
    audit: {
      event: "ACCOUNT_CLAIMED",
      actorUid: input.uid,
      targetUid: input.uid,
      accessVersion: 1,
      schemaVersion: 1,
    } as Record<string, unknown>,
  };
}

const code = (e: unknown) => (e as { code?: string } | null)?.code ?? "";

export async function createGmailGrant(
  db: Firestore,
  actorUid: string,
  input: { email: string; displayName: string },
): Promise<string> {
  const email = normalizeGmail(input.email);
  const g = buildGrant({
    actorUid,
    email,
    displayName: input.displayName,
  });
  try {
    await setDoc(doc(db, "emailGrants", g.id), {
      ...g.data,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    throw new GmailGrantError(
      "FAILED",
      code(e) === "permission-denied"
        ? "Không ghi được quyền (Gmail này có thể đã được ghi sẵn, hoặc bạn không còn quyền quản trị)."
        : "Không ghi được quyền. Kiểm tra mạng rồi thử lại.",
    );
  }
  return email;
}

export async function revokeGmailGrant(
  db: Firestore,
  email: string,
): Promise<void> {
  await deleteDoc(doc(db, "emailGrants", email));
}

export interface PendingGrant {
  email: string;
  displayName: string;
}

export async function listGmailGrants(db: Firestore): Promise<PendingGrant[]> {
  const snap = await getDocsFromServer(
    query(collection(db, "emailGrants"), limit(200)),
  );
  return snap.docs
    .map((d) => ({
      email: d.id,
      displayName:
        typeof d.data().displayName === "string"
          ? (d.data().displayName as string)
          : "",
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Người đã đăng nhập Google nhận quyền đã được ghi sẵn. Trả true khi vừa nhận được quyền; false khi không có grant
 * (tài khoản vẫn "chờ cấp quyền"). Lỗi mạng ném ra để người gọi thử lại.
 */
export async function claimGmailGrant(
  db: Firestore,
  user: { uid: string; email: string | null; emailVerified: boolean },
): Promise<boolean> {
  const email = (user.email ?? "").toLowerCase();
  if (!user.emailVerified || !/^[a-z0-9._%+-]+@gmail\.com$/.test(email))
    return false;
  const gref = doc(db, "emailGrants", email);
  let snap;
  try {
    snap = await getDoc(gref);
  } catch (e) {
    if (code(e) === "permission-denied") return false;
    throw e;
  }
  if (!snap.exists()) return false;
  const g = snap.data() as { displayName?: unknown; createdBy?: unknown };
  if (typeof g.createdBy !== "string") return false;
  const w = buildClaimWrite({
    uid: user.uid,
    email,
    grant: { displayName: g.displayName, createdBy: g.createdBy },
  });
  const batch = writeBatch(db);
  batch.set(doc(db, "users", user.uid), {
    ...w.user,
    approvedAt: serverTimestamp(),
  });
  batch.set(doc(db, "auditLogs", w.auditId), {
    ...w.audit,
    timestamp: serverTimestamp(),
  });
  batch.delete(gref);
  try {
    await batch.commit();
  } catch (e) {
    // Grant của quản trị viên đã mất quyền, hoặc rules từ chối: giữ nguyên "chờ cấp quyền".
    if (code(e) === "permission-denied") return false;
    throw e;
  }
  return true;
}
