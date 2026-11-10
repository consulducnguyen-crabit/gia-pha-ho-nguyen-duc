# Lời mời và quyền thành viên — bản thử nghiệm cục bộ

Kết quả kiểm thử và giới hạn nghiệm thu: [INVITATIONS_VERIFICATION.md](INVITATIONS_VERIFICATION.md).

Backend và UI chỉ hoạt động với demo-gia-pha trên emulator loopback. Không có
workflow deploy. Guard kiểm tra project, FUNCTIONS_EMULATOR, Auth và Firestore
hosts trước khi khởi tạo Admin SDK hoặc thực hiện thao tác đặc quyền.

## Phạm vi

- Người quản lý fixture có enabled=true và canManageMembership=true trong
  users do server kiểm soát. Đây chưa phải ma trận quyền quản trị production.
- Chỉ cấp role member. Không nâng quyền, thay đổi manager hoặc tự thu hồi manager.
- Auth principal phải có sẵn. Nhận lời mời đòi email đã xác minh, UID/email khớp
  lời mời và Auth user chưa disabled; backend tra cứu Admin Auth hiện tại.
- Đăng nhập hoặc tự tạo Auth principal không cấp quyền gia phả. Việc tạo principal
  bằng REST Firebase Auth chưa bị khóa ở cấp nhà cung cấp. Chưa triển khai cấp
  thông tin đăng nhập, xác minh email hay gửi thư production.
- Không gửi email/SMS. UI trả mã để thử thủ công giữa hai tài khoản giả.

## Chạy cục bộ

Node 24, Java 21. Từ thư mục dự án:

```sh
npm ci
npm ci --prefix functions
npm run emulators
```

Terminal khác, chỉ dùng đúng hai emulator hosts:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:invitations
VITE_USE_EMULATORS=true npm run dev -- --host 127.0.0.1
```

Tài khoản giả quanly@example.test (UID demo-manager), người được mời
duocmoi@example.test (UID demo-invitee); cùng mật khẩu Demo-only-2026!.
Hai principal giả đã verified để thử luồng; người được mời chưa có membership.
Seed không tự cấp lại manager đã bị thu hồi; dùng emulator mới nếu fixture đã đổi.

Mở hai phiên trình duyệt riêng. Manager mở Tài khoản và lời mời, nhập email người
được mời và tạo mã. Người được mời đăng nhập, dán mã ở màn Chờ cấp quyền. Mã chỉ
ở state/DOM, không đưa vào URL, log hoặc localStorage. Auth SDK vẫn quản lý phiên
đăng nhập riêng theo cấu hình mặc định.

## Giao dịch và chống replay

Mã ngẫu nhiên 256 bit, dạng base64url; chỉ SHA-256 của mã được dùng làm document ID.
Thời hạn 48 giờ là cấu hình thử nghiệm, chưa là chính sách vận hành production.
Lời mời gắn targetUid, email, phiên bản quyền target/issuer và schemaVersion=1.

Nhận lời mời đọc invitation, issuer và target trong cùng transaction. Kiểm tra
issuer còn enabled và capability hợp lệ; kiểm tra version và thời hạn trước ghi.
Consume lời mời, cấp member và audit cùng commit. Nhận đồng thời chỉ một lần thành
công; các lời mời khác cùng target version bị vô hiệu sau lần cấp quyền đầu.

Thu hồi membership tăng accessVersion kể cả tài khoản đang disabled hoặc chưa có
membership, vô hiệu các lời mời cũ. Chỉ lời mời mới được phát hành sau thu hồi mới
có thể cấp lại. Mỗi request UUID mới là một thao tác rõ ràng; retry cùng UUID trả
no-op, không tăng version. Retry cũ sau cấp lại không thu hồi quyền mới; UI báo rõ
trạng thái này, lần submit tiếp theo tạo UUID mới.

Audit append-only ở backend, không có email/mã thô/nội dung gia phả. Client không
đọc/ghi invitations hoặc audit, kể cả fixture manager. Firestore rules không mở
quyền ghi client; canonical và media vẫn khóa.

## API callable

| Hàm | Dữ liệu vào | Kết quả |
| --- | --- | --- |
| createInvitation | email | invitationId, token (chỉ trả khi tạo) |
| acceptInvitation | token | accepted=true |
| revokeInvitation | invitationId | changed |
| disableMembership | targetUid, requestId UUIDv4 | changed |

Chỉ nhận các trường đã liệt kê; dữ liệu role, enabled, approvedBy từ client bị
từ chối. Lời mời/membership schema lạ, sai kiểu hoặc version null bị từ chối.
Membership legacy thiếu accessVersion được đọc như 0; thiếu schemaVersion được
chấp nhận như legacy. Bản ghi được backend ghi mới có schemaVersion=1.

## Kiểm thử và giới hạn

```sh
npm run test:backend:unit
npm run test:backend
```

Khi emulator/Vite đã chạy và seed như trên:

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/invitation-browser-check.mjs
```

Script browser thu hồi lời mời còn chờ và membership invitee khi kết thúc; muốn
thử lại thì phát hành lời mời mới. Không dùng emulator như môi trường công khai:
emulator không chứng minh xác thực JWT, App Check, rate limiting hoặc vận hành
production. Giữ cổng emulator trên loopback.

Auth getUser và Firestore transaction thuộc hai hệ thống: không hứa tính nguyên
tử với external-disable hoặc thay email Auth đang diễn ra đồng thời. Luồng backend
này thu hồi membership trong Firestore; Auth principal không bị xóa hay disabled.
Mọi thay đổi quyền manager bằng trusted tooling tương lai phải tăng accessVersion.

Chưa deploy hoặc thay đổi dữ liệu thật. Production còn cần quyết định authority,
region/billing, bootstrap quản trị, provisioning/xác minh/gửi thư, chống lạm dụng,
khôi phục tài khoản đặc quyền và kiểm chứng hạ tầng. Không tự bật dịch vụ có phí.

## Rollback

Chưa có migration dữ liệu production. Dừng emulator và quay về commit trước để
bỏ backend/UI thử nghiệm. Muốn giữ fixture thì export trước khi dừng theo
OPERATIONS.md; không commit export. Không mở rules để khắc phục lỗi truy cập.
