# Trang "Nhật ký chỉnh sửa" (PR-7)

Route `#/audit`, menu "Nhật ký chỉnh sửa", chỉ hiện khi `canManageMembership` (đã xác nhận từ máy chủ). Thành viên
thường vào `#/audit` thấy "Không tìm thấy trang". Quyền thật nằm ở rules (`auditLogs` cho `manager()` đọc theo mã,
chỉ 12 sự kiện sửa; không liệt kê). PR này KHÔNG đổi `firestore.rules`.

## Cách đọc

- Đọc `treeSnapshots/main` (dùng lại `loadTreeIndex` của `Tree.tsx`) để lấy `editVersion = n` và tra tên người.
- Bản ghi `auditLogs/edit-{k}`, k từ n xuống 1 (bản mới nhất là `edit-n`), mỗi lần 20 bản (`Promise.allSettled`), nút
  "Xem thêm". "Tải toàn bộ" có trần 500 bản đã tải; mỗi bản là một lượt đọc Firestore (giao diện ghi rõ).
- Mã thiếu cũng trả `permission-denied` (rules cần `resource.data`), nên không phân biệt được "thiếu" và "ngoài phạm vi":
  dòng "Không đọc được bản ghi #k (thiếu hoặc ngoài phạm vi)". Nếu CẢ loạt (từ 2 bản) đều bị từ chối thì báo mất quyền
  và dừng. Lỗi mạng/`unavailable` không bị coi là thiếu: hiện nút "Thử lại" cho đúng các bản lỗi.
- Người thực hiện: `get users/{actorUid}` mỗi uid một lần; hiện `displayName` hoặc email, thêm "(đã thu hồi)" nếu
  `enabled != true`; lỗi thì hiện uid rút gọn `abcd…wxyz`.

## Hiển thị và quyền riêng tư (mặc định thận trọng)

- Bảng chỉ hiện NĂM sinh/mất. Ngày đầy đủ (ngày/tháng, âm lịch, văn bản gốc) chỉ ở phần "Chi tiết" (`<details>`).
- Ghi chú riêng chỉ hiện "đã thay đổi (x → y ký tự)"; không đọc `personPrivate`.
- Không `console.log` bản ghi, không xuất CSV, không analytics.
- before/after/fields là dữ liệu không tin cậy: kiểm kiểu từng trường, cắt chuỗi quá 200 ký tự, bỏ ký tự điều khiển,
  chỉ render bằng text React, `JSON.parse(before.rows)` bọc try/catch và giới hạn 100.000 ký tự.
- Liên kết `/person/{id}` chỉ khi mã khớp `^[A-Za-z0-9_-]{1,100}$` VÀ người có trong ảnh chụp cây hiện tại. Người đã ẩn
  hoặc không có trong cây: không liên kết, lấy tên từ `before.rows` nếu có, kèm "(đã ẩn)".
- Nhãn tiếng Việt cho cả 12 sự kiện; sự kiện lạ hiện "Sự kiện khác (mã)". Danh sách trong `src/auditView.ts` được
  test đối chiếu với `firestore.rules` (cả `allow get` lẫn `auditCreateOk`).

## Giới hạn đã biết

- Lọc (theo sự kiện, theo mã/tên người) chỉ áp dụng trong các bản ĐÃ TẢI; giao diện ghi rõ "lọc trong N bản đã tải".
- Nhật ký giữ vĩnh viễn dữ liệu của người đã ẩn (tên, năm sinh trong `before.rows`...); SECURITY_RULES mục 13
  (lưu giữ/xóa/chỉnh sửa theo yêu cầu) chưa được giải quyết. Xem OPEN_DECISIONS.md.
- Tên người lấy từ ảnh chụp cây HIỆN TẠI, không phải tên tại thời điểm sửa (tên cũ/mới nằm trong dòng tóm tắt).
- Chưa triển khai rules lên production; trên prod trang sẽ báo không đọc được cho tới khi rules được duyệt triển khai.

## Kiểm thử

- `tests/auditView.test.ts`: 12 sự kiện, dữ liệu độc/rác, mã không an toàn, `rows` hỏng, ghi chú không lộ, giờ VN,
  phân trang tới 1, lọc, phân loại lỗi đọc.
- `tests/editRules.test.ts` (mục "đọc nhật ký"): admin đọc đủ 12 sự kiện; mã không tồn tại, admin bị tắt, thành viên
  thường, ẩn danh bị từ chối; so khớp danh sách sự kiện giữa `allow get` và `auditCreateOk`.
- `scripts/audit-browser-check.mjs` (Chromium + emulator, dữ liệu giả; trong CI job `browser`):

      CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
        "node scripts/audit-browser-check.mjs"
