# Kiểm chứng backend lời mời — 2026-11-10

Nhánh cục bộ feat/invitation-backend, dựa trên bản nền đã kiểm chứng. Đã đọc AGENTS,
APPROVED_DECISIONS và OPEN_DECISIONS. Không đổi bảy chính sách; chỉ dùng dữ liệu giả,
demo-gia-pha và emulator loopback. Không gửi thông báo, deploy hoặc đổi production.

## Kết quả thực chạy

| Hạng mục | Kết quả |
| --- | --- |
| Backend callable qua HTTP trên Functions/Auth/Firestore emulator | 32 ca chạy cùng suite đạt; sau đó thêm 1 ca retry sau cấp lại, chạy riêng đạt; tổng 33 ca đã kiểm chứng |
| Guard môi trường backend | 11/11 unit tests đạt |
| Firestore/Storage rules regression | 30/30 đạt |
| Unit tests bản nền | 6/6 đạt |
| ESLint và TypeScript toàn dự án | Đạt sau sửa cuối |
| Backend TypeScript build | Đạt |
| Frontend production build cục bộ | Đạt, JavaScript 832,37 kB trước gzip; còn cảnh báo kích thước bundle |
| Chromium luồng lời mời | Đạt sau sửa UI cuối, không pageerror |
| Chromium hồi quy bản nền | Đạt đăng nhập/tra cứu/hồ sơ, thu hồi, offline/reconnect và đăng xuất |

Không cộng 32 ca skipped trong lần targeted vào số lần chạy mới. Không tuyên bố đã
chạy cả 33 ca cùng một lượt hoặc đã kiểm chứng production.

## Bằng chứng bảo mật và tính đúng đắn

Các ca backend kiểm tra: caller chưa đăng nhập; pending/member/claims giả/disabled
không có quyền quản lý; UID/email sai hoặc đã đổi; email chưa verified; Auth user
disabled; mã sai/hết hạn/revoked/đã dùng; người mời mất quyền; account-email recycling
không tái sử dụng được UID cũ; quyền và version sai cấu trúc; schema tương lai;
không ghi đè vai trò đặc quyền; hai lần redeem đồng thời; hai lời mời cùng version;
thu hồi trước redeem và cấp lại bằng lời mời mới; UUID retry; audit conflict làm
rollback cả membership và invitation. Client SDK không đọc/ghi invitation/audit.

Ca mới kiểm tra disable R → lời mời mới/accept → retry R no-op không đổi user doc
→ UUID mới mới thực sự thu hồi. Không có đường tự cấp manager hoặc role tùy ý.

Chromium dùng hai browser contexts riêng: manager tạo mã; invitee pending thử mã
sai, nhận mã đúng, tra cứu; bị thu hồi rồi replay bị chặn; lời mời mới cấp lại;
thu hồi lời mời chặn nhận. Bỏ capability manager làm route/form/mã biến mất.
Mobile 390 px không tràn ngang. Script phục hồi capability fixture và khóa invitee
khi kết thúc; không chụp/log mã lời mời.

Nhánh UI retry được kiểm tra bằng một response callable changed=false giả lập,
xác nhận thông báo không khẳng định đã thu hồi và lần submit tiếp tạo UUID khác;
sau đó backend thật thu hồi thành công. Tính đúng đắn retry backend được kiểm tra
bằng ca HTTP thật nêu trên, không dựa trên mock UI.

## Phản biện độc lập

Một agent phản biện thiết kế và code; một agent viết/chạy backend tests; một agent
triển khai UI rồi viết/chạy browser regression. Đã sửa version null, enabled sai
kiểu, schema/issuer path malformed và thông báo retry no-op trước review cuối.
Review cuối không phát hiện blocker kỹ thuật mới trong phạm vi emulator; kết luận
được đối chiếu với kiểm thử thực chạy, không thay bằng sự đồng ý của agent.

## Giới hạn và bàn giao

Xem [INVITATIONS.md](INVITATIONS.md) để cài đặt, chạy thử, API, schema và rollback.
CI đã thêm cài package backend, build, guard tests và integration tests; chưa chạy
GitHub Actions từ xa vì chưa có remote. Không có workflow production deploy.

Đã có backend/UI lời mời cấp membership thử nghiệm; chưa có provisioning Auth,
gửi/xác minh email production, bootstrap/phân quyền manager thật, rate limiting,
App Check hay xác thực JWT production. Quyền quản lý chỉ là fixture server-side.
Auth và Firestore không có transaction xuyên hệ thống; không hứa thu hồi tức thời
các request đang chạy khi Auth bị thay đổi ở hệ thống khác.

Chưa có backend đề xuất/phê duyệt quan hệ, import Excel hoặc ACL media. Restore
drill trước thuộc fixture bản nền; chưa chạy drill mở rộng cho invitations/audit
mới. Canonical/media vẫn khóa và không có dữ liệu thật trong frontend bundle.
