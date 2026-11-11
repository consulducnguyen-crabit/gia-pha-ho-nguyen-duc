# Design system tối thiểu — áp dụng dần

Nguồn bắt buộc: UI_DESIGN_RULES.md. Người dùng chọn chỉnh dần giao diện hiện có.
Giữ stack React/CSS, xanh lá nhạt/nền sáng, system font cho nội dung và Georgia
cho tiêu đề; không thêm dependency, thay thương hiệu hoặc đổi luồng nghiệp vụ.

Đợt này chuẩn hóa tokens và control dùng chung. Tra cứu ưu tiên tìm/xem/đóng hồ
sơ; đề xuất ưu tiên nhập/lưu/gửi; reviewer ưu tiên so sánh/duyệt/yêu cầu bổ sung;
quản lý tài khoản ưu tiên tạo/thu hồi lời mời và thu hồi quyền. Đây là màn hình
nghiệp vụ, cần form rõ và mật độ vừa phải trên desktop/mobile.

Kế hoạch: giữ layout và hierarchy hiện tại; gom màu/spacing/radius/focus vào CSS
variables, bỏ inline styles hàng loạt ở Proposals, đồng bộ input/select/textarea
và checkbox. Dùng focus nhìn rõ, thông báo có nhãn chữ và khoảng cách phân biệt
thao tác nguy hiểm. Không thay API, quyền, DB hoặc trạng thái workflow.

Kiểm chứng: lint/typecheck/build; browser tại 360/768/1280/1440 px; keyboard,
focus, tương phản, nội dung dài, loading/empty/error/disabled và các luồng hiện có.
Không coi đây là chứng nhận WCAG cho toàn sản phẩm; ghi các giới hạn trong báo cáo.
