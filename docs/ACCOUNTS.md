# Tài khoản và quyền truy cập (gói Spark)

Chưa có Cloud Functions nên tài khoản được quản lý bằng **công cụ quản trị chạy cục bộ** (`npm run gia-pha:accounts`, Admin SDK). Trang `Quản lý tài khoản` trong ứng dụng chỉ **xem** danh sách. Khi nâng lên Blaze, các thao tác này chuyển sang Cloud Functions.

## Hai cách đăng nhập
- **Gmail (Google):** quản trị viên chạy `grant --email <gmail>`; công cụ tạo sẵn tài khoản không mật khẩu và cấp quyền. Người dùng bấm "Đăng nhập bằng Google" bằng đúng email đó là vào cùng tài khoản (Firebase gộp theo email đã xác minh). Phải nhập đúng email Google họ dùng.
- **Không có Gmail:** quản trị viên chạy `create --email <email> --name "Họ tên"`; công cụ tạo tài khoản email/mật khẩu (email đã xác minh), in mật khẩu ngẫu nhiên **một lần**; gửi riêng cho người dùng. Mất mật khẩu thì `reset-password`. Email có thể là địa chỉ bất kỳ đúng định dạng nhưng nên là địa chỉ người dùng đọc được.

Đăng nhập thành công **chưa** đồng nghĩa được xem dữ liệu: cần có `users/{uid}` với `enabled: true`. Tài khoản chưa được cấp quyền thấy màn "Chờ cấp quyền".

## Lệnh
`npm run gia-pha:accounts -- <lệnh> [tùy chọn]`

| Lệnh | Việc làm |
|---|---|
| `list` | Liệt kê Auth và quyền (kể cả tài khoản chờ duyệt) |
| `grant --email E [--name N] [--admin] [--reviewer] --apply` | Cấp (hoặc cấp lại) quyền |
| `create --email E [--name N] [--admin] [--reviewer] --apply` | Tạo tài khoản mật khẩu và cấp quyền |
| `revoke --email E [--disable-auth] --apply` | Thu hồi quyền, hủy phiên đăng nhập |
| `role --email E [--admin on\|off] [--reviewer on\|off] --apply` | Đổi vai trò |
| `reset-password --email E --apply` | Đặt lại mật khẩu (chỉ tài khoản mật khẩu) |

- Mặc định chỉ chạy thử. Cần `--apply` để ghi.
- Đích: emulator loopback (đặt cả `FIRESTORE_EMULATOR_HOST` và `FIREBASE_AUTH_EMULATOR_HOST`), project `-dev` hoặc **production** (`gia-pha-nguyen-duc-prod`). Project thật cần `GOOGLE_APPLICATION_CREDENTIALS` (khóa service account **để ngoài repo**), `--project <id>` và `--confirm <id>`; riêng prod cần thêm `--ack "QUAN LY TAI KHOAN gia-pha-nguyen-duc-prod"`.
- Không thu hồi hay hạ quyền **quản trị viên cuối cùng** (trừ khi `--force`).
- **Chống "đăng ký trước":** nếu đã có tài khoản mật khẩu cho email đó nhưng **chưa xác minh email** (tức là có người tự đăng ký, không phải do công cụ tạo), `grant` từ chối. Cần xóa tài khoản đó trong Firebase Console rồi chạy lại. Chỉ tài khoản do công cụ tạo (email đã xác minh bởi quản trị viên) hoặc Google mới được cấp quyền.
- Khuyến nghị (cần kiểm chứng trên dev trước khi bật): tắt tự đăng ký trong Firebase Console (Authentication → Settings → User actions → bỏ "Enable create (sign-up)"). Chưa chắc việc này có chặn đăng nhập Google lần đầu cho tài khoản đã tạo sẵn hay không, nên chưa áp dụng.
- Mỗi thay đổi tăng `accessVersion` (làm mất hiệu lực lời mời/phiếu cũ) và ghi `auditLogs` (chỉ mã tài khoản, không email).
- Thu hồi cũng hủy refresh token; phiên đang mở mất quyền ngay vì Rules kiểm tra `users/{uid}.enabled` ở mỗi lần đọc.

## Phân quyền
- Rules: quản trị viên (`canManageMembership`) được `get`/`list` `users`; không ai ghi được `users` từ trình duyệt. Thành viên thường chỉ đọc hồ sơ của chính mình. Quyền quản trị lấy từ tài liệu `users`, không từ claim của client.
- Tài khoản đầu tiên (quản trị viên đầu tiên) phải tạo trực tiếp bằng công cụ: `grant --email <email> --admin --apply`.

## Việc còn lại
- Cấu hình Authorized domains và bật Google/Email trên Firebase (đã làm cho dev và prod).
- Khi nâng Blaze: chuyển tạo/thu hồi tài khoản vào Cloud Functions có giao diện quản trị.
