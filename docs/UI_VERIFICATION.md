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

# Rà soát theo HTML Standard + WCAG 2.2 AA — 13/11/2026

Công cụ: scripts/ui-standards-audit.mjs (Playwright + Chrome, emulator, dữ liệu giả). axe-core không có
trong node_modules nên không dùng. Phạm vi: đăng nhập, chờ cấp quyền, và với quản trị/thành viên các route
tổng quan, cây, hồ sơ, tra cứu, cần kiểm tra, đề xuất, hộp duyệt, tài khoản, lời mời, nhật ký, tiến độ, 404;
cộng 6 panel sửa của hồ sơ (mở, bấm Lưu khi trống để bật lỗi). Mỗi trạng thái đo ở 320/360/768/1280.

Tiêu chí đã kiểm tự động: lang, title theo route (2.4.2), một h1 và không nhảy cấp heading, một main, nhãn và
tên truy cập (2.5.3), alt, id trùng, caption bảng, skip link (2.4.1), Tab qua từng phần tử (271 điểm dừng): viền
focus nhìn thấy, không bị overflow cắt, không bẫy focus (2.4.7), vùng bấm 24px (2.5.8) và 44px,
tràn ngang 320/360/768/1280 (1.4.10), phóng tương đương 200% (viewport 640px) và 1.4.12 ép khoảng cách chữ
(không tràn/cắt), tương phản chữ tính theo màu thực của từng đoạn chữ và các cặp token (chữ 4.5:1, viền
control/focus 3:1).

Trước khi sửa (21 nhóm lỗi): thiếu main ở đăng nhập; title không đổi theo route; không có skip link; bảng
tài khoản thiếu caption; heading h1 -> h3 ở tra cứu (và h3 nằm trong button); tên truy cập nút cây không khớp
chữ hiển thị; vùng bấm <24px ở checkbox cây, tên người trong cây/hồ sơ/cần kiểm tra, liên kết quay lại, nhãn
"Cần kiểm tra"; viền control 2,91-2,97:1 trên hero/story; nav 32px; focus rơi về body sau Hủy panel ẩn người.

Sau khi sửa: 0 nhóm lỗi, 9 nhóm cảnh báo (còn lại): tên người trong cây/danh sách cao 27-29px (đạt 24px, chưa
44px) và nút mở/thu gọn nhánh 32x44 ở chuột; với màn hình cảm ứng (pointer: coarse) đã nâng lên 44px nhưng chưa
đo trên thiết bị thật. Ghi chú: ở 360px nav xuống nhiều dòng (mỗi mục 44px) nên khối đầu trang cao hơn trước.

Lệnh đã chạy đạt: tsc, eslint, npm test (238), npm run test:rules, build, vite preview (chỉ 404 favicon),
edit/audit/branch-info browser check, responsive-shots.

Chưa kiểm: trình đọc màn hình thật (NVDA/VoiceOver), thiết bị cảm ứng thật, phóng chữ trình duyệt thật 200%/400%,
Safari/Firefox, các trạng thái của đề xuất/hộp duyệt/lời mời có dữ liệu, tương phản của nền gradient/ảnh (không
có). Chỉ xem mắt các ảnh trong phiên này: ho-so 360 (trước/sau), cây 360 (trước/sau), tổng quan 1280, tra cứu 768,
đăng nhập 360/1280. Không tuyên bố tuân thủ WCAG tổng thể.

## Hạn chế đã biết (chưa sửa)

- Skip link giữ `href="#main"` (có onClick chặn mặc định) nên Ctrl+click hoặc "Sao chép liên kết" ra URL `/#main`,
  HashRouter hiểu là route không tồn tại (404).
- Khi đổi route, focus được đưa vào `<main>`; chưa kiểm với trình đọc màn hình (mẫu khác: đưa focus vào h1).
- Nav xuống 4-5 dòng ở 320/360px cho quản trị trên emulator nên đẩy nội dung xuống.
- Title nay đặt trong phần tử của từng `<Route>` (component `Titled`) và theo trạng thái ở màn hình cổng;
  audit kiểm title khớp h1 và route chặn/không có trả "Không tìm thấy trang".
