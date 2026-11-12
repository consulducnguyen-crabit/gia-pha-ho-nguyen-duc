# Danh sách nghiệm thu (Giai đoạn 2)

Dành cho người dùng không chuyên kỹ thuật. Làm lần lượt từ trên xuống. Mỗi mục có: **Làm gì**, **Đúng là**, **Ghi nhận**.

Dùng hai tài khoản: tài khoản **quản trị** của bạn và tài khoản thử thành viên thường `thu-nghiem@gia-pha.test` (mật khẩu do bạn giữ; không ghi vào tài liệu hay chat).

Cách ghi nhận chung: đánh dấu Đạt / Không đạt cạnh mỗi mục; nếu không đạt thì chụp màn hình (xem mục "Báo lỗi cho Claude" ở cuối).

## Hiểu rõ trước khi thử

- Trang GitHub Pages hiện đang nối **dữ liệu thật (prod)**. Rules sửa trong app đã được cài lên prod ngày 2026-11-13.
- Phần A chỉ xem/đọc; thao tác **ghi** thuộc Phần B và là ghi dữ liệu thật.
- Phần B chỉ làm **sau khi** đã cài rules lên prod (đã làm 2026-11-13; xem `PROD_ROLLOUT.md`, mục "Thứ tự phát hành Giai đoạn 3").

---

## Phần A. Thử được NGAY trên trang Pages hiện tại

### A1. Đăng nhập quản trị

- **Làm gì:** mở trang Pages, đăng nhập bằng tài khoản quản trị.
- **Đúng là:** vào được trang chủ, thấy menu gồm "Quản lý tài khoản" và "Nhật ký chỉnh sửa".
- **Ghi nhận:** Đạt/Không đạt. Nếu báo chưa được cấp quyền: chụp màn hình.

### A2. Xem cây gia phả

- **Làm gì:** vào "Cây"; mở/thu gọn vài nhánh; dùng ô tìm kiếm trong cây.
- **Đúng là:** cây hiện đúng tên và năm sinh/mất, mặc định mở 3 đời; tìm tên ra đúng người.
- **Ghi nhận:** nếu thấy một người sai tên/sai đời/sai cha mẹ, ghi tên người và điều sai (đây là việc sửa dữ liệu, không phải lỗi app).

### A3. Tra cứu người

- **Làm gì:** vào trang tra cứu; gõ vài chữ đầu của một họ tên.
- **Đúng là:** ra danh sách tối đa 30 người, bấm vào mở được hồ sơ.
- **Ghi nhận:** Đạt/Không đạt.

### A4. Lọc theo chi và thông tin chi

- **Làm gì:** ở cây, chọn một chi trong bộ lọc.
- **Đúng là:** chỉ hiện người của chi đó; hiện khối thông tin chi (tên chi, thủy tổ chi hoặc "Chưa ghi nhận", nguồn gốc hợp nhất nếu có). Trong hồ sơ người của chi có nguồn gốc hợp nhất sẽ có dòng "Chi này có nguồn gốc hợp nhất từ: ...". Quản trị viên thấy thêm "Ghi chú quản trị (chi)".
- **Ghi nhận:** Đạt/Không đạt; ghi tên chi nếu thông tin chi có vẻ sai.

### A5. Trang "Cần kiểm tra"

- **Làm gì:** mở "Cần kiểm tra".
- **Đúng là:** hiện danh sách người bị gắn cờ cần rà soát; bấm vào mở được hồ sơ.
- **Ghi nhận:** ghi số lượng hiển thị (để so sánh sau này).

### A6. Trang "Nhật ký chỉnh sửa" (quản trị)

- **Làm gì:** mở menu "Nhật ký chỉnh sửa" (địa chỉ `#/audit`).
- **Đúng là (lúc này):** báo **không đọc được** nhật ký, vì rules prod còn bản cũ. Đây là bình thường; không phải lỗi. Trang không bị trắng, không treo.
- **Ghi nhận:** Đạt nếu báo lỗi nhẹ nhàng; Không đạt nếu trắng trang hoặc treo.

### A7. Tài khoản thành viên thường không thấy công cụ quản trị

