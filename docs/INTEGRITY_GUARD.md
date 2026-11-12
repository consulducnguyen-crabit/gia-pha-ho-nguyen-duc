# Chặn ghi đè và đối soát dữ liệu (PR D)

Sau khi có sửa trong app, Firestore là nguồn dữ liệu duy nhất. PR này thêm hai lớp bảo vệ.

## 1. Chặn `--replace` (scripts/gia-pha/replace-guard.ts)

`npm run gia-pha:import -- --replace` xóa rồi nạp lại từ file nguồn, nên sẽ **ghi đè mọi sửa trong app**.
Số lần sửa = lớn nhất của `treeSnapshots/main.editVersion` và `editVersion` trong nhật ký sửa (gồm cả `PERSON_DELETED/RESTORED`).

| Đích           | editVersion = 0 | editVersion > 0                                     |
| -------------- | --------------- | --------------------------------------------------- |
| prod           | như cũ (cổng)   | **cấm hẳn** (không có cờ vượt qua)                  |
| dev / emulator | như cũ          | cần thêm `--discard-app-edits`, nếu không thì cấm   |

Cần quay lại dữ liệu cũ trên prod thì dùng khôi phục từ sao lưu (`gia-pha:backup`), không dùng `--replace`.
Danh sách sự kiện nhật ký dùng chung (`EDIT_EVENTS`); trước đây bản trong script thiếu sự kiện ẩn/khôi phục. Nay gồm cả `PARENT_REMOVED` và `PARENT_REMOVAL_UNDONE` (gỡ/khôi phục quan hệ cha/mẹ) và `UNION_REMOVED` / `UNION_REMOVAL_UNDONE` (gỡ/khôi phục liên kết vợ/chồng). Quan hệ đã gỡ có `deleted: true` nên đối soát bỏ qua đúng (không phải "không còn trong snapshot").

## 2. Đối soát (`npm run gia-pha:reconcile`, CHỈ ĐỌC)

Rules không phân tích JSON snapshot nên script này là lớp kiểm cuối. Chạy trên emulator
(`FIRESTORE_EMULATOR_HOST`), dev (`--project …-dev`) hoặc prod (`--project <prod>`, cần
`GOOGLE_APPLICATION_CREDENTIALS`; chỉ đọc nên không qua cổng ghi). Thoát 1 nếu có sai lệch.
Kết quả chỉ gồm **mã lỗi và mã tài liệu**, không in tên hay ghi chú.

Kiểm tra: người trong snapshot ↔ `persons` chưa ẩn (hai chiều), tên/loại/chi khớp, `memberProfiles` tồn tại cho người
chưa ẩn và không còn cho người đã ẩn; quan hệ cha/mẹ ↔ `relations` chưa ẩn (hai chiều, vai trò, nuôi/ruột,
truyền dòng); không có hai cha/mẹ cùng vai trò và cùng loại (ruột/nuôi, như quy tắc nạp); không tự làm cha mẹ; không vòng lặp; đúng một thủy tổ và đời khớp tính lại;
năm sinh/mất và cờ cần kiểm tra khớp `memberProfiles`/`persons`; vợ/chồng ↔ `unions` (đầu mút, `partnerIds`); liên kết đã gỡ (`removedAtVersion` khác null) phải có `deleted: true` và không `deletedWith` (mã `UNION_REMOVED_BAD_STATE`); `editVersion` của snapshot khớp số lớn nhất trong nhật ký, nhật ký liên tục từ 1, không trùng số.

Kiểm thử: `tests/reconcile.test.ts`, `tests/replaceGuard.test.ts`, và `scripts/edit-browser-check.mjs` chạy đối soát
sau một chuỗi sửa thật (thêm con/vợ chồng, đổi cha mẹ, ẩn, khôi phục): phải ĐẠT.

## Lưu ý vận hành

- Mã người trong dữ liệu thật có thể suy từ tên: không đưa output đối soát của prod vào log CI hay issue công khai.
- Không sửa trong app khi đang chạy `--replace` (khe đua giữa lúc kiểm tra editVersion và lúc xóa).
- `persons.generation` chỉ là giá trị lịch sử (đời tính trong snapshot) nên không được đối soát.

## Chưa làm trong PR này

- Sao lưu định kỳ tự động: cần cụm mật khẩu và khóa service account do người dùng đặt; chạy tay `gia-pha:backup` đến khi có.
- Cờ `DUP_NAME` của người trùng tên còn lại không tự cập nhật (form chỉ tự gắn/gỡ cho người đang sửa, xem IN_APP_EDIT.md).
- Chưa chạy đối soát trên dữ liệu prod thật (cần khóa của người dùng).
- Chưa tự chạy đối soát trong CI hay theo lịch.
