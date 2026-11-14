// Đăng nhập bằng số điện thoại: hệ thống ngầm hiểu số điện thoại là email dạng 0914222987@gp.nguyenduc
// (địa chỉ giả, không gửi thư; xác thực vẫn là Email/Mật khẩu của Firebase Auth). Hàm thuần để kiểm thử.

export const PHONE_EMAIL_DOMAIN = "gp.nguyenduc";

/** Người nhận đăng ký tài khoản (hiển thị khi đăng nhập không thành công). Đổi ở đây nếu có người khác phụ trách. */
export const REGISTER_CONTACT = {
  zalo: "0914325968",
  label: "cháu/em Chi II - Đời 7",
} as const;

/**
 * Chuẩn hóa số điện thoại di động Việt Nam về dạng 10 số bắt đầu bằng 0.
 * Chấp nhận khoảng trắng, dấu chấm, gạch ngang, ngoặc; tiền tố +84 / 84 / 0084. Không hợp lệ thì trả null.
 */
export function normalizeVnPhone(input: string): string | null {
  let s = input.trim().replace(/[\s.\-()]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0084")) s = "0" + s.slice(4);
  else if (s.startsWith("84") && s.length === 11) s = "0" + s.slice(2);
  // Đầu số di động Việt Nam hiện hành: 03x, 05x, 07x, 08x, 09x.
  return /^0[35789]\d{8}$/.test(s) ? s : null;
}

/** Email ngầm của số điện thoại; null nếu số không hợp lệ. */
export function phoneToEmail(input: string): string | null {
  const phone = normalizeVnPhone(input);
  return phone ? `${phone}@${PHONE_EMAIL_DOMAIN}` : null;
}

/** Email ngầm dạng số điện thoại (để giao diện ẩn đuôi, hiện lại thành số điện thoại). */
export function emailToPhone(email: string): string | null {
  const m = /^(0[35789]\d{8})@gp\.nguyenduc$/i.exec(email.trim());
  return m ? m[1] : null;
}

/** Nhãn hiển thị của tài khoản đăng nhập: số điện thoại cho email ngầm, ngược lại giữ nguyên email. */
export function loginLabel(email: string | null | undefined): string {
  if (!email) return "";
  return emailToPhone(email) ?? email;
}

/**
 * Ô đăng nhập duy nhất: có "@" thì coi là email (tài khoản email/mật khẩu sẵn có), ngược lại là số điện thoại.
 * Trả null nếu không hợp lệ.
 */
export function loginInputToEmail(input: string): string | null {
  const v = input.trim();
  if (v.includes("@"))
    return /^[!-~]+@[!-~]+$/.test(v) ? v.toLowerCase() : null;
  return phoneToEmail(v);
}
