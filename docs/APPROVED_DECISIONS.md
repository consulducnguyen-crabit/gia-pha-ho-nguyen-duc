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

## Cập nhật chính sách — 2026-11-11 (thay thế các mục tương ứng ở trên)

Người dùng phê duyệt trực tiếp. Mục nào mâu thuẫn với danh sách trên thì **theo mục này**.

- **(thay mục 2) Con nuôi có tính đời theo dòng.** Ghi chú con nuôi bằng badge/màu nhẹ, không tạo sự phân biệt trong giao diện.
- **Đã thực thi ở backend:** chỉ cha truyền dòng, con nuôi tính đời, và từ chối quan hệ tạo gốc thứ hai (xem BUSINESS_RULES.md).
- **(thay mục 3) Một thủy tổ duy nhất.** Nhánh có nguồn gốc hợp nhất từ dòng khác thì ghi chú nguồn gốc để phân biệt, không tách thành gốc riêng.
- **(thay mục 4) Một người duyệt** cho mọi thay đổi, kể cả quan hệ truyền dòng. Người đề xuất vẫn không tự duyệt. Đã chỉnh mã và test theo mục này.
- **(thay mục 5) Cấp tài khoản:** có trang quản lý người dùng do quản trị viên vận hành. Đăng nhập bằng Gmail (Google) **hoặc** tài khoản do quản trị tạo sẵn (cho thành viên không có Gmail). Đăng nhập chưa đồng nghĩa được cấp quyền; không tự đăng ký, không tự nâng quyền.
- **Truyền dòng nội theo nam giới** (mục 1) được xác nhận. Giới tính thiếu thì để "chưa xác định", không tự đoán.
- **Hồ sơ người kết hôn vào: mức cơ bản** (mục 6) được xác nhận.
- **Hạ tầng:** giai đoạn đầu dùng gói Spark, chỉ tra cứu, chỉ quản trị viên ghi, chưa upload file. Nâng Blaze khi cần Functions production, upload ảnh hoặc export tự động. Repo public.
- **Nhập dữ liệu ban đầu:** từ file gia phả Word (nằm ở `private-data/`, không đưa lên GitHub), chuyển sang Excel, tài khoản quản trị rà soát trước khi nạp.
- **Quyền riêng tư người còn sống (mục 7):** thành viên chỉ thấy tên và năm sinh/mất (`memberProfiles`); nơi ở, nơi làm việc, nghề nghiệp và ghi chú nằm ở `personPrivate`, chỉ quản trị viên xem. Không nhập thông tin sức khỏe. Có thể mở dần sau.

## Cập nhật chính sách — 2026-11-13 (giới tính trong ảnh chụp cây)

- **Người dùng duyệt đưa giới tính (`sex`: M/F/chưa rõ) vào `treeSnapshots/main`**: mọi thành viên được cấp quyền đọc được giới tính của từng người. Thay thế quyết định 2026-11-11 về việc loại giới tính khỏi ảnh chụp; `memberProfiles` vẫn chỉ có tên và năm sinh/mất. Ghi chú, ngày đầy đủ, kỵ nhật vẫn không đưa vào.
- Giới tính chỉ là dữ liệu hiển thị; vẫn KHÔNG suy truyền dòng từ giới tính hoặc họ.
- Triển khai: phần tử thứ 8 của bộ dữ liệu người; backfill ảnh chụp sẵn có bằng `gia-pha:snapshot-sex` (dry-run mặc định; prod cần cổng `DONG BO GIOI TINH`, không cần sao lưu vì chỉ ghi trường phái sinh, hoàn tác bằng `--strip`).

## Cập nhật chính sách — 2026-11-14 (ghi chú hiển thị cho mọi thành viên; "Đã mất")

- **Người dùng duyệt cho mọi thành viên xem ghi chú của từng người** (tooltip ở Cây gia phả). Thay thế phần "ghi chú nằm ở `personPrivate`, chỉ quản trị viên xem" của quyết định 2026-11-11 (mục 7) CHỈ ở phần ghi chú; nơi ở, nơi làm việc, nghề nghiệp vẫn riêng tư.
- Triển khai: ảnh chụp cây chỉ chứa bản cắt 300 ký tự (phần tử thứ 10); bản đầy đủ vẫn ở `personPrivate` (quản trị đọc). Nhãn form đổi thành "Ghi chú (mọi thành viên đã đăng nhập đều xem được)" kèm cảnh báo.
- **Ghi chú đã có KHÔNG tự công bố hàng loạt.** Một ghi chú cũ chỉ lên ảnh chụp khi quản trị viên lưu lại chính người đó trong app (đã thấy nhãn cảnh báo), hoặc khi chạy `gia-pha:snapshot-note` sau dry-run `--show` để rà soát (prod cần cổng `CONG BO GHI CHU`, không cần sao lưu, hoàn tác bằng `--strip`). Chưa chạy trên production.
- **Checkbox "Đã mất"** (`persons.deceased`, phần tử thứ 9) để làm sạch dữ liệu khi biết đã mất mà không rõ năm; có năm mất thì luôn tính là đã mất.

## Cập nhật chính sách — 2026-11-13 (cấp quyền trong app)

Thiết kế do người dùng duyệt; chưa deploy.

- **Cấp quyền trong app qua Firestore rules** (gói Spark, không Cloud Functions): quản trị viên bật/tắt, nâng/hạ quyền quản trị, đổi tên hiển thị; sổ `accessControl/admins` giữ bất biến "quản trị viên khi và chỉ khi users đang bật + canManageMembership" (SECURITY_RULES.md).
- **Lời mời qua email**; **đăng nhập không mật khẩu bằng liên kết email** được chấp nhận làm cách vào (provider `password` được cho phép khi email đã xác minh).
- **Lời mời chỉ cấp vai trò Chỉ xem** (Q1=A); không mời quản trị viên bằng lời mời. Nâng quyền quản trị là bước riêng của quản trị viên hiện hữu.
- Vẫn: đăng nhập chưa đồng nghĩa được cấp quyền; không tự đăng ký, không tự nâng quyền.
