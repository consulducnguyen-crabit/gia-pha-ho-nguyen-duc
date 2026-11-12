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
(Các bước 1-9 là đợt nạp dữ liệu ban đầu; phát hành rules sửa trong app theo "Thứ tự phát hành Giai đoạn 3" ở dưới.)
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
- Nạp hỏng giữa chừng (trước khi có sửa trong app): chạy lại nạp với `--replace` (idempotent), hoặc khôi phục (`restore --replace` xóa rồi ghi lại mọi collection có trong bản sao lưu, kể cả `auditLogs` và `treeSnapshots`: các lần sửa trong app SAU thời điểm sao lưu bị mất cùng nhật ký của chúng; xem [IN_APP_EDIT.md](IN_APP_EDIT.md)): `gia-pha:backup -- restore --dir <bản sao lưu trước> --replace --project ... --confirm ... --ack "KHOI PHUC <project>" --pre-backup-dir <bản sao lưu mới của trạng thái hiện tại> --apply`.
- Rules: deploy lại bản trước, luôn giữ mặc định từ chối.
- Pages: đặt lại Variables về dev (hoặc xóa) rồi chạy workflow.

## Rules sửa trong app
Các chức năng sửa trong app cần rules mới trên prod. `firestore.rules` hiện cho phép (chỉ quản trị `manager()`, mỗi lần sửa là một lô nguyên tử kèm `auditLogs/edit-{n}` và cập nhật `treeSnapshots/main`) đủ 12 sự kiện:

| Sự kiện | Ý nghĩa |
| --- | --- |
| `PERSON_EDITED` | sửa hồ sơ (tên, năm, giới tính, chi, cờ, ghi chú) |
| `PERSON_ADDED` | thêm con (người mới + quan hệ cha/mẹ) |
| `SPOUSE_ADDED` | thêm vợ/chồng (union, có thể kèm người mới) |
| `PARENT_CHANGED` | đổi cha/mẹ (quan hệ cũ bị thay) |
| `PARENT_REVERTED` | hoàn tác lần đổi cha/mẹ gần nhất |
| `PARENT_REMOVED` | gỡ một cha/mẹ không truyền dòng |
| `PARENT_REMOVAL_UNDONE` | khôi phục cha/mẹ đã gỡ |
| `RELATION_TYPE_CHANGED` | đổi loại quan hệ (ruột/nuôi) |
| `PERSON_DELETED` | ẩn người (xóa mềm, kèm quan hệ và tối đa 6 liên kết vợ/chồng) |
| `PERSON_RESTORED` | khôi phục người đã ẩn |
| `UNION_REMOVED` | gỡ một liên kết vợ/chồng nhập sai |
| `UNION_REMOVAL_UNDONE` | khôi phục liên kết vợ/chồng đã gỡ |

**Thay đổi chính sách đọc** (so với rules đang chạy trên prod): quản trị `get` được `unions/{id}` theo mã (không liệt kê, thành viên vẫn không đọc được) và `get` `auditLogs/{id}` theo mã chỉ với 12 sự kiện trên (nhật ký tài khoản/lời mời vẫn đóng). Quản trị cũng `get` `relations/{id}` theo mã.

Pages tự phát hành frontend khi merge vào `main`, nên frontend có thể lên TRƯỚC rules; khi đó nút lưu báo "Không có quyền" (từ chối an toàn, không ghi gì) và trang `#/audit` báo không đọc được cho tới khi rules được deploy. Deploy rules prod cần người dùng duyệt rõ ràng.

### Thứ tự phát hành Giai đoạn 3 (người dùng đã duyệt)
1. **Sao lưu mã hóa đã kiểm chứng ngay trước khi deploy rules** (cần `GIA_PHA_BACKUP_PASSPHRASE` và `GOOGLE_APPLICATION_CREDENTIALS` prod do người dùng đặt; `backup` rồi `verify`/`gate-check`, xem BACKUP.md).
2. **`npm run gia-pha:reconcile`** (chỉ đọc) trước khi deploy: ghi lại kết quả cơ sở.
3. **Deploy rules prod** (cần người dùng duyệt rõ): `npx firebase deploy --only firestore:rules --project prod` (index không đổi cũng có thể dùng `--only firestore`).
4. **Reconcile lại** (chỉ đọc), so với bước 2.
5. **Sửa thử MỘT người** theo [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md) Phần B (có ghi giá trị cũ để sửa lại).
6. **Chốt mốc chuyển nguồn:** từ đây chỉ sửa trong app; file nguồn không còn là nguồn sự thật; code chặn `--replace` trên prod khi `editVersion > 0` (INTEGRITY_GUARD.md). Nên sao lưu mới ở mốc này.
7. **Thu hồi tài khoản thử và khóa:** `npm run gia-pha:accounts -- revoke --email thu-nghiem@gia-pha.test --disable-auth --project gia-pha-nguyen-duc-prod --confirm gia-pha-nguyen-duc-prod --ack "QUAN LY TAI KHOAN gia-pha-nguyen-duc-prod" --apply`; sau nghiệm thu xóa khóa service account prod (và bỏ `GOOGLE_APPLICATION_CREDENTIALS`).

### Rủi ro chưa kiểm chứng: giới hạn truy cập tài liệu của rules
Firestore Rules giới hạn 10 lần truy cập tài liệu cho mỗi yêu cầu ghi đơn lẻ và 20 cho cả lô. Rules và test emulator đã được thiết kế theo giới hạn này (ví dụ ẩn người dùng tối đa 6 liên kết vợ/chồng để giữ ở mức 9), nhưng **chưa thử trên Firestore thật**; emulator có thể không phản ánh đúng cách tính. Bước (5) vì vậy là **phép thử thật đầu tiên**.
- **Cách phát hiện:** lưu/ẩn báo "Không có quyền" (`permission-denied`) dù tài khoản là quản trị và bước (4) sạch, nhất là khi ẩn/khôi phục người có nhiều vợ/chồng hoặc lô lớn (nhiều quan hệ).
- **Cách xử lý:** không ghi dở (mỗi lô là nguyên tử nên bị từ chối thì không ghi gì); không thử đi thử lại. Dừng, ghi lại thao tác và giờ, báo Claude. Nếu cần: rollback rules về bản trước (deploy lại rules cũ, giữ mặc định từ chối), kiểm tra bằng reconcile, và sửa rules/giới hạn bằng PR riêng. Nếu đã có sửa trong app thì khôi phục từ sao lưu sẽ mất các sửa sau thời điểm sao lưu (xem phần Rollback).

### Smoke test bản build
Sau MỖI thay đổi `manualChunks` trong `vite.config.ts` phải chạy `npm run build && npx vite preview` và xác nhận trang tải được (browser check dùng Vite dev nên không bắt lỗi phụ thuộc vòng giữa chunk; xem DEPLOYMENT.md).

## Chưa có
App Check, cảnh báo ngân sách khi nâng Blaze, lịch sao lưu tự động, luồng đề xuất/duyệt (cần Blaze).
