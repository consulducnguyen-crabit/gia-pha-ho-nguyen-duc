# Màn hình cây gia phả và hồ sơ

- **Nguồn dữ liệu:** một lượt `getDocFromServer(treeSnapshots/main)` cho mỗi phiên, giữ trong bộ nhớ (không lưu đĩa). Rules chỉ cho thành viên được cấp quyền `get` tài liệu này; không có `list`, không có ghi từ client. Nội dung chỉ gồm tên, năm sinh/mất, đời, chi và quan hệ; ngày đầy đủ, kỵ nhật, giới tính và ghi chú không nằm trong ảnh chụp (xem DATA_IMPORT.md).
- **Cây (`/tree`):** danh sách lồng thu gọn/mở rộng theo dòng truyền dòng từ thủy tổ (mặc định mở 3 đời), có tìm theo tên không dấu, lọc theo chi, nút mở/thu gọn tất cả. Người kết hôn vào hiển thị cạnh người trong dòng; con của con gái (họ ngoại) chỉ hiện khi bật tùy chọn. Con nuôi tính đời theo dòng, ghi chú bằng nhãn "Con nuôi" cùng kiểu với các nhãn khác (không dùng màu cảnh báo).
- **Hồ sơ (`/person/:id`):** năm sinh/mất, đời, chi, dòng tổ tiên, cha mẹ, vợ/chồng, con, anh chị em. Chưa hiển thị ghi chú riêng tư trên trang hồ sơ (quản trị viên xem/sửa trong form "Sửa hồ sơ").
- **Cache và phiên bản:** `dataVersion` của ảnh chụp là mã lô nạp. Sau khi nạp lại phải tải lại trang để thấy dữ liệu mới. Backend tương lai phải dựng lại ảnh chụp mỗi khi áp dụng thay đổi.
- **Giới hạn:** ảnh chụp là một tài liệu Firestore (giới hạn 1 MiB; hiện khoảng vài chục KB cho ~450 hồ sơ). Khi vượt ~5.000 hồ sơ cần chia theo chi. Chưa có sơ đồ đồ họa; danh sách lồng phù hợp mobile.
- **Kiểm chứng:** 28 unit test (logic cây dùng chính bộ dựng ảnh chụp của script nạp), 36 rules test (6 test mới cho `treeSnapshots`), kịch bản trình duyệt `scripts/tree-browser-check.mjs` với dữ liệu giả (360/768/1280 px).
- **Phông:** Georgia thiếu một số chữ Việt hai dấu (ví dụ "ồ"); thêm phông dự phòng hệ thống chỉ cho dải U+1EA0–1EF9 trong tiêu đề.
