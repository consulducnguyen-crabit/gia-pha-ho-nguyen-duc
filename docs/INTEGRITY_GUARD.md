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
Danh sách sự kiện nhật ký dùng chung (`EDIT_EVENTS`); trước đây bản trong script thiếu sự kiện ẩn/khôi phục.

## 2. Đối soát (`npm run gia-pha:reconcile`, CHỈ ĐỌC)

Rules không phân tích JSON snapshot nên script này là lớp kiểm cuối. Chạy trên emulator
(`FIRESTORE_EMULATOR_HOST`), dev (`--project …-dev`) hoặc prod (`--project <prod>`, cần
`GOOGLE_APPLICATION_CREDENTIALS`; chỉ đọc nên không qua cổng ghi). Thoát 1 nếu có sai lệch.
Kết quả chỉ gồm **mã lỗi và mã tài liệu**, không in tên hay ghi chú.

Kiểm tra: người trong snapshot ↔ `persons` chưa ẩn (hai chiều), tên/loại/chi khớp, `memberProfiles` tồn tại cho người
chưa ẩn và không còn cho người đã ẩn; quan hệ cha/mẹ ↔ `relations` chưa ẩn (hai chiều, vai trò, nuôi/ruột,
truyền dòng); mỗi người một cha và một mẹ; không tự làm cha mẹ; không vòng lặp; đúng một thủy tổ và đời khớp tính lại;
vợ/chồng ↔ `unions`; `editVersion` của snapshot khớp số lớn nhất trong nhật ký, nhật ký liên tục từ 1, không trùng số.

Kiểm thử: `tests/reconcile.test.ts`, `tests/replaceGuard.test.ts`, và `scripts/edit-browser-check.mjs` chạy đối soát
sau một chuỗi sửa thật (thêm con/vợ chồng, đổi cha mẹ, ẩn, khôi phục): phải ĐẠT.

## Chưa làm trong PR này

- Sao lưu định kỳ tự động: cần cụm mật khẩu và khóa service account do người dùng đặt; chạy tay `gia-pha:backup` đến khi có.
- Tính lại cờ `DUP_NAME` tự động (hiện admin gắn/gỡ cờ bằng form).
- Chưa chạy đối soát trên dữ liệu prod thật (cần khóa của người dùng).
- Chưa tự chạy đối soát trong CI hay theo lịch.