- **Làm gì:** đăng xuất, đăng nhập bằng `thu-nghiem@gia-pha.test`. Mở một hồ sơ người; nhìn menu.
- **Đúng là:** KHÔNG có nút "Sửa hồ sơ", "Thêm con", "Thêm vợ/chồng", "Ẩn người này khỏi cây"; KHÔNG có menu "Quản lý tài khoản" và "Nhật ký chỉnh sửa"; KHÔNG thấy "Ghi chú quản trị (chi)". Vẫn xem được cây, hồ sơ cơ bản (tên, năm sinh/mất) và tra cứu.
- **Ghi nhận:** Đạt/Không đạt; chụp màn hình nếu thấy bất kỳ nút/menu quản trị nào.

### A8. Chặn truy cập trái phép

- **Làm gì (a):** khi đang đăng nhập bằng tài khoản thử, gõ thẳng địa chỉ trang nhật ký (thêm `#/audit` vào cuối địa chỉ) và trang quản lý tài khoản.
- **Đúng là:** hiện "Không tìm thấy trang" hoặc bị từ chối; không lộ dữ liệu.
- **Làm gì (b):** đăng xuất hẳn, mở trang bằng cửa sổ ẩn danh; thử đăng nhập bằng một tài khoản Google chưa được cấp quyền (nếu có).
- **Đúng là:** không xem được cây/hồ sơ; có thông báo chưa được cấp quyền.
- **Ghi nhận:** Đạt/Không đạt.

### A9. Thử Lưu khi rules chưa cài (tùy chọn, an toàn)

- **Làm gì:** bằng tài khoản quản trị, mở "Sửa hồ sơ" của một người, đổi một chữ rồi Lưu.
- **Đúng là:** báo "Không có quyền"; mở lại hồ sơ thấy dữ liệu **không đổi**.
- **Ghi nhận:** Đạt/Không đạt. Nếu dữ liệu ĐỔI được thì chụp ngay và báo Claude (bất thường).

---

## Phần B. CHỈ thử SAU khi đã cài rules lên prod (đã làm 2026-11-13)

> **CẢNH BÁO:** từ đây là **ghi dữ liệu thật**. Chỉ làm khi rules prod đã cài (đã làm 2026-11-13). Đối soát (`gia-pha:reconcile`, chỉ đọc) là tùy chọn và cần khóa service account prod; chưa chạy trên prod tính đến 2026-11-13.
>
> Quy tắc an toàn: **chọn MỘT người thử** (ví dụ một người đã ít liên quan, ít họ hàng) và dùng riêng người đó cho mọi mục dưới đây. **Ghi lại giá trị cũ** (tên, năm sinh/mất, giới tính, chi, ghi chú, cha/mẹ) trước khi sửa để sửa lại cho đúng sau khi thử. Mỗi thao tác chỉ làm một lần rồi xem kết quả, đừng làm dồn.
>
> Mỗi lần sửa tạo một dòng nhật ký không xóa được. Nhật ký giữ cả tên người đã ẩn.

Ghi sẵn trước khi bắt đầu: tên người thử: ______; giá trị cũ: ______.

### B1. Sửa hồ sơ một người thử (ĐẠT 2026-11-13: người c2-thai-son, nhật ký `edit-1`, `edit-2` hiện đúng ở `#/audit`)

- **Làm gì:** quản trị, mở hồ sơ người thử, bấm "Sửa hồ sơ", đổi một chi tiết nhỏ (ví dụ năm sinh hoặc ghi chú), Lưu.
- **Đúng là:** báo lưu thành công; hồ sơ và cây hiện giá trị mới. Sau đó sửa lại về giá trị cũ, Lưu lần nữa.
- **Ghi nhận:** Đạt/Không đạt; ghi giờ thao tác.

### B2. Thêm con

- **Làm gì:** ở hồ sơ người thử, bấm "Thêm con", nhập tên ghi rõ là thử (ví dụ "Thử Nghiệm Xóa"), Lưu.
- **Đúng là:** người mới xuất hiện dưới người thử trong cây. Nếu trùng tên người khác cùng đời, form chỉ cảnh báo.
- **Ghi nhận:** Đạt/Không đạt. Người này sẽ được ẩn ở B6.

### B3. Đổi cha/mẹ rồi hoàn tác

