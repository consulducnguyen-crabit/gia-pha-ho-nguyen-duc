# Nghiệm thu đề xuất/phê duyệt — emulator, 2026-11-10

Nhánh feat/change-proposals, HEAD gốc cdb47c0; toàn bộ thay đổi bước này chưa commit.
Không reset Git, xóa file, cấu hình remote hoặc đồng bộ GitHub. Không deploy production.
Mã vẫn ở /workspace/source-current/gia-pha-codex; repository gia-pha-ho-nguyen-duc
ở thư mục khác chưa được nhập mã hoặc thay đổi lịch sử.

## Kết quả thực chạy sau tiếp tục

| Kiểm tra | Kết quả |
| --- | --- |
| Backend đề xuất HTTP callable | 30/30 đạt cùng lượt, gồm ca queue regression mới |
| Backend lời mời/membership hồi quy | 34/34 đạt, gồm bảo vệ capability reviewer |
| Firestore/Storage rules hồi quy | 30/30 đạt |
| Unit bản nền | 6/6 đạt |
| Guard môi trường | 11/11 đạt |
| Đầu vào và đồ thị | 16/16 đạt |
| ESLint, TypeScript và backend build | Đạt |
| Frontend build sau sửa UI cuối | Đạt; bundle JavaScript 846,24 kB trước gzip, còn cảnh báo kích thước |
| Chromium ba phiên riêng | Đạt toàn luồng, không pageerror, mobile 390 px không tràn |

Chromium xác minh tạo/sửa/gửi, một người duyệt hồ sơ, yêu cầu bổ sung rồi tăng
revision/gửi lại, từ chối terminal, hai người duyệt truyền dòng, phiếu trùng không
được đếm thêm, tra cứu projection và mất capability reviewer làm xóa màn hình cũ.

Backend xác minh concurrency, phiếu stale, thu hồi quyền, baseVersion conflict,
graph lock/cycle/duplicate/conflict, archive thiếu hoặc khác nội dung, counter
overflow và rollback nguyên tử khi audit không ghi được. Canonical private fields
không ra projection; source/evidence không vào audit.

## Phản biện và sửa bổ sung

Agent độc lập tìm lỗi queue giới hạn trước khi loại đề xuất của chính reviewer.
Đã chuyển bộ lọc authorUid trước limit, thêm hai index cấu hình và regression
31 self-proposals không che đề xuất của người khác. Ca mới đạt trong suite 30.

Agent kiểm thử trình duyệt tìm lỗi label ngầm gồm option hoặc nội dung textarea
đã phục hồi. Đã thêm accessible name rõ cho ba select và ba textarea; giữ nguyên
locator exact và chạy toàn luồng đạt. Debug tạm đã bỏ khỏi script.

## Môi trường và giới hạn

Tác vụ trước bị gián đoạn vì agent quota, không có bằng chứng startup emulator
thất bại: log cũ có 29/29 HTTP tests đạt. Khi tiếp tục chỉ còn Firestore lẻ và các
tiến trình defunct; đã dừng đúng tiến trình cũ và khởi động lại suite đầy đủ.
Các cảnh báo metadata 403/MOTD/SDK cũ không ngăn các kết quả chạy nêu trên.

Chỉ dùng project demo và fake fixtures. Không nghiệm thu JWT/App Check/rate limiting
production, không transaction xuyên Auth–Firestore. Chưa tính đời/chi, sửa/xóa/gộp
quan hệ, import Excel hoặc ACL nhạy cảm/media. Giới hạn 200 quan hệ và danh sách 30;
chưa có phân trang production hoặc restore drill cho schema đề xuất mới.

Index mới chưa deploy; CI đã thêm tests nhưng chưa chạy GitHub Actions từ xa.
Hướng dẫn/API/invariants/rollback trong PROPOSALS.md. Không tuyên bố hoàn tất toàn P0.
