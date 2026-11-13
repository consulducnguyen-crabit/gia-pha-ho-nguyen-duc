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
| `delete --email E [--apply --confirm-delete E]`                 | Xóa HẲN users + tài khoản Firebase Auth (**không hoàn tác**; xem mục "Xóa hẳn tài khoản")                       |
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

## Giao diện #/users (PR-C)

- Quản trị viên (có trong sổ) dùng nút **Sửa** để đổi tên hiển thị, đổi quyền Quản trị/Chỉ xem, vô hiệu hóa hoặc bật lại tài khoản ĐÃ CÓ; ghi qua firestore.rules cùng sổ và nhật ký trong một giao dịch. Không tự sửa chính mình. Sổ thiếu/không chứa bạn thì các nút bị khóa và trang hướng dẫn `registry --rebuild`. Vô hiệu hóa quản trị viên cũng hạ quyền Quản trị; bật lại chỉ trả quyền Chỉ xem. Mời người mới: PR sau.

## Mời thành viên bằng email (PR-D)

- Trang `#/users` có khu **Mời thành viên**: quản trị viên (có trong sổ) nhập email (+ tên hiển thị tùy chọn) và bấm "Tạo lời mời". Lời mời **chỉ cấp "Chỉ xem"**, hạn khoảng 7 ngày (ghi 6 ngày 22 giờ để tránh lệch đồng hồ so với giới hạn 7 ngày của rules). Bảng lời mời (tối đa 100, mới nhất trước) có trạng thái Đang chờ / Đã nhận / Đã thu hồi / Hết hạn, nút **Thu hồi**, **Mời lại** (khi hết hạn/thu hồi/đã nhận) và **Gửi liên kết đăng nhập**.
- **Gửi liên kết đăng nhập** gọi `sendSignInLinkToEmail` của Firebase: Firebase gửi thư tới email đó; người nhận mở liên kết (nên trên thiết bị của họ). Hạn mức thư theo ngày của Firebase, SMTP/thư rác **chưa được kiểm chứng trên Firebase thật**.
- Người được mời đăng nhập bằng một trong hai cách ở màn đăng nhập: **"Gửi liên kết"** (đăng nhập không mật khẩu bằng liên kết email; mở liên kết trên thiết bị khác thì nhập lại email) hoặc **Google** với đúng email được mời. Hệ thống KHÔNG có đăng ký mật khẩu. Sau đăng nhập, màn "Chờ cấp quyền" hiện nút **Nhận lời mời** nếu email đã xác minh và có lời mời đang chờ còn hạn; nhận xong tự vào hệ thống với quyền Chỉ xem.
- Rules ràng buộc: người phát hành phải còn là quản trị viên trong sổ; người đã có `users` (kể cả đã tắt) không nhận được lời mời; mỗi nhật ký lời mời (`invite-{nonce}`, `invite-{nonce}-revoked-{uid}`, `account-{uid}-1`) tạo cùng lô, không chứa email. Hệ lời mời cũ emulator-only (`#/accounts`, Cloud Functions) đã bị ẩn; mã giữ lại trong `src/Membership.tsx` và `functions/`.

### Việc thủ công cần người dùng (một lần, trước khi dùng thật)

1. **Firebase Console** (project prod `gia-pha-nguyen-duc-prod`, và dev nếu dùng): Authentication → Sign-in method → **Email/Password** → bật mục **Email link (passwordless sign-in)** (giữ nguyên "Email/Password" ở trạng thái bật; ứng dụng không có màn đăng ký mật khẩu). Kết quả cần xác nhận: mục "Email link" ở trạng thái Enabled.
2. Authentication → Settings → **Authorized domains**: thêm tên miền GitHub Pages của trang (dạng `<tên-tài-khoản>.github.io`) nếu chưa có. Kết quả cần xác nhận: tên miền xuất hiện trong danh sách.
3. Thử một vòng thật: dùng một email của người dùng, tạo lời mời trong `#/users`, bấm "Gửi liên kết đăng nhập", mở thư (kiểm tra cả thư rác), bấm liên kết, nhấn "Nhận lời mời". Kết quả cần xác nhận: vào được hệ thống với quyền Chỉ xem, không thấy "Quản lý tài khoản"; ghi lại thư có tới hộp thư chính hay thư rác.
4. Không cần gửi cho tôi khóa hay mật khẩu nào; chỉ báo kết quả các bước trên.

### Chống "đăng ký trước" (pre-hijacking) khi đăng nhập bằng liên kết email

