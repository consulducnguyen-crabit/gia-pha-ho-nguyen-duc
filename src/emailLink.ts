// Đăng nhập không mật khẩu bằng liên kết gửi qua email (Firebase email-link sign-in, miễn phí, không cần Blaze).
// HashRouter: URL tiếp tục là origin + pathname (KHÔNG có hash); Firebase nối ?apiKey=…&oobCode=… vào URL đó.
// Liên kết được chụp lại và làm sạch khỏi URL NGAY khi trang tải (capturePendingLink), độc lập trạng thái đăng nhập.
import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  updatePassword,
  type Auth,
} from "firebase/auth";

/** Khóa localStorage tạm ({email, at}) để hoàn tất đăng nhập trên cùng thiết bị; quá 1 giờ hoặc khi xong/hỏng thì xóa. */
export const EMAIL_LINK_KEY = "gia-pha:email-link-pending";
export const STORED_EMAIL_TTL_MS = 60 * 60 * 1000;
/** Thời gian chờ phía client giữa các lần gửi liên kết tới cùng một email (Firebase còn có hạn mức riêng). */
export const SEND_COOLDOWN_MS = 60 * 1000;

export function actionCodeSettings(loc: { origin: string; pathname: string }) {
  return { url: `${loc.origin}${loc.pathname}`, handleCodeInApp: true };
}

/** URL sau khi bỏ tham số oobCode/apiKey/mode/lang nhưng giữ phần hash của router. */
export function cleanedUrl(loc: {
  origin: string;
  pathname: string;
  hash: string;
}) {
  return `${loc.origin}${loc.pathname}${loc.hash}`;
}

export function normalizeLinkEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length < 5 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new Error("Email không hợp lệ.");
  return email;
}

/** Số mili giây còn phải chờ trước khi được gửi lại (0 nếu được phép). */
export function cooldownRemaining(
  lastMs: number | undefined,
  nowMs: number,
  windowMs = SEND_COOLDOWN_MS,
) {
  return lastMs === undefined ? 0 : Math.max(0, lastMs + windowMs - nowMs);
}

/** Chuỗi ngẫu nhiên >= 32 ký tự (mặc định 40) bằng crypto.getRandomValues; không lưu, không hiển thị. */
export function randomSecret(length = 40): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // b % 66 lệch phân phối rất nhỏ; với 40 ký tự vẫn dư xa 200 bit entropy.
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function parseStoredEmail(raw: string | null, nowMs: number): string {
  if (!raw) return "";
  try {
    const v = JSON.parse(raw) as { email?: unknown; at?: unknown };
    if (
      typeof v.email === "string" &&
      typeof v.at === "number" &&
      nowMs - v.at >= 0 &&
      nowMs - v.at <= STORED_EMAIL_TTL_MS
    )
      return v.email;
  } catch {
    /* hỏng: coi như không có */
  }
  return "";
}

export const clearStoredEmail = () => {
  try {
    localStorage.removeItem(EMAIL_LINK_KEY);
  } catch {
    /* bỏ qua: trình duyệt chặn localStorage */
  }
};
export const storedEmail = (): string => {
  try {
    const email = parseStoredEmail(
      localStorage.getItem(EMAIL_LINK_KEY),
      Date.now(),
    );
    if (!email) clearStoredEmail(); // hết hạn hoặc hỏng
    return email;
  } catch {
    return "";
  }
};

const lastSent = new Map<string, number>();
export class EmailLinkError extends Error {
  constructor(
    public code: "client/cooldown" | "client/password-neutralize-failed",
    message: string,
    public waitMs = 0,
  ) {
    super(message);
  }
}

/** Gửi liên kết đăng nhập; chỉ lưu email vào localStorage khi chính người đăng nhập tự gửi (cùng thiết bị). */
export async function sendLoginLink(
  auth: Auth,
  email: string,
  options: { remember: boolean },
) {
  const address = normalizeLinkEmail(email);
  const wait = cooldownRemaining(lastSent.get(address), Date.now());
  if (wait > 0)
    throw new EmailLinkError(
      "client/cooldown",
      `Vừa gửi liên kết tới email này. Vui lòng đợi ${Math.ceil(wait / 1000)} giây rồi gửi lại.`,
      wait,
    );
  await sendSignInLinkToEmail(auth, address, actionCodeSettings(location));
  lastSent.set(address, Date.now());
  if (options.remember) {
    try {
      localStorage.setItem(
        EMAIL_LINK_KEY,
        JSON.stringify({ email: address, at: Date.now() }),
      );
    } catch {
      /* bỏ qua */
    }
  }
  return address;
}

