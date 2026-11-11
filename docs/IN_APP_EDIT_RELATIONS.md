# Đổi cha/mẹ và loại con nuôi/ruột trong app (PR C2a)

Trang hồ sơ của quản trị viên có mục **Quan hệ cha mẹ (quản trị)**: đổi loại con nuôi/ruột cho từng
quan hệ và nút **Đặt hoặc đổi cha/mẹ**. Xóa mềm người/quan hệ và khôi phục là PR C2b.

## Quy tắc (src/editRelation.ts, hàm thuần `applyRelation`)

- `setParent` đặt cha hoặc mẹ cho một người đã có. Vai trò do người dùng chọn rõ, không suy từ giới tính;
  từ chối cha là nữ / mẹ là nam theo giới tính đã ghi.
- **Thay cha/mẹ đang có cần xác nhận** (`CONFIRM_REQUIRED`). Quan hệ cũ KHÔNG bị xóa cứng: tài liệu được
  đánh dấu `deleted`, `deletedAt/By`, `replacedBy`; snapshot bỏ dòng đó; nhật ký ghi quan hệ cũ (`before.removed`).
- Chống vòng lặp: không chọn con cháu (kể cả qua mẹ) làm cha/mẹ. Thủy tổ không thể có cha.
- Người thuộc dòng họ chỉ có cha thuộc dòng họ và đã nối tới thủy tổ (có đời): không tạo thủy tổ thứ hai.
  Nối một nhóm "mồ côi" vào cây tính lại đời cho cả nhánh.
- `lineageTransmission` = vai trò cha và cả hai thuộc dòng họ; con nuôi vẫn truyền dòng.
- Đời tính lại chỉ trong snapshot (`recomputeGenerations`), `persons.generation` là giá trị lịch sử.
- Không tạo lại một quan hệ đã từng có (kể cả đã ẩn): cần chức năng khôi phục (C2b).
- `setRelationType` đổi nuôi/ruột; `version` của quan hệ tăng 1; đời không đổi.

## Rules

Sự kiện `PARENT_CHANGED` (tạo quan hệ mới, ẩn quan hệ cũ nêu trong `removedRelationIds`) và
`RELATION_TYPE_CHANGED` (cập nhật `relationType`). Cập nhật quan hệ chỉ được đổi đúng các khóa cho phép,
`version` + 1, quan hệ phải thuộc người nêu trong nhật ký; không xóa cứng. Admin được `get` quan hệ theo mã
(không liệt kê). Snapshot chỉ cập nhật khi quan hệ mới được tạo / quan hệ cũ đã ẩn / phiên bản quan hệ tăng.

## Giới hạn đã biết

- Đổi cha sang người thuộc chi khác KHÔNG tự đổi chi của người con và cháu; cần sửa chi bằng form sửa hồ sơ.
- Quan hệ đã ẩn chưa khôi phục được trong app (C2b); `functions/src/proposals.ts` (chỉ emulator) chưa lọc
  `deleted` khi kiểm đồ thị; `counts.relations` của snapshot không được cập nhật khi thêm/ẩn quan hệ.

- Rules không kiểm nội dung JSON snapshot và không kiểm hai vai trò trong một lô; script đối soát (PR D).
- Chưa thử giới hạn truy cập tài liệu của rules trên Firestore thật.
- Chưa đổi loại người (dòng họ ↔ họ ngoại) và chưa chuyển nhóm mồ côi bằng thao tác riêng.

## Kiểm thử

`tests/editRelation.test.ts`, `tests/editRules.test.ts` (nhóm "đổi cha/mẹ và loại con"),
`scripts/edit-browser-check.mjs` (đặt cha cho người chưa nối, thay cha có xác nhận, đổi sang con nuôi).
