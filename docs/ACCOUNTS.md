# Tài khoản và quyền truy cập (gói Spark)

Chưa có Cloud Functions nên tài khoản được quản lý bằng **công cụ quản trị chạy cục bộ** (`npm run gia-pha:accounts`, Admin SDK). Trang `Quản lý tài khoản` hiện chỉ **xem** danh sách; từ PR-A, rules đã cho phép quản trị viên cấp quyền/mời ngay trong app (giao diện và script khởi tạo sổ nằm ở PR sau). Khi nâng lên Blaze, các thao tác này chuyển sang Cloud Functions.

## Hai cách đăng nhập

- **Gmail (Google):** quản trị viên chạy `grant --email <gmail>`; công cụ tạo sẵn tài khoản không mật khẩu và cấp quyền. Người dùng bấm "Đăng nhập bằng Google" bằng đúng email đó là vào cùng tài khoản (Firebase gộp theo email đã xác minh). Phải nhập đúng email Google họ dùng.
- **Không có Gmail:** quản trị viên chạy `create --email <email> --name "Họ tên"`; công cụ tạo tài khoản email/mật khẩu (email đã xác minh), in mật khẩu ngẫu nhiên **một lần**; gửi riêng cho người dùng. Mất mật khẩu thì `reset-password`. Email có thể là địa chỉ bất kỳ đúng định dạng nhưng nên là địa chỉ người dùng đọc được.

Đăng nhập thành công **chưa** đồng nghĩa được xem dữ liệu: cần có `users/{uid}` với `enabled: true`. Tài khoản chưa được cấp quyền thấy màn "Chờ cấp quyền".

## Lệnh

`npm run gia-pha:accounts -- <lệnh> [tùy chọn]`

| Lệnh                                                            | Việc làm                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `list`                                                          | Liệt kê Auth và quyền (kể cả tài khoản chờ duyệt)                                                               |
| `grant --email E [--name N] [--admin] [--reviewer] --apply`     | Cấp (hoặc cấp lại) quyền                                                                                        |
| `create --email E [--name N] [--admin] [--reviewer] --apply`    | Tạo tài khoản mật khẩu và cấp quyền                                                                             |
| `revoke --email E [--disable-auth] --apply`                     | Thu hồi quyền, hủy phiên đăng nhập                                                                              |
| `role --email E [--admin on\|off] [--reviewer on\|off] --apply` | Đổi vai trò                                                                                                     |
| `reset-password --email E --apply`                              | Đặt lại mật khẩu (chỉ tài khoản mật khẩu)                                                                       |
| `registry [--verify]`                                           | Chỉ đọc: so sổ `accessControl/admins` với `users`, in thiếu/thừa/users lệch; thoát mã 1 nếu lệch, mã 0 nếu khớp |
| `registry --rebuild [--apply]`                                  | Dựng lại sổ từ `users` và chuẩn hóa users lệch (mặc định chỉ in kế hoạch)                                       |

- Mặc định chỉ chạy thử. Cần `--apply` để ghi.
- Đích: emulator loopback (đặt cả `FIRESTORE_EMULATOR_HOST` và `FIREBASE_AUTH_EMULATOR_HOST`), project `-dev` hoặc **production** (`gia-pha-nguyen-duc-prod`). Project thật cần `GOOGLE_APPLICATION_CREDENTIALS` (khóa service account **để ngoài repo**), `--project <id>` và `--confirm <id>`; riêng prod cần thêm `--ack "QUAN LY TAI KHOAN gia-pha-nguyen-duc-prod"`.
- Không bao giờ thu hồi hay hạ quyền **quản trị viên cuối cùng**; `--force` không còn được hỗ trợ (bị từ chối).
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

## Cấp quyền trong app qua rules (PR-A: chỉ rules/test, chưa có UI, chưa deploy)

- **Lời mời qua email**: quản trị viên tạo `accountInvites/{email}` (chỉ vai trò **Chỉ xem**, hạn <= 7 ngày). Người được mời đăng nhập (Google, hoặc **đăng nhập không mật khẩu bằng liên kết email**) bằng đúng email đã xác minh rồi tự tạo `users/{uid}`; lô nhận lời mời đồng thời đánh dấu lời mời ACCEPTED và ghi nhật ký `account-{uid}-1`.
- **Sổ quản trị viên** `accessControl/admins` phải được khởi tạo một lần bằng script Admin (PR sau) với danh sách quản trị viên hiện có trước khi bật bất kỳ thao tác nâng/hạ nào; thiếu sổ thì không ai là quản trị viên trong rules (đóng khi lỗi). Việc sửa dữ liệu phả hệ (`manager()`) không phụ thuộc sổ; chỉ các thao tác tài khoản cần sổ.
- Quản trị viên có thể bật/tắt, nâng/hạ quyền quản trị và đổi tên hiển thị của người khác (không tự thao tác trên chính mình, không hạ quản trị viên cuối). Mỗi thay đổi tăng `accessVersion` và ghi `auditLogs/account-{uid}-{accessVersion}`. Sổ chỉ đổi cùng lô với `users` của mục tiêu; sổ lệch (ví dụ thu hồi bằng script) do script Admin sửa ở PR sau, không sửa được từ trình duyệt.
- Chi tiết bất biến, điều kiện lô và rủi ro: SECURITY_RULES.md; schema: DATABASE_SCHEMA.md.
- Cho `password` là provider hợp lệ nghĩa là chấp nhận cả đăng nhập mật khẩu của tài khoản đã xác minh email; không chấp nhận tài khoản ẩn danh/custom.