// ---- Liên kết đang chờ xử lý (cấp App, độc lập trạng thái đăng nhập) ----
let pendingHref = "";
/** Đọc liên kết từ URL (nếu có), làm sạch oobCode/apiKey khỏi thanh địa chỉ NGAY và giữ href trong bộ nhớ. Idempotent. */
export function capturePendingLink(auth: Auth): string {
  if (!pendingHref && isSignInWithEmailLink(auth, location.href)) {
    pendingHref = location.href;
    history.replaceState(null, "", cleanedUrl(location));
  }
  return pendingHref;
}
export const getPendingLink = () => pendingHref;
export const consumePendingLink = () => {
  pendingHref = "";
};
/** Đặt lại liên kết khi hoàn tất thất bại nhưng thử lại được (email sai, mất mạng). */
export const restorePendingLink = (href: string) => {
  pendingHref = href;
};

/**
 * Hoàn tất đăng nhập bằng liên kết rồi VÔ HIỆU mật khẩu có thể đã được kẻ khác đăng ký trước cho cùng email
 * ("pre-hijacking"): người vừa chứng minh sở hữu hộp thư nên đặt mật khẩu ngẫu nhiên không ai biết (cũng thu hồi
 * refresh token cũ). Lỗi bước này KHÔNG bị nuốt: đăng xuất và báo thử lại (an toàn trước tiện).
 */
export async function completeLoginLink(
  auth: Auth,
  email: string,
  href: string,
) {
  const result = await signInWithEmailLink(
    auth,
    normalizeLinkEmail(email),
    href,
  );
  try {
    await updatePassword(result.user, randomSecret());
  } catch {
    await signOut(auth).catch(() => {});
    throw new EmailLinkError(
      "client/password-neutralize-failed",
      "Không hoàn tất được bước bảo vệ tài khoản nên đã đăng xuất. Hãy gửi liên kết mới và thử lại.",
    );
  }
  clearStoredEmail();
  return result;
}

/** Mã lỗi mà liên kết coi như đã hỏng/hết hạn (không thử lại được): xóa href và email tạm. */
export const isDeadLinkError = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code ?? "";
  return (
    code === "auth/invalid-action-code" ||
    code === "auth/expired-action-code" ||
    code === "client/password-neutralize-failed"
  );
};

export function emailLinkErrorMessage(error: unknown): string {
  if (error instanceof EmailLinkError) return error.message;
  const code = (error as { code?: string } | null)?.code ?? "";
  if (
    code === "auth/invalid-action-code" ||
    code === "auth/expired-action-code"
  )
    return "Liên kết đăng nhập không còn hiệu lực (đã dùng hoặc hết hạn). Hãy gửi liên kết mới.";
  if (code === "auth/invalid-email")
    return "Email không khớp với liên kết. Nhập đúng email đã nhận thư.";
  if (code === "auth/too-many-requests")
    return "Gửi quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.";
  if (code === "auth/quota-exceeded")
    return "Đã hết hạn mức gửi thư trong ngày của Firebase. Hãy thử lại ngày mai hoặc dùng Google.";
  if (code === "auth/operation-not-allowed")
    return "Đăng nhập bằng liên kết email chưa được bật trong Firebase. Hãy báo quản trị viên.";
  if (
    code === "auth/unauthorized-continue-uri" ||
    code === "auth/invalid-continue-uri"
  )
    return "Địa chỉ trang này chưa nằm trong danh sách tên miền được phép của Firebase. Hãy báo quản trị viên.";
  if (code === "auth/network-request-failed")
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  if (error instanceof Error && error.message === "Email không hợp lệ.")
    return error.message;
  return "Không gửi hoặc hoàn tất được đăng nhập bằng liên kết. Kiểm tra mạng và thử lại.";
}