- **Làm gì:** mở hồ sơ người con vừa thêm; mục "Đổi cha/mẹ hoặc loại con nuôi/...": đổi mẹ (hoặc cha không truyền dòng) sang người khác, Lưu. Sau đó dùng "Hoàn tác lần thay" ở mục Quan hệ.
- **Đúng là:** sau khi đổi, cây hiện cha/mẹ mới; sau hoàn tác, cây hiện lại cha/mẹ cũ.
- **Ghi nhận:** Đạt/Không đạt. Lưu ý: không đổi cha truyền dòng của người dòng họ (app sẽ từ chối/hướng dẫn).

### B4. Gỡ cha/mẹ và khôi phục

- **Làm gì:** gỡ một cha hoặc mẹ không truyền dòng của người con thử, rồi bấm "Khôi phục quan hệ cha/mẹ đã gỡ".
- **Đúng là:** sau gỡ, người con không còn liên kết đó; sau khôi phục, liên kết trở lại như cũ.
- **Ghi nhận:** Đạt/Không đạt.

### B5. Thêm rồi gỡ/khôi phục liên kết vợ/chồng

- **Làm gì:** "Thêm vợ/chồng" cho người thử (tên thử), Lưu. Sau đó ở mục "Quan hệ vợ/chồng (quản trị)" bấm "Gỡ liên kết vợ/chồng với ...", xác nhận; rồi "Khôi phục liên kết đã gỡ".
- **Đúng là:** thêm hiện vợ/chồng; gỡ làm liên kết biến mất; khôi phục đưa lại. Nếu người kia mồ côi hoặc có con chung, app cảnh báo rõ trước khi gỡ.
- **Ghi nhận:** Đạt/Không đạt.

### B6. Ẩn và khôi phục người

- **Làm gì:** ẩn người con thử đã thêm ở B2 bằng "Ẩn người này khỏi cây"; xác nhận. Sau đó dùng "Khôi phục người đã ẩn" (mục quản trị), rồi ẩn lại lần nữa để dọn.
- **Đúng là:** sau ẩn, người không còn trong cây/tra cứu của thành viên thường (kiểm tra bằng tài khoản thử); sau khôi phục, hiện lại.
- **Ghi nhận:** Đạt/Không đạt. **Nếu báo "permission-denied"/"Không có quyền" khi ẩn một người có nhiều vợ/chồng hoặc lô lớn:** dừng ngay, không thử lại nhiều lần, báo Claude (xem rủi ro ở `PROD_ROLLOUT.md`).

### B7. Xem nhật ký

- **Làm gì:** mở "Nhật ký chỉnh sửa".
- **Đúng là:** thấy từng lần sửa ở B1-B6, mới nhất trước, đúng tên sự kiện tiếng Việt, đúng người thực hiện và giờ Việt Nam. Bảng chỉ hiện năm; ngày đầy đủ nằm trong "Chi tiết". Ghi chú riêng chỉ hiện "đã thay đổi (x → y ký tự)".
- **Ghi nhận:** Đạt/Không đạt; chụp trang nếu có dòng lạ.

### B8. Dọn lại và đối soát

- **Làm gì:** đảm bảo người thử đã về giá trị cũ, người "thử" đã ẩn. Báo Claude để chạy lại `gia-pha:reconcile` (chỉ đọc).
- **Đúng là:** đối soát không báo lỗi mới.
- **Ghi nhận:** kết quả đối soát do Claude báo lại.

---

## Báo lỗi cho Claude

Khi một mục Không đạt, gửi trong chat:

1. Mã mục (ví dụ A7, B3).
2. Ảnh chụp màn hình toàn trang (thấy rõ thông báo lỗi và thanh địa chỉ).
3. Giờ thao tác (giờ Việt Nam) và tài khoản đang dùng (quản trị hay tài khoản thử).
4. Các bước bạn đã bấm, và kết quả bạn mong đợi so với kết quả thực tế.
5. Tên người thử đã dùng (không cần dữ liệu nào khác).

**KHÔNG gửi:** mật khẩu, khóa service account (file JSON), mã/token, hay toàn bộ file dữ liệu gia phả. Nếu ảnh có chứa thông tin đó, che đi trước khi gửi.
