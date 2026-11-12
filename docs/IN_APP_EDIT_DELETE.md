# Ẩn người (xóa mềm) và khôi phục trong app (PR C2b)

Trang hồ sơ của quản trị viên có hai nút: **Ẩn người này khỏi cây** và **Khôi phục người đã ẩn**.
Không có xóa cứng ở bất kỳ đâu.

## Chính sách (src/editDelete.ts, hàm thuần `applyDelete`)

- Chỉ ẩn được người **không còn con** (kể cả con nuôi), **không phải người sáng lập chi**, có **tối đa một** quan hệ
  vợ/chồng. Còn con thì phải đổi cha/mẹ của các con trước (C2a). Cần tích xác nhận (`CONFIRM_REQUIRED`).
- Ẩn = một lô nguyên tử: `persons/{id}` (`deleted`, `deletedAt/By`, `deletedAtVersion`, `profileVersion` + 1),
  `memberProfiles/{id}` bị **xóa** (thành viên không còn thấy tên), các quan hệ cha/mẹ của người đó và quan hệ vợ/chồng
  (nếu có) đánh dấu `deleted` + `deletedWith`, snapshot gỡ các hàng đó, nhật ký `PERSON_DELETED`.
- Nhật ký lưu các hàng snapshot đã gỡ trong `before.rows` (MỘT chuỗi JSON, vì Firestore không cho mảng lồng mảng).
- Khôi phục (`PERSON_RESTORED`) cần mã người + số phiên bản nhật ký của lần ẩn (`edit-N`, hiện trong thông báo khi ẩn).
  Từ chối nếu số không khớp `deletedAtVersion`, nhật ký sai sự kiện/người, hoặc cha/mẹ/vợ/chồng hiện không còn trong cây
  (phải khôi phục người đó trước). Đời tính lại sau khi khôi phục; `memberProfiles` tạo lại từ `persons` + năm trong nhật ký.

## Rules

`lifecycleGate` + nhánh `PERSON_DELETED/PERSON_RESTORED` ở persons, memberProfiles (delete/create), relations và unions
(update đúng khóa cho phép, đúng id nêu trong nhật ký, snapshot chỉ đổi khi các tài liệu này đổi trong cùng lô). Người đã ẩn
không sửa được và không được chọn làm cha/mẹ (quan hệ mới kiểm `deleted`).

## Giới hạn đã biết

- Rules chỉ client-kiểm (script đối soát bắt): ẩn người còn con (rules không liệt kê được con), số phiên bản khôi phục khớp
  `deletedAtVersion` ở nhật ký, khôi phục khi cha/mẹ hay vợ/chồng còn đang ẩn, `normalizedName`/năm của bản thành viên tạo lại.
- Khi khôi phục, các trường `deletedAt/By/With/AtVersion` cũ vẫn còn: chỉ `deleted` là nguồn sự thật. Rules chặn khôi phục
  quan hệ đã bị THAY THẾ (`replacedBy`), và không cho tạo vợ/chồng mới với người đang ẩn.
- Người có hơn hai quan hệ cha/mẹ (ruột + nuôi + mẹ) chưa ẩn được (thông báo rõ từ lõi).
- Sau khi ẩn, app chuyển tới cha/mẹ, vợ/chồng hoặc thủy tổ để hiện thông báo kèm mã người và số phiên bản.
- Người đã ẩn không liệt kê được trong app: phải nhớ mã người và số phiên bản (nằm trong thông báo và nhật ký).
- Rules chỉ kiểm quan hệ đầu tiên trong lô ẩn/khôi phục và không kiểm nội dung JSON snapshot; script đối soát (PR D).
- Quan hệ cha/mẹ cũ đã bị thay thế (C2a) vẫn chưa khôi phục được riêng lẻ.
- `functions/src/proposals.ts` (emulator-only) chưa lọc `deleted`; cờ `DUP_NAME` của người trùng tên kia không tự cập nhật (xem IN_APP_EDIT.md).
- Người có nhiều hơn một quan hệ vợ/chồng chưa ẩn được.
- Chưa thử trên Firestore thật (chỉ emulator).

## Kiểm thử

`tests/editDelete.test.ts` (lõi), `tests/editRules.test.ts` nhóm "ẩn và khôi phục người", `scripts/edit-browser-check.mjs`
(ẩn → trang người biến mất → khôi phục, kiểm tài liệu, không tràn ngang 360/1280).