## Sổ quản trị viên `accessControl/admins` (PR-B)

- Bất biến (khớp `firestore.rules`): uid thuộc `adminUids` khi và chỉ khi `users/{uid}.enabled == true && canManageMembership == true`. Rules cho client sửa sổ chỉ cùng lô với `users` của người đổi quyền; sổ lệch do script này sửa.
- Mọi lệnh ghi `users` (`grant`, `create`, `revoke`, `role`) chạy trong MỘT giao dịch: đọc lại toàn bộ `users` và sổ, ghi `users` + sổ (khi trạng thái quản trị viên đổi, `version` +1, `lastTargetUid` = uid) + nhật ký. Sổ chưa tồn tại hoặc lệch: xem mục "Từ chối thay vì tự sửa" ngay dưới.
- **Từ chối thay vì tự sửa:** lệnh làm đổi trạng thái quản trị viên (`grant --admin`, `role --admin`, `revoke` admin, `create --admin`) bị TỪ CHỐI khi sổ chưa tồn tại hoặc đang lệch với `users`, hoặc khi sau thay đổi không còn quản trị viên nào / vượt 20; phải chạy `registry --rebuild` trước. Lệnh không đổi quyền quản trị vẫn ghi được, kèm cảnh báo. Không còn tự dựng sổ khi ghi. Ngoại lệ duy nhất (khởi tạo): khi chưa có sổ VÀ chưa có quản trị viên hiệu lực nào (enabled và canManageMembership đều true), lệnh đầu tiên tạo ra một quản trị viên hiệu lực khởi tạo sổ `[uid]` (version 1): `grant --admin`, `create --admin`, `role --admin on`, hoặc `grant` khôi phục quyền quản trị cũ của tài khoản đã thu hồi kiểu cũ. `grant`/`create`/`role` đều kiểm tra TRƯỚC khi tạo tài khoản Auth hoặc đánh dấu email đã xác minh nên bị từ chối thì không để lại tác dụng phụ. `create` kiểm tra trước khi tạo tài khoản Auth nên không để lại tài khoản mồ côi khi bị từ chối.
- `grant` (không `--admin`) cho tài khoản đã thu hồi còn `canManageMembership: true` cũ sẽ KHÔI PHỤC quyền quản trị cũ và in cảnh báo.
- `revoke` luôn đặt `canManageMembership: false`; `grant`/`role` luôn ghi `canManageMembership` là bool tường minh (rules đòi bool khi quản trị sửa).
- `registry --rebuild --apply` (một giao dịch): sổ = mọi `users` đang bật và là quản trị viên (tối đa 20, tối thiểu 1; không thỏa thì từ chối), `version` = cũ + 1, `lastTargetUid = "registry-rebuild"`; users thiếu bool `canManageMembership` hoặc `enabled != true` mà `canManageMembership = true` được đặt `canManageMembership: false` và tăng `accessVersion` +1 (tối đa 400 users mỗi lần); ghi một nhật ký `auditLogs/ledger-rebuild-{version}-{epochMillis}` (mã duy nhất, nên rebuild lại sau khi sổ bị xóa không bị kẹt) (`ACCOUNT_LEDGER_REBUILT`, chỉ uid, không email). Chịu cùng cổng prod (`--confirm`, `--ack`) như lệnh ghi khác; dry-run chỉ đọc.
- **Thứ tự vận hành bắt buộc trước khi deploy rules PR-A:** (1) `registry --verify` (dự kiến báo lệch vì chưa có sổ) → (2) `registry --rebuild` (dry-run, đọc kế hoạch) → (3) `registry --rebuild --apply` trên emulator/dev → (4) `registry --verify` phải sạch (mã 0) → chỉ khi người dùng duyệt mới lặp lại trên prod rồi deploy rules.
- Lưu ý: `--rebuild` tăng `accessVersion` của mỗi users được chuẩn hóa, có thể làm mất hiệu lực phiếu duyệt đang treo của Functions emulator-only (phiếu gắn `accessVersion`). Nhật ký rebuild được tạo bằng `create` (không ghi đè); version sổ hỏng hoặc nhật ký trùng mã thì dừng và báo cụ thể.
- Kiểm chứng tự động trên emulator: `npm run test:accounts:e2e` (`scripts/accounts-e2e-check.mjs`, dữ liệu giả, chỉ loopback; chạy `accounts.ts` thật rồi dùng sổ do script dựng làm fixture cho `firestore.rules`).
