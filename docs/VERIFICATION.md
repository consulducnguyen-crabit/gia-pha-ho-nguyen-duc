# Kiểm chứng bản nền — 2026-11-10

Đọc AGENTS.md và APPROVED_DECISIONS.md trước khi triển khai. Giữ nguyên bảy chính
sách đã duyệt. Chỉ dùng project demo-gia-pha, emulator loopback và dữ liệu giả.
Nhánh cục bộ: fix/emulator-verification; baseline là mã giải nén từ ZIP người dùng
cung cấp. Không kết nối remote, không deploy và không thao tác production.

## Kết quả thực chạy

| Hạng mục | Kết quả |
| --- | --- |
| Firestore + Storage emulator, bộ rules gốc | 17/17 đạt trước khi bổ sung regression |
| Suite rules mở rộng | 30/30 đạt |
| Unit tests | 6/6 đạt, gồm graph, chuẩn hóa tên và response tìm kiếm đảo thứ tự |
| ESLint, TypeScript | Đạt |
| Vite production build cục bộ | Đạt; cảnh báo bundle JavaScript ~817,66 kB trước gzip |
| Chromium với Auth/Firestore emulator | Đạt đăng nhập, tìm kiếm, không có kết quả, tra cứu lại, hồ sơ và đăng xuất |
| Chromium mobile 390 px | Không tràn ngang; không có pageerror trong luồng kiểm thử |
| Thu hồi membership online | Đóng giao diện dữ liệu; cấp lại thì tra cứu được |
| Offline và thu hồi khi offline | Chờ xác nhận quyền, không hiện hồ sơ; reconnect vẫn bị chặn cho tới khi cấp lại |
| Export/import Auth, Firestore, Storage | Đạt trên tiến trình emulator mới |

Regression rules bổ sung gồm tự ghi đè/sửa/xóa tài khoản của mình, tự tạo quyền
khi chưa được mời, sửa/xóa canonical, truy cập subcollection names, thu hồi quyền
trên cùng auth context và đọc đề xuất khi bị vô hiệu hóa. Không mở quyền client.

Restore đối chiếu số lượng và SHA-256 nội dung ở 10 collections fixture và
persons/nested-regression/names (3 tài liệu), kiểm tra sáu hồ sơ giả, UID/đăng nhập
Auth và SHA-256 media. Export xong mới dừng emulator; import ở tiến trình mới rồi
verify thành công, exit code 0. Không kiểm kê toàn bộ schema hoặc restore production.
Các lệnh lặp lại nằm trong [OPERATIONS.md](OPERATIONS.md).

## Phản biện và sửa

Agent độc lập phát hiện race tìm kiếm và việc mở quyền từ snapshot cache. Đã chặn
response cũ, vô hiệu hóa response sau unmount, dùng getDocsFromServer và chỉ mở
membership sau snapshot server. Unit tests kiểm tra response thành công/lỗi đảo
thứ tự và cleanup; chưa có kiểm thử race ở cấp browser integration.

Agent khác bổ sung browser regression. Review cuối phát hiện path names của
restore ban đầu chưa trỏ tới fixture thật; đã sửa path, record/export lại và chạy
fresh import/verify đạt. Review cuối không phát hiện blocker mới trong phạm vi này.
Màn chờ quyền có nút đăng xuất để người dùng thoát được khi offline kéo dài.

## Giới hạn còn lại

Đây là bản nền đăng nhập và đọc projection cơ bản. Chưa hoàn tất backend phê
duyệt hai người, cấp lời mời, cây tương tác, nhập Excel, quản trị hoặc ACL media.
Canonical và media vẫn khóa với client. Dữ liệu đã được người dùng nhận có thể
được giữ lại; gate khi SDK phát hiện offline không phải cơ chế thu hồi bản sao.

Region, billing, người chịu trách nhiệm vận hành và production vẫn chờ quyết định.
Bundle Firebase cần tối ưu trước production. Không có phát hành production trong
đợt công việc này.
