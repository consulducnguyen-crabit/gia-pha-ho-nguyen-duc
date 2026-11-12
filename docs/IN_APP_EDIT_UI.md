# Biểu mẫu sửa hồ sơ (PR B)

Trang hồ sơ `#/person/:id` có nút **Sửa hồ sơ** chỉ khi tài khoản có `canManageMembership` (đọc từ
`users/{uid}` đã xác nhận từ máy chủ). Quyền thật nằm ở rules (PR A); nút chỉ là gợi ý giao diện.

- Mở biểu mẫu đọc `persons/{id}` và `personPrivate/{id}` từ máy chủ (giới tính, ghi chú, ngày gốc).
- Trường: họ tên, năm sinh, năm mất, giới tính, chi, ghi chú riêng, các cờ "Cần kiểm tra"
  (bỏ tích = đã xác minh). Chỉ trường đã đổi được gửi (`src/editForm.ts`).
- Ngày gốc có tháng/ngày được giữ khi đổi năm; ngày gốc "không rõ/mâu thuẫn" cần tích xác nhận.
- Lưu qua `commitEdit` với `expectedVersion = editVersion` đã đọc. Xung đột phiên bản, mất quyền,
  mất mạng đều báo tiếng Việt và không ghi gì; sau khi lưu cây được tải lại từ máy chủ.
- Quan hệ cha mẹ/con/vợ chồng được sửa ở các mục riêng (xem IN_APP_EDIT_ADD.md, IN_APP_EDIT_RELATIONS.md, IN_APP_EDIT_DELETE.md).
- Rules sửa dữ liệu CHƯA được triển khai lên production: trên prod, nút lưu sẽ báo "Không có quyền"
  cho tới khi quản trị viên phê duyệt triển khai rules.

Kiểm thử: `tests/editForm.test.ts`, `tests/treeModel.test.ts` (đơn vị) và
`scripts/edit-browser-check.mjs` (Chromium + emulator, dữ liệu giả; kiểm tra thành viên không thấy nút,
lỗi gần trường, không tràn ngang ở 360/768/1280, lưu thật qua rules, xác nhận ngày gốc, gỡ cờ, xung đột):

    CHROMIUM_PATH=... npx firebase emulators:exec --project demo-gia-pha --only auth,firestore \
      "node scripts/edit-browser-check.mjs"
