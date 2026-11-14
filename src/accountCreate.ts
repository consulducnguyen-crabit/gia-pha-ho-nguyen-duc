// Quản trị viên tạo tài khoản đăng nhập ngay trong app (gói Spark, không Cloud Functions).
// 1) Tạo người dùng Auth bằng một Firebase app PHỤ (bộ nhớ tạm) để không làm quản trị viên bị đăng xuất.
// 2) Ghi users/{uid} (chỉ xem, mustChangePassword) + auditLogs/account-{uid}-1 trong MỘT batch, thỏa firestore.rules.
// Số điện thoại hoặc email có thể đã bị người lạ đăng ký trước (đăng ký Email/Mật khẩu của Firebase là công khai):
// khi báo "đã tồn tại" thì thử đăng nhập bằng đúng mật khẩu vừa sinh; vào được ⇒ chính ta đã tạo ở lần thử trước
// (an toàn để hoàn tất/thử lại), không vào được ⇒ báo cần xử lý bằng script quản trị.
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  initializeAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  doc,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { validateAccountName } from "./accountsClient";
import { normalizeVnPhone, phoneToEmail } from "./phoneLogin";

export type LoginKind = "phone" | "email";
export const PASSWORD_LENGTH = 10;
// Bỏ ký tự dễ nhầm khi đọc/nhắn qua Zalo: 0 O o, 1 l I.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Mật khẩu ngẫu nhiên bằng crypto (loại bỏ thiên lệch modulo bằng lấy mẫu từ chối). */
export function generatePassword(
  length = PASSWORD_LENGTH,
  rand: (n: number) => Uint8Array = (n) =>
    globalThis.crypto.getRandomValues(new Uint8Array(n)),
): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const b of rand(length * 2)) {
      if (b < limit && out.length < length)
        out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

export type CreateErrorCode =
  | "INVALID_IDENTIFIER"
  | "ALREADY_EXISTS"
  | "TAKEN_OUTSIDE"
  | "AUTH_FAILED"
  | "GRANT_FAILED";

export class CreateAccountError extends Error {
  constructor(
    public code: CreateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Email đăng nhập thật của ô nhập: số điện thoại → email ngầm; Email → viết thường. Không hợp lệ thì ném lỗi. */
export function loginEmailFor(kind: LoginKind, value: string): string {
  if (kind === "phone") {
    const email = phoneToEmail(value);
    if (!email)
      throw new CreateAccountError(
        "INVALID_IDENTIFIER",
        "Số điện thoại không hợp lệ. Nhập số di động Việt Nam 10 chữ số, ví dụ 0914222987.",
      );
    return email;
  }
  const email = value.trim().toLowerCase();
  if (
    email.length < 5 ||
    email.length > 254 ||
    !/^[!-~]+@[!-~]+\.[!-~]+$/.test(email) ||
    email.endsWith("@gp.nguyenduc")
  )
    throw new CreateAccountError(
      "INVALID_IDENTIFIER",
      "Email không hợp lệ. Dùng tab Điện thoại cho thành viên chưa có email.",
    );
  return email;
}

/** Dữ liệu ghi theo firestore.rules (adminCreateOk + accountAuditOk). Hàm thuần để kiểm thử. */
export function buildCreateWrite(input: {
  actorUid: string;
  targetUid: string;
  email: string;
  kind: LoginKind;
  displayName: string;
}) {
  const name = input.displayName.trim()
    ? validateAccountName(input.displayName)
    : undefined;
  return {
    userId: input.targetUid,
    user: {
      enabled: true,
      roleIds: ["member"],
      canManageMembership: false,
      accessVersion: 1,
      schemaVersion: 1,
      email: input.email,
      ...(name ? { displayName: name } : {}),
      approvedBy: input.actorUid,
      createdVia: input.kind,
      mustChangePassword: true,
    } as Record<string, unknown>,
    auditId: `account-${input.targetUid}-1`,
    audit: {
      event: "ACCOUNT_CREATED",
      actorUid: input.actorUid,
      targetUid: input.targetUid,
      accessVersion: 1,
      schemaVersion: 1,
    } as Record<string, unknown>,
  };
}

const code = (e: unknown) => (e as { code?: string } | null)?.code ?? "";

export interface CreatedAccount {
  uid: string;
  email: string;
  /** Số điện thoại 10 chữ số (khi tạo theo điện thoại) để hiển thị cho quản trị viên. */
  phone: string | null;
  password: string;
}

/**
 * Tạo tài khoản Auth + hồ sơ users. `password` do người gọi giữ giữa các lần thử để thử lại an toàn
 * (Auth đã tạo nhưng ghi Firestore lỗi ⇒ lần sau đăng nhập lại bằng đúng mật khẩu đó rồi ghi tiếp).
 */
export async function createLoginAccount(
  db: Firestore,
  app: FirebaseApp,
  emulator: boolean,
  actorUid: string,
  input: {
    kind: LoginKind;
    value: string;
    displayName: string;
    password: string;
  },
): Promise<CreatedAccount> {
  const email = loginEmailFor(input.kind, input.value);
  // Kiểm tên trước khi tạo gì lên Auth.
  buildCreateWrite({
    actorUid,
    targetUid: "x",
    email,
    kind: input.kind,
    displayName: input.displayName,
  });
  const temp = initializeApp(app.options, `account-create-${Date.now()}`);
  try {
    const tempAuth = initializeAuth(temp, { persistence: inMemoryPersistence });
    if (emulator)
      connectAuthEmulator(tempAuth, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
    let uid: string;
    try {
      uid = (
        await createUserWithEmailAndPassword(tempAuth, email, input.password)
      ).user.uid;
    } catch (e) {
      if (code(e) !== "auth/email-already-in-use")
        throw new CreateAccountError(
          "AUTH_FAILED",
          code(e) === "auth/weak-password"
            ? "Mật khẩu quá yếu."
            : "Không tạo được tài khoản đăng nhập. Kiểm tra mạng rồi thử lại.",
        );
      try {
        uid = (
          await signInWithEmailAndPassword(tempAuth, email, input.password)
        ).user.uid;
      } catch {
        throw new CreateAccountError(
          "TAKEN_OUTSIDE",
          "Số điện thoại/email này đã có tài khoản đăng nhập không do lần tạo này sinh ra (đã tạo trước đó hoặc bị người khác đăng ký trước). Nhờ người có máy quản trị chạy gia-pha:accounts để đặt lại mật khẩu hoặc xóa tài khoản đó.",
        );
      }
    }
    await signOut(tempAuth);
    const w = buildCreateWrite({
      actorUid,
      targetUid: uid,
      email,
      kind: input.kind,
      displayName: input.displayName,
    });
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "users", w.userId), {
        ...w.user,
        approvedAt: serverTimestamp(),
      });
      batch.set(doc(db, "auditLogs", w.auditId), {
        ...w.audit,
        timestamp: serverTimestamp(),
      });
      await batch.commit();
    } catch (e) {
      throw new CreateAccountError(
        "GRANT_FAILED",
        code(e) === "permission-denied"
          ? "Đã tạo tài khoản đăng nhập nhưng chưa cấp quyền được (có thể tài khoản này đã có hồ sơ, hoặc bạn không còn quyền quản trị). Bấm Thử lại; nếu vẫn lỗi hãy báo người quản trị hệ thống."
          : "Đã tạo tài khoản đăng nhập nhưng chưa ghi được hồ sơ. Kiểm tra mạng rồi bấm Thử lại.",
      );
    }
    return {
      uid,
      email,
      phone: input.kind === "phone" ? normalizeVnPhone(input.value) : null,
      password: input.password,
    };
  } finally {
    await deleteApp(temp).catch(() => undefined);
  }
}
