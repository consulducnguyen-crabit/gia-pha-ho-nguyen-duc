# Đặc tả sản phẩm — v0.1

## 1. Mục tiêu
Ứng dụng gia phả trực tuyến cho **một dòng họ nội**, lưu thành viên dòng họ và người kết hôn vào dòng họ. Chỉ tài khoản được cấp quyền mới được xem dữ liệu.

## 2. Quyết định đã khóa
- Phạm vi: một dòng họ nội, có lưu thông tin người kết hôn.
- Đời và chi nhánh: tự tính theo quan hệ được phê duyệt, cho phép điều chỉnh ngoại lệ có lý do và nhật ký.
- Cập nhật: thành viên gửi đề xuất; ban gia phả phê duyệt trước khi áp dụng.
- Truy cập: riêng tư, tài khoản được cấp quyền; không có chế độ xem công khai.
- Nhập ban đầu: nhập tay và nhập Excel.
- Hạ tầng: GitHub Pages + Firebase Auth + Firestore + Firebase Cloud Storage; ưu tiên không cần NUC.

## 3. Vai trò dự kiến
Quản trị kỹ thuật; trưởng ban gia phả; biên tập viên; thành viên; khách chưa xác thực. Chi tiết quyền phê duyệt và cấp tài khoản cần xác nhận.

## 4. Chức năng P0
1. Đăng nhập, cấp/thu hồi quyền và vô hiệu hóa tài khoản.
2. Hồ sơ người: tên, tên khác, giới tính nếu biết, ngày sinh/mất (đầy đủ/một phần/ước lượng/không rõ), ảnh, ghi chú, nguồn.
3. Quan hệ cha/mẹ-con; quan hệ kết hôn; nhiều lần kết hôn; con nuôi; phân biệt quan hệ huyết thống và quan hệ truyền dòng họ.
4. Tự tính đời/chi nhánh, hỗ trợ ngoại lệ, cảnh báo ảnh hưởng.
5. Cây gia phả tương tác: tổ tiên, hậu duệ, chi nhánh, thu gọn/mở rộng, tìm kiếm.
6. Thành viên đề xuất thêm/sửa; ban gia phả xem diff, duyệt/từ chối/yêu cầu bổ sung.
7. Nhập Excel qua preview, phát hiện trùng và lỗi, không ghi thẳng dữ liệu chính thức.
8. Audit, backup, export có kiểm tra quyền.

## 5. P1 / P2
P1: nguồn trích dẫn, ảnh/tài liệu, sự kiện âm-dương lịch, báo cáo, tra cứu quan hệ họ hàng, địa điểm mộ.
P2: OCR hỗ trợ nhập tài liệu; AI chỉ gợi ý, không tự phê duyệt quan hệ.

## 6. Màn hình
Trang chủ riêng tư; đăng nhập; cây toàn họ; cây theo chi; tìm kiếm; hồ sơ người; quan hệ gia đình; thư viện tài liệu; lịch sự kiện; đề xuất thay đổi; hộp duyệt; nhập Excel; quản trị tài khoản; quản trị chi; audit; cấu hình; báo cáo.

## 7. Phi chức năng
Mobile-first; tiếng Việt; tải cây theo phạm vi thay vì toàn bộ; cache có version; WCAG cơ bản; không có dữ liệu cá nhân trong public bundle; logs không chứa nội dung nhạy cảm; lưu backup độc lập.

## 8. Tiêu chí nghiệm thu
Người chưa được cấp quyền không thể đọc Firestore/Storage bằng SDK trực tiếp; thành viên không thể tự sửa canonical; duyệt áp dụng nhất quán; chặn vòng lặp tổ tiên; import lặp không nhân bản; thay đổi lớn có preview; restore được kiểm thử.

## 8. Chính sách đã xác nhận bổ sung
Bảy quyết định chi tiết đã được người dùng phê duyệt trong `APPROVED_DECISIONS.md`; tài liệu đó là nguồn chính sách hiện hành thay cho trạng thái chưa chốt trong bản bàn giao cũ.
