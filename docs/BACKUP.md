# Sao lưu và khôi phục (gói Spark, chạy cục bộ)

Spark không có export Firestore tự động, nên sao lưu do quản trị viên chạy trên máy: `npm run gia-pha:backup -- <lệnh>`. Bản sao lưu chứa **dữ liệu thật**: không để trong thư mục được commit, không đưa lên CI/GitHub.

## Lệnh
| Lệnh | Việc làm | Đích |
|---|---|---|
| `backup [--out <thư mục>]` | Xuất mọi collection gốc (JSONL, khóa sắp xếp, Timestamp giữ nguyên) và danh sách Auth (không mật khẩu) kèm `manifest.json` (số lượng, sha256) | emulator, dev, **cả prod** (chỉ đọc) |
| `verify --dir <bản sao lưu>` | Kiểm tra checksum và số tài liệu, không kết nối | ngoại tuyến |
| `compare --dir <bản sao lưu>` | So Firestore hiện tại với bản sao lưu (chỉ in số thiếu/thừa/khác, không in nội dung) | emulator, dev, prod (chỉ đọc) |
| `restore --dir <bản sao lưu> [--replace] --apply` | Ghi lại tài liệu, cùng mã | emulator, dev, và prod qua cổng an toàn |

- Đích thật cần `GOOGLE_APPLICATION_CREDENTIALS` (khóa service account để ngoài repo), `--project <id>` và `--confirm <id>`. Emulator: đặt `FIRESTORE_EMULATOR_HOST` (và `FIREBASE_AUTH_EMULATOR_HOST` để kèm Auth).
- `restore` mặc định dry-run; từ chối nếu collection đích đã có dữ liệu trừ khi `--replace`; từ chối bản sao lưu sai checksum. Khôi phục vào **prod** cần cổng an toàn: `--confirm`, `--ack "KHOI PHUC gia-pha-nguyen-duc-prod"` và, nếu có `--replace`, `--pre-backup-dir` là bản sao lưu mới của trạng thái hiện tại (≤ 30 phút, đã kiểm chứng, khớp Firestore hiện tại) để còn đường lui.
- Nơi lưu: `backups/` hoặc `private-data/` trong repo (bị `.gitignore` chặn) hoặc thư mục ngoài repo (ổ ngoài, đám mây riêng tư). Thư mục khác trong repo bị từ chối.
- **Mã hóa tùy chọn:** đặt `GIA_PHA_BACKUP_PASSPHRASE` (≥ 12 ký tự) khi sao lưu; AES-256-GCM, khóa từ scrypt. Cần cùng cụm mật khẩu để verify/compare/restore. Mất cụm mật khẩu = mất bản sao lưu: ghi lại ở nơi an toàn khác nơi lưu sao lưu.
- Không có Storage (chưa dùng). Tài khoản Auth không có mật khẩu trong sao lưu: sau khôi phục, tạo lại bằng `gia-pha:accounts` (`grant`/`create`/`reset-password`).
- Giới hạn: chỉ collection gốc (hiện chưa có subcollection). Nếu thêm subcollection, phải mở rộng công cụ trước khi tin vào sao lưu.

## Diễn tập khôi phục (đã chạy trên emulator với dữ liệu demo)
1. Nạp demo, `backup` (có mã hóa) → `verify` đạt → `compare` KHỚP.
2. Phát hiện sai: sai cụm mật khẩu và sửa 1 byte đều bị từ chối.
3. Xóa sạch Firestore → `compare` KHÔNG KHỚP (213 khác biệt) → `restore --apply` → `compare` KHỚP.
Lặp lại diễn tập trên project `-dev` (dữ liệu demo) sau khi có khóa service account, và **trước mỗi lần nạp dữ liệu thật** lên prod.

## Lịch và lưu trữ khuyến nghị
- Sao lưu **trước** mỗi lần nạp/sửa hàng loạt, và định kỳ hằng tuần khi đã có dữ liệu thật. Có thể dùng Windows Task Scheduler gọi `npm run gia-pha:backup -- backup ...` (đặt biến môi trường trong tác vụ, không ghi cụm mật khẩu vào file trong repo).
- Giữ ít nhất 3 bản gần nhất ở **hai nơi** (máy quản trị và ổ ngoài/đám mây riêng tư). Chỉ người được giao trách nhiệm (quản trị viên) giữ cụm mật khẩu.
- Mỗi quý chạy lại `verify` và một lần diễn tập khôi phục.

## Lệnh `gate-check`
`gia-pha:backup -- gate-check --dir <bản sao lưu> [--project ... --confirm ...]` (chỉ đọc, dùng được cho mọi đích) báo bản sao lưu đã **sẵn sàng cho cổng nạp prod** chưa: đúng project, còn mới (≤ 30 phút), qua kiểm tra và **khớp Firestore hiện tại**. Chạy ngay trước khi nạp.

