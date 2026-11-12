# Đưa dữ liệu thật lên production (cổng an toàn)

Project: `gia-pha-nguyen-duc-prod`. Mọi bước **ghi** lên prod cần bạn xác nhận. Cổng bắt buộc cho thao tác ghi dữ liệu thật:
1. đúng project prod và `--confirm <project>`;
2. câu xác nhận gõ tay `--ack "<HÀNH ĐỘNG> <project>"`;
3. với nạp/khôi phục-ghi-đè: **bản sao lưu mới** `--backup-dir` (tạo trong 30 phút, cùng project, qua `verify`, **khớp Firestore hiện tại**). Cổng tự kiểm tra, không tin lời khai.
Quản lý tài khoản prod chỉ cần confirm + ack (không cần sao lưu).

## Điều kiện trước
- [ ] Đã rà soát Excel thật (`private-data\gia-pha-ban-nhap.xlsx`); chấp nhận các mục gắn cờ "Cần kiểm tra".
- [ ] Khóa service account **prod** lưu ngoài repo; đặt `GOOGLE_APPLICATION_CREDENTIALS`.
- [ ] Prod đã bật Google + Email/Password và domain `consulducnguyen-crabit.github.io`; Firestore đã tạo (asia-southeast1).
- [ ] Biết gmail quản trị viên đầu tiên.
- [ ] Đã có cụm mật khẩu sao lưu (`GIA_PHA_BACKUP_PASSPHRASE`, ≥ 12 ký tự) cất ở nơi an toàn khác nơi lưu bản sao lưu.

## Các bước
1. **Deploy rules + index lên prod** (xác nhận): `npx firebase deploy --only firestore --project prod`.
2. **Sao lưu trạng thái hiện tại của prod** (rỗng lần đầu):
   `npm run gia-pha:backup -- backup --out backups --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod`
3. **Kiểm tra sẵn sàng**: `npm run gia-pha:backup -- gate-check --dir backups/<thư mục vừa tạo> --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod` → phải ra `SẴN SÀNG`.
4. **Chạy thử nạp** (không ghi): `npm run gia-pha:import -- --input private-data/gia-pha.txt` (in số lượng, kiểm tra lỗi).
5. **Nạp thật** (trong 30 phút sau bước 2):
   `npm run gia-pha:import -- --input private-data/gia-pha.txt --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod --ack "NAP DU LIEU THAT gia-pha-nguyen-duc-prod" --backup-dir backups/<thư mục> --apply`
6. **Quản trị viên đầu tiên**: `npm run gia-pha:accounts -- grant --email <gmail> --name "Họ tên" --admin --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod --ack "QUAN LY TAI KHOAN gia-pha-nguyen-duc-prod" --apply`
7. **Sao lưu sau nạp** (bản gốc đầu tiên của dữ liệu thật), cất ở hai nơi.
8. **Chuyển trang Pages sang prod** (xác nhận): đặt lại 5 GitHub Variables `VITE_FIREBASE_*` bằng cấu hình web của prod (`npx firebase apps:sdkconfig WEB <appId> --project prod`) rồi `gh workflow run pages.yml --ref main`. Từ lúc này trang hiển thị dữ liệu thật; dữ liệu demo ở dev không còn hiện trên trang.
9. **Kiểm tra**: đăng nhập Google bằng quản trị viên; xem cây, hồ sơ, "Cần kiểm tra", Quản lý tài khoản; thử tài khoản chưa cấp quyền (phải bị chặn).

## Vòng làm sạch dữ liệu sau khi nạp
Sửa `private-data/gia-pha.txt` → `npm run gia-pha:excel` (kiểm tra) → sao lưu mới → `gate-check` → nạp lại với `--replace` (cùng cổng và `--backup-dir` mới). Mỗi lần nạp lại phải tải lại trang để thấy dữ liệu mới. Cấp/thu hồi tài khoản không cần nạp lại.

**Chỉ áp dụng khi CHƯA có sửa trong app.** Sau khi có `auditLogs/edit-N` (`editVersion > 0`), nạp lại sẽ GHI ĐÈ các sửa trong app nên script CHẶN `--replace` trên prod (xem [INTEGRITY_GUARD.md](INTEGRITY_GUARD.md), [IN_APP_EDIT.md](IN_APP_EDIT.md)). Từ mốc đó dữ liệu được làm sạch bằng form trong app; file nguồn không còn là nguồn sự thật.

## Rollback
- Nạp hỏng giữa chừng (trước khi có sửa trong app): chạy lại nạp với `--replace` (idempotent), hoặc khôi phục (khôi phục từ sao lưu phải giữ `editVersion` lớn nhất của `auditLogs/edit-*`, xem BACKUP.md): `gia-pha:backup -- restore --dir <bản sao lưu trước> --replace --project ... --confirm ... --ack "KHOI PHUC <project>" --pre-backup-dir <bản sao lưu mới của trạng thái hiện tại> --apply`.
- Rules: deploy lại bản trước, luôn giữ mặc định từ chối.
- Pages: đặt lại Variables về dev (hoặc xóa) rồi chạy workflow.

## Rules sửa trong app
Các chức năng sửa trong app (sửa hồ sơ, thêm con/vợ chồng, đổi cha/mẹ, ẩn/khôi phục, hoàn tác thay cha/mẹ) cần rules mới trên prod. Thứ tự: sao lưu đã kiểm chứng → thử trên dev → `npm run gia-pha:reconcile` (chỉ đọc) → deploy rules → deploy frontend (Pages tự phát hành khi merge vào `main`) → đối soát lại. Frontend mới chạy với rules cũ bị từ chối an toàn (nút lưu báo "Không có quyền"). Deploy rules prod cần người dùng duyệt rõ ràng.

## Chưa có
App Check, cảnh báo ngân sách khi nâng Blaze, lịch sao lưu tự động, luồng đề xuất/duyệt (cần Blaze).
