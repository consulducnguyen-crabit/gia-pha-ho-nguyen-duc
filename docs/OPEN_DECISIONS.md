# Các quyết định còn cần chốt

Bảy chính sách dòng họ đã được phê duyệt, xem APPROVED_DECISIONS.md. Không hỏi lại các lựa chọn này.

Chưa phê duyệt hạ tầng có chi phí hoặc production: Firebase region, Blaze/billing cho Storage, dự án/remote GitHub, danh tính người chịu trách nhiệm duyệt và sao lưu.

Thông tin phục vụ định cỡ: số hồ sơ và truy cập đồng thời dự kiến. Trong dev dùng truy vấn có giới hạn, không tự giả định quy mô production.

Ngày âm: lưu nguyên lịch, độ chính xác và tháng nhuận; không tự chuyển khi thiếu thông tin. Chưa cần chốt cách chuyển đổi để lưu đúng dữ liệu gốc.

Đã chốt 2026-11-12 (gỡ liên kết vợ/chồng, PR-6): Q1=A admin `get` unions theo mã (không liệt kê); Q2=A cho gỡ khi người kia mồ côi (cảnh báo); Q3=A cho gỡ khi có con chung (cảnh báo kèm số con); Q4=A không sửa thứ tự/trạng thái/ghi chú, không thêm năm kết hôn. Xem IN_APP_EDIT_UNIONS.md.

Chưa chốt (trang nhật ký, PR-7; mặc định thận trọng đang áp dụng): (1) mức hiển thị ngày đầy đủ (ngày/tháng, âm lịch) trong nhật ký: A chỉ hiện năm ở bảng, ngày đầy đủ trong "Chi tiết" (đang dùng, đề xuất); B ẩn hẳn; C hiện thẳng trong bảng. (2) chính sách lưu giữ nhật ký (nhật ký giữ vĩnh viễn dữ liệu người đã ẩn; SECURITY_RULES mục 13): A giữ vĩnh viễn như hiện nay (đang dùng); B tự động ẩn/ẩn danh hóa nội dung sau một thời hạn; C cho quản trị viên xóa theo yêu cầu có sao lưu và dry run (đề xuất bàn sau). Xem AUDIT_LOG_UI.md.

Chưa chốt (ghi chú chi `note`, PR-9): `note` của chi nằm trong ảnh chụp cây mà mọi thành viên đọc được; giao diện chỉ hiện cho quản trị viên nên đây KHÔNG phải kiểm soát bảo mật. Phương án: A giữ nguyên, ẩn ở giao diện và ghi rõ giới hạn trong tài liệu (đang dùng, đề xuất); B bỏ `note` khỏi ảnh chụp chung và đưa vào tài liệu chỉ quản trị viên đọc (cần đổi bước dựng ảnh chụp, định dạng và script nạp); C hiển thị cho mọi thành viên (thừa nhận ghi chú không nhạy cảm). Cho đến khi chốt, không ghi thông tin nhạy cảm vào ghi chú chi. Xem TREE_UI.md.

Codex được tự lập phương án kỹ thuật, dùng agent độc lập phản biện, sửa và kiểm thử theo AGENTS.md. Các quyết định vượt thẩm quyền cần câu hỏi có ít nhất ba phương án, đánh dấu đề xuất. Tiếp tục phần độc lập khi chờ trả lời.
