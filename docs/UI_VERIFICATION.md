# Áp dụng luật UI — đợt đầu, 11/11/2026

## Phạm vi và lý do

Người dùng chọn chỉnh dần giao diện hiện có. Đã sao chép nguyên văn
UI_DESIGN_RULES.md vào gốc dự án, liên kết từ AGENTS.md, ghi kế hoạch tại
UI_SYSTEM.md. Không đổi framework, font, thương hiệu, API, DB hoặc phân quyền.

Đã chuẩn hóa CSS dùng chung cho đăng nhập, tra cứu, đề xuất, hộp duyệt và lời mời.
Proposals bỏ inline styles hàng loạt; Membership/Proposals dùng class danger cho
thu hồi/từ chối. Dùng spacing để phân nhóm, viền/focus rõ và trường phiên bản gọn,
không tái thiết kế trang thành mẫu dashboard/card mới.

Tokens giữ xanh lá/nền sáng và system font/Georgia; màu phụ được điều chỉnh trong
cùng hệ màu để đủ tương phản. Tập trung spacing/radius, control height, trạng thái
focus/disabled/danger và reduced motion. Label của biểu mẫu được cách đều; checkbox
có vùng nhãn cao tối thiểu theo control-height.

## Kiểm thử thực chạy

- ESLint, TypeScript, production build cục bộ và 6 unit tests: đạt.
- scripts/ui-check.mjs: đạt tại 360/768/1280/1440 px, không overflow/pageerror.
- Đã thử empty/no-results, tiếng Việt dài, native validation giữ dữ liệu nhập,
  keyboard checkbox → Tab → textarea, loading/disabled, permission-denied giả lập
  và phục hồi. Không suy rằng mock UI chứng minh quyền backend.
- Contrast mẫu computed CSS: nội dung 6,32:1; nút chính ở trạng thái lấy mẫu
  10,66:1; chữ control 11,38:1; focus outline đạt ít nhất 3:1. Không khẳng định
  đã đo mọi cặp màu hoặc chứng nhận WCAG toàn sản phẩm.
- Ba browser regression: đề xuất/phê duyệt, lời mời/thu hồi và đăng nhập/tra cứu/
  offline đều đạt. Không chạy lại backend/rules suites vì đợt này không sửa logic đó.
- Đã xem bốn ảnh responsive và ảnh đối chiếu trước/sau tại 360/1280 px. Bản trước
  chạy từ ZIP đã bàn giao trong thư mục tạm trên port5174; bản mới port5173, cùng
  fake Auth/DB. Không reset worktree để chụp baseline.

Ảnh lưu /tmp/gia-pha-ui-{width}.png và /tmp/gia-pha-ui-{before,after}-{360,1280}.png.
Log /tmp/gia-pha-ui-check.log; ảnh chỉ chứa fixture giả, không token lời mời.

## Giới hạn và bước sau

Đây là đợt chuẩn hóa nền, chưa tuyên bố tất cả màn hình đáp ứng đầy đủ mọi khoản
của luật mới. Giữ layout/hero/icon cũ trong đợt này; tiếp tục audit từng màn hình
về trọng tâm, validation cạnh trường và mức xác nhận của thao tác quan trọng.
Chưa kiểm tra screen reader thực, toàn bộ trình duyệt/zoom hoặc mọi trạng thái
permission/loading có thể xảy ra. Không có bảng nhiều cột trong phạm vi hiện tại.

Build còn cảnh báo JavaScript bundle lớn (khoảng846 kB trước gzip). Chưa commit,
reset Git, thay remote, đồng bộ GitHub hoặc deploy production. HEAD vẫn cdb47c0;
bao gồm các thay đổi đề xuất chưa commit từ bước trước.

## Phiên tiếp theo — xác nhận thao tác

Sau khi người dùng cho phép tự commit/push, đã thêm xác nhận native trước gửi,
ghi nhận phiếu, yêu cầu bổ sung/từ chối và thu hồi lời mời/membership. Thông báo nêu
ID và revision/tài khoản; không hứa áp dụng dữ liệu trước khi đủ phiếu hợp lệ.

Agent độc lập review đạt; lint/typecheck/build và hai luồng Chromium đều đạt.
Cancel review giữ ghi chú/trạng thái và không POST review; cancel disable giữ
UID/quyền/trạng thái và không POST disable. UUID chỉ được tạo sau Confirm.
Các nhánh cancel submit/revoke đã review mã, chưa có ca browser riêng.
Không sửa backend, payload, ACL hoặc dữ liệu production.
