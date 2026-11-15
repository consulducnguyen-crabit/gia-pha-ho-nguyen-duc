# Favicon và cài ứng dụng lên màn hình chính (PWA)

## Có gì

- **Favicon**: chữ 阮 (Nguyễn) thư pháp, kiểu ấn son (nền đỏ, chữ kem): `public/favicon.svg` và PNG 32/48 trong `public/icons/`. Nét chữ lấy từ `src/BrandMark.tsx` (phông Ma Shan Zheng, SIL OFL 1.1, xem `FONT_LICENSES.md`).
- **Cài ứng dụng**: `public/manifest.webmanifest` (chạy độc lập `standalone`, màu nền/giao diện, biểu tượng 192/512 và maskable 512), biểu tượng iOS `public/icons/apple-touch-icon.png`, các thẻ meta trong `index.html`.
- **Service worker tối giản** `public/sw.js`: chỉ để trình duyệt cho phép cài đặt. **Cố ý không cache và không chặn mạng** (không `respondWith`, không `caches`), nên không lưu dữ liệu gia phả hay thông tin đăng nhập trên thiết bị. Chỉ đăng ký ở bản phát hành (không ở dev/emulator): `src/registerServiceWorker.ts`.
- **Nút ở trang đăng nhập** (`src/InstallApp.tsx`, `src/installPrompt.ts`):
  - Chrome/Edge/Android: khi trình duyệt sẵn sàng cài, hiện nút "Cài ứng dụng lên màn hình chính" (mở hộp cài đặt gốc).
  - iPhone/iPad (Safari): hiện hướng dẫn "Thêm vào màn hình chính" (Safari không có hộp cài đặt tự động).
  - Đã chạy như ứng dụng (standalone) thì ẩn.

## Tạo lại biểu tượng

`CHROMIUM_PATH=... node scripts/make-icons.mjs` (chỉ khi đổi thiết kế; PNG sinh ra được commit).

## Lưu ý

- Đường dẫn trong manifest và `index.html` là tương đối (`base: "./"`), đúng với GitHub Pages trong thư mục con.
- GitHub Pages là địa chỉ công khai: ứng dụng cài ra chỉ là phím tắt tới trang đó, không làm dữ liệu riêng tư hơn. Quyền xem vẫn do đăng nhập và Firestore rules quyết định.
- Cần HTTPS (GitHub Pages có sẵn). Muốn đổi tên hiển thị hay màu: sửa `manifest.webmanifest` rồi người dùng có thể phải gỡ và cài lại để thấy thay đổi.
- Kiểm chứng trên thiết bị thật (Android Chrome, iPhone Safari) là việc cần người dùng xác nhận; kiểm thử tự động chỉ xác nhận manifest, biểu tượng, service worker và logic nút.
