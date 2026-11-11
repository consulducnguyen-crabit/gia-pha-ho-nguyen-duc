# Đưa ứng dụng lên Firebase dev (dữ liệu giả)

Mục tiêu: thử đầy đủ rules, đăng nhập Google, trang cây và quản lý tài khoản trên project `gia-pha-nguyen-duc-dev` với **dữ liệu demo giả**. Dữ liệu gia phả thật chỉ vào `prod` sau khi có sao lưu đã kiểm chứng và được duyệt riêng (script nạp hiện từ chối production).

Mỗi bước ghi lên Firebase/GitHub cần xác nhận trước. Thứ tự:

## 0. Chuẩn bị trên máy quản trị
1. Cài Node 24 và Java 21 (đã có). Chạy `npm ci`.
2. Đăng nhập Firebase CLI: `npx firebase login` (mở trình duyệt, chọn đúng tài khoản Google chủ project).
3. Tạo **khóa service account** của project dev: Firebase Console → Project settings → Service accounts → Generate new private key. Lưu **ngoài repo** (ví dụ `C:\Users\<tên>\secrets\gia-pha-dev.json`). Không gửi nội dung file cho ai, không commit. Trong terminal đặt:
   `$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\<tên>\secrets\gia-pha-dev.json"`

## 1. Deploy rules và index lên dev (cần xác nhận)
`npx firebase deploy --only firestore --project dev`
- Triển khai `firestore.rules` và `firestore.indexes.json` (chỉ Firestore). Không deploy Functions/Storage (Spark không hỗ trợ).
- Kiểm tra: Console → Firestore → Rules: thấy `treeSnapshots` và `manager()`.

## 2. Nạp dữ liệu demo vào dev (cần xác nhận)
Chạy thử trước:
`npm run gia-pha:import -- --input scripts/gia-pha/demo/gia-pha-demo.txt --project gia-pha-nguyen-duc-dev`
Ghi thật:
`npm run gia-pha:import -- --input scripts/gia-pha/demo/gia-pha-demo.txt --project gia-pha-nguyen-duc-dev --confirm gia-pha-nguyen-duc-dev --apply`
Nạp lại bản khác: thêm `--replace` (chỉ dev/emulator).

## 3. Cấp quyền quản trị viên đầu tiên (cần xác nhận)
`npm run gia-pha:accounts -- grant --email <gmail của bạn> --name "Họ tên" --admin --project gia-pha-nguyen-duc-dev --confirm gia-pha-nguyen-duc-dev --apply`
Sau đó `list` để kiểm tra. Thành viên thử khác: `grant` (Gmail) hoặc `create` (mật khẩu).

## 4. Cho trang GitHub Pages kết nối dev (cần xác nhận)
- Settings → Pages → Source phải là **GitHub Actions** (đã đặt ngày 2026-11-11).
- Đặt GitHub Actions **Variables** (cấu hình web công khai, không phải bí mật) từ file `.env.local`:
  `gh variable set --env-file .env.local` (chỉ các khóa `VITE_FIREBASE_*`; bỏ `VITE_USE_EMULATORS`).
- Chạy lại workflow: `gh workflow run pages.yml --ref main`.
- Authorized domains của Firebase Auth phải có `consulducnguyen-crabit.github.io` (đã làm).

## 5. Kiểm tra trên Pages
https://consulducnguyen-crabit.github.io/gia-pha-ho-nguyen-duc/
- Đăng nhập Google bằng email đã cấp quyền → thấy Cây gia phả (47 người demo, 6 đời, có các trường hợp cờ cần kiểm tra), hồ sơ, Quản lý tài khoản.
- Đăng nhập bằng tài khoản Google **chưa** được cấp quyền → "Chờ cấp quyền", không đọc được dữ liệu.
- Thử thu hồi (`revoke`) rồi tải lại: mất quyền ngay.

## Rollback
- Rules: deploy lại bản trước (`git checkout <commit> -- firestore.rules` rồi deploy) — luôn giữ mặc định từ chối.
- Dữ liệu dev: `--replace` hoặc xóa trong Console (chỉ dev).
- Pages: xóa Variables và chạy lại workflow để trang về trạng thái "Sẵn sàng kết nối".

## Chưa làm (cần trước khi dùng dữ liệu thật trên prod)
Sao lưu định kỳ và diễn tập khôi phục; rà soát Excel thật; cơ chế nạp prod có kiểm tra sao lưu; App Check; cảnh báo ngân sách khi nâng Blaze.