- Rủi ro: kẻ khác có thể đăng ký trước một tài khoản mật khẩu cho email của người được mời (email chưa xác minh). Khi người đó chứng minh sở hữu hộp thư bằng liên kết email, tài khoản cùng email được dùng chung và kẻ kia vẫn giữ mật khẩu đã đặt.
- Biện pháp trong mã: ngay sau `signInWithEmailLink` thành công, ứng dụng gọi `updatePassword` với chuỗi ngẫu nhiên 40 ký tự (`crypto.getRandomValues`, không lưu, không hiển thị) để vô hiệu mật khẩu cũ (đổi mật khẩu cũng thu hồi token cũ). Lỗi bước này không bị nuốt: ứng dụng đăng xuất và báo gửi liên kết mới. Hệ quả: người dùng không có mật khẩu; họ đăng nhập bằng liên kết email hoặc Google.
- Liên kết đăng nhập được chụp và xóa `oobCode`/`apiKey` khỏi URL ngay khi trang tải; email tạm trong localStorage hết hạn sau 1 giờ và bị xóa khi lỗi hết hạn/đã dùng; giữa hai lần "Gửi liên kết" tới cùng email có thời gian chờ 60 giây phía client.
- Trạng thái: **đã giảm thiểu, chưa kiểm chứng trên Firebase thật.** Trên Auth emulator đã kiểm: đăng ký trước tài khoản mật khẩu P (đăng nhập P được) rồi hoàn tất liên kết email thì đăng nhập bằng P bị từ chối (`scripts/invites-browser-check.mjs`). Cần thử lại trên Firebase thật vì cách Firebase thật gộp tài khoản theo email có thể khác emulator.

## Xóa hẳn tài khoản (`delete`) — vô hiệu hóa trước, không hoàn tác

- Dùng khi cần xóa vĩnh viễn một người (hồ sơ `users` và tài khoản đăng nhập Firebase Auth). **Không hoàn tác.** Việc chỉ tạm ngừng quyền thì dùng nút Vô hiệu hóa trong `#/users` hoặc lệnh `revoke`.
- Chạy thử (chỉ đọc, KHÔNG ghi gì, in kế hoạch thật và mọi điều kiện chặn): `npm run gia-pha:accounts -- delete --email ten@example.com --project <id>` (trên emulator đặt hai biến `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` và `--project demo-gia-pha`; project thật cần `--project <id>`).
- Thực hiện: `npm run gia-pha:accounts -- delete --email ten@example.com --project <id> --apply --confirm-delete ten@example.com` (`--confirm-delete` phải đúng email đích, so khớp viết thường). Trên production cần thêm `--confirm <project>` và câu xác nhận RIÊNG của lệnh xóa: `--ack "XOA TAI KHOAN <project>"` (khác câu `QUAN LY TAI KHOAN` của các lệnh khác); `--force` bị từ chối.
- Điều kiện chặn: (1) tài khoản phải **đã vô hiệu hóa** (users.enabled khác true); (2) không phải quản trị viên (users, `canManageMembership` hay có trong sổ `accessControl/admins`; hạ quyền trước); (3) sổ phải khớp users (nếu lệch: `registry --rebuild`); (4) phải tìm thấy tài khoản Auth theo email (đã xóa rồi thì báo không tìm thấy); (5) sau khi xóa vẫn còn quản trị viên hiệu lực trong sổ.
- Thực hiện: một giao dịch Firestore xóa `users/{uid}` và ghi `auditLogs` `ACCOUNT_DELETED` (uid, không email/tên; thêm `authOnly: true` khi chỉ còn tài khoản Auth); `auth/user-not-found` ở bước xóa Auth được coi là đã xong; sau đó thu hồi phiên và xóa tài khoản Auth. Nếu xóa Auth lỗi sau khi users đã xóa: lệnh thoát mã 1 và cảnh báo (tài khoản không còn quyền); xóa tay trong Firebase Console hoặc chạy lại lệnh (xử lý được trạng thái "có Auth, không có users").
- **Lời mời PENDING còn hạn của email đó CHẶN xóa**: nếu xóa users + Auth khi lời mời còn chờ, người đó đăng nhập lại bằng cùng email (uid mới) sẽ NHẬN LẠI quyền qua chính lời mời đang chờ, không cần ai mời lại. Hãy thu hồi lời mời trong `#/users` trước. Lời mời REVOKED/hết hạn/ACCEPTED hoặc không có thì vẫn xóa được (lệnh không tự xóa lời mời).
- Đã kiểm trên emulator (`npm run test:accounts:e2e`); chưa chạy trên Firebase thật.
