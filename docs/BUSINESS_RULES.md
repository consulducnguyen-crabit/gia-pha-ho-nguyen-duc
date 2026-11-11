# Quy tắc nghiệp vụ gia phả — v0.1

## Danh tính
Mỗi người một ID bất biến, không đồng nhất người dựa trên tên. Người phối ngẫu có hồ sơ riêng. Hỗ trợ tên khác và thông tin chưa xác định.

## Quan hệ
Mỗi quan hệ cha/mẹ-con là một record có loại (sinh học, nuôi, truyền dòng họ nếu cần), trạng thái xác minh, nguồn, ngày hiệu lực tùy chọn. Quan hệ hôn nhân không làm người phối ngẫu tự động thuộc dòng truyền đời.

Không cho phép chu trình tổ tiên. Quan hệ mâu thuẫn, thiếu nguồn hoặc không hợp lý theo thời gian phải được cảnh báo; không tự suy đoán.

## Truyền dòng nội (chính sách 2026-11-11)
- Dòng họ nội truyền theo **nam**: chỉ quan hệ với người **cha** (vai trò FATHER được chỉ định rõ, không suy từ họ hay giới tính) mới có `lineageTransmission = true`. Quan hệ với mẹ không truyền dòng.
- **Con nuôi tính đời theo dòng** như con ruột. Loại quan hệ (`ADOPTIVE`) vẫn được lưu để ghi chú bằng badge/màu nhẹ trên giao diện, không tạo phân biệt.
- **Một thủy tổ duy nhất.** Gốc truyền dòng là người có con theo dòng nhưng không có cha truyền dòng; chỉ được có đúng một. Backend từ chối quan hệ tạo thêm gốc chưa nối; nối một gốc vào dưới cây hiện có thì hợp lệ. Người kết hôn vào không phải gốc. Nhánh có nguồn gốc hợp nhất từ dòng khác được ghi chú ở chi (`mergedFrom`), không tách gốc riêng.
- Lý do truyền dòng là tùy chọn; căn cứ/nguồn vẫn bắt buộc.

## Tính đời
Mặc định đời con = đời người truyền dòng + 1 khi đã xác định đường truyền được duyệt. Đời không rõ nếu không có đường nối xác thực. Ghi nhận override tách biệt với quan hệ gốc, có lý do, người duyệt và ảnh hưởng.

## Chi nhánh
Chi/nhánh gắn với người khai chi được phê duyệt. Có thể có cây gốc chưa kết nối trong thời gian nhập liệu, nhưng cách xử lý cần phê duyệt. Không gán chi chỉ từ họ hoặc giới tính.

## Workflow
DRAFT -> SUBMITTED -> NEEDS_INFO / REJECTED / APPROVED.
Chỉ hành động duyệt có thẩm quyền mới cập nhật dữ liệu chính thức. Hiển thị before/after, nguồn, người đề xuất, người duyệt, thời điểm. Kiểm tra version để tránh ghi đè. Duyệt nhiều record liên quan phải nguyên tử hoặc có cơ chế phục hồi.

## Nhập Excel
Mẫu đề xuất: PERSONS, RELATIONS, UNIONS, BRANCHES, INSTRUCTIONS. Sử dụng external_ref trong batch, đối chiếu trùng theo nhiều trường, bắt buộc preview và xác nhận. Không tự gộp hai người có tên giống nhau.

## Ngày tháng
Lưu calendar (solar/lunar), precision, leap_month và raw_text; không tự chuyển ngày âm không đủ thông tin thành ngày dương chính xác.

## Audit
Ghi append-only actor, action, target, before/after summary, timestamp, request ID; hạn chế dữ liệu nhạy cảm trong log. Sửa lịch sử bằng bản điều chỉnh mới, không âm thầm xóa.
