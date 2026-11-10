# Chính sách được người dùng phê duyệt

Người dùng xác nhận “Ok chọn theo đề xuất của codex” sau bảng bảy lựa chọn A. Đây là phê duyệt chính sách, không phải phê duyệt deploy, billing hoặc thay đổi dữ liệu production.

1. Truyền dòng nội theo nam, có ngoại lệ được duyệt. Không tự gán truyền dòng từ giới tính hoặc họ: quan hệ truyền dòng vẫn cần được phê duyệt rõ ràng.
2. Con nuôi: xét từng trường hợp khi duyệt; không tự tính truyền dòng.
3. Cho phép nhiều gốc tạm thời; chỉ nối sau xác minh. Không mặc định các gốc cùng đời.
4. Hai người duyệt quan hệ truyền dòng; một người duyệt thông tin khác. Người đề xuất không tự duyệt; hai người duyệt phải khác nhau và kiểm tra quyền tại thời điểm áp dụng.
5. Cấp tài khoản chỉ qua lời mời; đăng nhập chưa đồng nghĩa được cấp quyền. Không có tự đăng ký thành viên hoặc tự nâng quyền.
6. Người phối ngẫu có hồ sơ cơ bản; không tự mở rộng thân nhân.
7. Thành viên xem thông tin cơ bản của người còn sống; thông tin nhạy cảm phân quyền. Thiếu phân loại được xử lý như nhạy cảm.

## Triển khai kỹ thuật bảo thủ

- Tách memberProfiles (projection cơ bản đã lọc) khỏi persons (canonical) và personPrivate (nhạy cảm). Quy tắc Firestore không thể che từng trường trong cùng document.
- Projection ban đầu chỉ có displayName, normalizedName, profileVersion và schemaVersion. Chưa mở ngày sinh đầy đủ, liên hệ, ghi chú hoặc nguồn. Backend tin cậy phải tạo projection từ allowlist, không sao chép toàn bộ hồ sơ.
- persons và personPrivate tạm khóa truy cập client cho đến khi có backend, ACL và kiểm thử đầy đủ. Không tự cấp quyền đọc nhạy cảm cho người có tên vai trò admin/editor/approver.
- Duyệt hai người phải gắn cùng phiên bản đề xuất, loại bỏ phiếu cũ sau sửa và kiểm tra version khi commit nguyên tử. Đây là yêu cầu backend, không thực thi bằng trạng thái UI.
