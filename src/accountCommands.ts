// Dựng dòng lệnh `gia-pha:accounts` cho khu "Công cụ trên máy quản trị" của #/users.
// Hàm thuần (không gọi mạng): nhận email các tài khoản đã tick và trả về các nhóm lệnh để dán vào PowerShell.
// Chỉ dùng email đăng nhập (số điện thoại là email ngầm @gp.nguyenduc); không có mật khẩu hay dữ liệu gia phả.

export const PROD_PROJECT = "gia-pha-nguyen-duc-prod";
const BASE = "npm run gia-pha:accounts --";
/** Thư mục dự án mặc định trên máy quản trị (sửa được ở giao diện). */
export const DEFAULT_PROJECT_DIR = "C:\\server\\gia-pha-ho-nguyen-duc";

/** Đường dẫn cho PowerShell: luôn bọc nháy đơn (nháy đơn bên trong được nhân đôi) nên không chèn được lệnh khác. */
export function psPath(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface CommandGroup {
  id: string;
  title: string;
  /** Mô tả ngắn, hiện dưới tiêu đề nhóm. */
  note: string;
  /** Mỗi phần tử là một dòng lệnh hoàn chỉnh. */
  lines: string[];
  /** Nhóm có thể điền theo tài khoản đã tick (để giao diện báo "mẫu" khi chưa tick). */
  perAccount: boolean;
}

/** Tham số dòng lệnh an toàn cho PowerShell: giữ nguyên nếu chỉ gồm ký tự thường gặp trong email, ngược lại bọc nháy đơn. */
export function psArg(value: string): string {
  return /^[A-Za-z0-9._%+@-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "''")}'`;
}

function target(prod: boolean, write: boolean, del = false): string {
  if (!prod) return "";
  const project = ` --project ${PROD_PROJECT}`;
  if (!write) return project;
  const ack = del ? "XOA TAI KHOAN" : "QUAN LY TAI KHOAN";
  return `${project} --confirm ${PROD_PROJECT} --ack "${ack} ${PROD_PROJECT}"`;
}

/**
 * Các nhóm lệnh. `emails` rỗng ⇒ dùng email mẫu; có email ⇒ mỗi lệnh theo từng email (giữ thứ tự, bỏ trùng).
 * `prod` thêm cờ project/confirm/ack đúng quy định của script (xem scripts/gia-pha/accounts.ts).
 */
export function buildCommandGroups(
  rawEmails: string[],
  prod: boolean,
  projectDir = "",
  keyPath = "",
): CommandGroup[] {
  // Mỗi dòng tự chuyển vào thư mục dự án (npm chỉ tìm thấy script ở đó) nên dán vào PowerShell ở đâu cũng chạy được.
  const dir = projectDir.trim();
  const key = keyPath.trim();
  // Khóa Admin: script chỉ kết nối được khi biến này trỏ tới file khóa (để ngoài repo). Gắn sẵn vào từng lệnh khi đã nhập đường dẫn.
  const cd =
    (dir ? `cd ${psPath(dir)}; ` : "") +
    (key ? `$env:GOOGLE_APPLICATION_CREDENTIALS = ${psPath(key)}; ` : "");
  const emails = [...new Set(rawEmails.map((e) => e.trim()).filter(Boolean))];
  const selected = emails.length > 0;
  const each = (sample: string, make: (email: string) => string): string[] =>
    (selected ? emails : [sample]).map((e) => make(psArg(e)));
  const read = target(prod, false);
  const write = target(prod, true);
  const del = target(prod, true, true);
  const groups: CommandGroup[] = [
    {
      id: "grant",
      title: "Cấp quyền cho Gmail",
      note: "Cho người đã đăng nhập Google và đang chờ cấp quyền (cách khác: chọn “Chỉ Gmail” ở khu Tạo tài khoản).",
      lines: each(
        "ten@gmail.com",
        (e) => `${BASE} grant --email ${e} --apply${write}`,
      ),
      perAccount: true,
    },
    {
      id: "create",
      title: "Tạo tài khoản có mật khẩu bằng lệnh",
      note: "Dành cho tài khoản MỚI (thay cho khu Tạo tài khoản); luôn dùng email mới, không dùng email đã tick.",
      lines: [
        `${BASE} create --email ten@example.com --name "Họ tên" --apply${write}`,
      ],
      perAccount: false,
    },
    {
      id: "revoke",
      title: "Thu hồi quyền",
      note: "Vô hiệu hóa quyền truy cập (có thể bật lại).",
      lines: each(
        "ten@gmail.com",
        (e) => `${BASE} revoke --email ${e} --apply${write}`,
      ),
      perAccount: true,
    },
    {
      id: "reset",
      title: "Đặt lại mật khẩu",
      note: "In mật khẩu tạm mới một lần; gửi riêng cho thành viên.",
      lines: each(
        "0914222987@gp.nguyenduc",
        (e) => `${BASE} reset-password --email ${e} --apply${write}`,
      ),
      perAccount: true,
    },
    {
      id: "delete-plan",
      title: "Xóa hẳn: chạy thử (chỉ đọc)",
      note: "Chỉ in kế hoạch. Chỉ xóa được tài khoản ĐÃ vô hiệu hóa và không phải quản trị viên.",
      lines: each(
        "ten@example.com",
        (e) => `${BASE} delete --email ${e}${read}`,
      ),
      perAccount: true,
    },
    {
      id: "delete-apply",
      title: "Xóa hẳn: thực hiện (KHÔNG hoàn tác)",
      note: "Chỉ chạy sau khi đã xem kế hoạch ở lệnh chạy thử.",
      lines: each(
        "ten@example.com",
        (e) =>
          `${BASE} delete --email ${e} --apply --confirm-delete ${e}${del}`,
      ),
      perAccount: true,
    },
    {
      id: "list",
      title: "Xem danh sách đầy đủ",
      note: "Chỉ đọc; gồm cả tài khoản chờ duyệt.",
      lines: [`${BASE} list${read}`],
      perAccount: false,
    },
    {
      id: "registry",
      title: "Kiểm tra và dựng lại sổ quản trị",
      note: "Dùng khi trang này báo sổ chưa khởi tạo hoặc lệch.",
      lines: [
        `${BASE} registry --verify${read}`,
        `${BASE} registry --rebuild --apply${write}`,
      ],
      perAccount: false,
    },
  ];
  // Chưa nhập đường dẫn khóa: có thêm nhóm "Chuẩn bị" với đường dẫn mẫu để người dùng thay bằng file thật.
  const setup: CommandGroup[] = key
    ? []
    : [
        {
          id: "setup",
          title: "Chuẩn bị (mỗi cửa sổ PowerShell mới)",
          note: "Đặt khóa Admin (file khóa nằm ngoài repo) cho cửa sổ hiện tại; thay đường dẫn bằng file thật, hoặc nhập đường dẫn vào ô “File khóa Admin” để mọi lệnh tự đặt biến này. Thiếu bước này, lệnh sẽ báo “Thiếu GOOGLE_APPLICATION_CREDENTIALS”.",
          lines: [
            `${cd}$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\\đường-dẫn\\khóa-admin.json'`,
          ],
          perAccount: false,
        },
      ];
  return [
    ...setup,
    ...groups.map((g) => ({ ...g, lines: g.lines.map((l) => cd + l) })),
  ];
}
