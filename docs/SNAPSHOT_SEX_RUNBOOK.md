# Đồng bộ giới tính vào ảnh chụp cây — hướng dẫn chạy trên production

Mục đích: trang Tổng quan chỉ đếm được giới tính của những người đã có phần tử `sex` trong `treeSnapshots/main`. Ảnh chụp nạp trước 2026-11-13 chưa có phần tử này, nên đa số người hiện là "Chưa đồng bộ" (ví dụ 446/449). Lệnh dưới đây **sao chép** `persons.sex` vào ảnh chụp; không suy đoán giới tính từ tên, không tăng `editVersion`, không đổi `persons`. Người có `sex` rỗng ở `persons` vẫn hiện "Chưa rõ" (đúng thực tế dữ liệu).

Tham chiếu: [OPERATIONS.md](OPERATIONS.md) (mục "Đồng bộ giới tính"), [PROD_ROLLOUT.md](PROD_ROLLOUT.md) (cổng production).

## Chuẩn bị (làm một lần, trên laptop)
1. Mở PowerShell trong thư mục dự án, `git pull` bản mới nhất, `npm ci` rồi `npm --prefix functions ci`.
2. Cần khóa service account của project `gia-pha-nguyen-duc-prod` (JSON). Khóa cũ có thể đã xóa theo PROD_ROLLOUT; nếu vậy tạo khóa mới: Google Cloud Console → project prod → IAM & Admin → Service Accounts → chọn tài khoản có quyền đọc/ghi Firestore → Keys → Add key → JSON. Lưu file **ngoài thư mục dự án**, không gửi vào chat, không commit.
3. Đặt biến môi trường (chỉ trong cửa sổ PowerShell này):
   `$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\duong-dan\khoa-prod.json"`
4. (Khuyến nghị, không bắt buộc) diễn tập trước trên dev: `npm run gia-pha:snapshot-sex -- --project gia-pha-nguyen-duc-dev`.

## Bước 1 — chạy thử, chỉ đọc
```
npm run gia-pha:snapshot-sex -- --project gia-pha-nguyen-duc-prod
```
Kết quả mong đợi: dòng "chạy thử (chỉ đọc): prod / gia-pha-nguyen-duc-prod", các số đếm nam/nữ/chưa rõ/cần đổi (tổng ≈ 449), và **editVersion hiện tại**. Không in tên. Hãy ghi lại số `editVersion`.
Dừng và báo lại (đừng chạy bước 2) nếu lệnh từ chối: có người trong ảnh chụp không có hồ sơ `persons`/đã ẩn, `sex` có giá trị lạ, hoặc vượt trần kích thước.

## Bước 2 — ghi (chỉ khi bước 1 sạch lỗi)
Thay `N` bằng đúng editVersion đã thấy ở bước 1:
```
npm run gia-pha:snapshot-sex -- --project gia-pha-nguyen-duc-prod --apply --expect-version N --confirm gia-pha-nguyen-duc-prod --ack "DONG BO GIOI TINH gia-pha-nguyen-duc-prod"
```
Lệnh ghi trong một giao dịch và tạo nhật ký `auditLogs/maint-snapshot-sex-<thời gian>` (`SNAPSHOT_SEX_SYNCED`, chỉ số đếm). Nếu báo editVersion đã đổi (có người vừa sửa trong app) thì chạy lại bước 1 để lấy số mới. Chạy lại lệnh là an toàn (idempotent).

## Bước 3 — kiểm tra
1. `npm run gia-pha:reconcile -- --project gia-pha-nguyen-duc-prod` (chỉ đọc): không còn `SEX_MISMATCH` và `SEX_NOT_IN_SNAPSHOT`.
2. Mở trang Tổng quan, bấm **Tải lại dữ liệu** (hoặc Ctrl+F5): bảng Giới tính có số Nam/Nữ gần đủ tổng, dòng "Chưa đồng bộ" bằng 0, cảnh báo "chưa phản ánh toàn bộ" biến mất.
3. Mọi tab đang mở bản cũ của trang phải tải lại (Ctrl+F5).

## Hoàn tác
`npm run gia-pha:snapshot-sex -- --project gia-pha-nguyen-duc-prod --strip` (kèm các tham số `--apply --expect-version N --confirm ... --ack ...` như bước 2) cắt ảnh chụp về 7 phần tử, bỏ giới tính khỏi ảnh chụp.

## Sau khi xong
Xóa khóa service account vừa tạo (Cloud Console → Keys → Delete) và `Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS`.
