# Vận hành bản nền 0.1

## Phạm vi
Schema version 1. Chưa có migration dữ liệu hoặc backend ghi; mọi ghi từ trình duyệt bị từ chối. Media bị khóa toàn bộ cho đến khi triển khai và kiểm chứng ACL chi tiết. Vai trò editor/approver chưa có đặc quyền. Không phân phối dữ liệu giả trong frontend bundle.

## Thiết lập dev
Node 24, Java 21. `npm ci`; `npm run emulators` (project demo-gia-pha).
Ở terminal khác: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed`.
Chạy frontend: `VITE_USE_EMULATORS=true npm run dev`. Đăng nhập thanhvien@example.test / Demo-only-2026! (chỉ emulator).
Không dùng emulator từ hostname bên ngoài localhost/127.0.0.1. Không expose cổng emulator.

## Kiểm thử
`npm run lint`, `npm run typecheck`, `npm test`, `npm run test:rules`, `npm run build`.
Rules tests dùng dữ liệu giả với bypass chỉ bên trong emulator. Cài emulator có thể cần tải binary từ Firebase.

## Firebase thật và GitHub Pages
Tạo hai project dev/prod tách biệt sau khi chốt region và ngân sách. Sao chép `.env.example` thành `.env.local`, điền web config; không dùng Admin SDK trong Vite. Bật Email/Password Auth và authorized domain. Tài khoản chỉ do backend đáng tin cậy cấp, chưa có công cụ provision production.
GitHub Pages chỉ phục vụ `dist/`, router dùng hash và Vite base tương đối cho đường dẫn repository. Chưa cấu hình remote, Pages hoặc deploy rules. Trước production phải kiểm chứng phân quyền riêng tư (đã tách memberProfiles khỏi canonical), các quyết định hạ tầng còn mở, hoàn thiện approval backend, chạy bộ kiểm thử và bảo vệ GitHub environment production với reviewer. Không triển khai frontend như sản phẩm hoàn chỉnh.

## Sao lưu và khôi phục
Chưa có dữ liệu thật. Emulator có thể export bằng `npx firebase emulators:export /tmp/gia-pha-backup --project demo-gia-pha`; import bằng `npm run emulators -- --import /tmp/gia-pha-backup`. Không commit export.
Trước migration thật: người phụ trách được chỉ định tạo Firestore export và bản sao Storage vào kho riêng có ACL, ghi checksum/phiên bản schema và thời điểm; dry-run trên project cô lập; đối chiếu số lượng, quan hệ, quyền và tài liệu mẫu sau restore. Chưa tuyên bố khả năng restore production khi chưa diễn tập. Thay đổi production cần phê duyệt rõ ràng.

## Rollback
Bản nền không migrate dữ liệu. Rollback frontend bằng build commit trước; rollback rules chỉ về bản đã review và vẫn default-deny, sau khi chạy emulator tests. Không dùng rules mở để chữa lỗi truy cập. Mọi migration tương lai phải có manifest, dry-run, backup được xác minh và hướng phục hồi trước khi áp dụng.

## Kết quả xác minh trong môi trường bàn giao
- Lint, TypeScript, 4 unit tests và production build: đạt.
- Chromium hệ thống: màn hình chưa cấu hình, desktop 1440px và mobile 390px, không tràn ngang hoặc lỗi JavaScript: đạt.
- Firebase rules tests: đã viết 17 trường hợp, chưa chạy được do proxy trả HTTP 403 Domain forbidden khi tải Firestore emulator từ storage.googleapis.com. Cần cho phép domain này trong environment settings rồi chạy lại `npm run test:rules`. Không bỏ kiểm thử trong CI.
- Luồng đăng nhập/tra cứu emulator và restore drill: chưa xác minh do cùng blocker. Script `scripts/browser-check.mjs` sẵn cho emulator; `--setup` kiểm tra giao diện không cấu hình. Dùng `CHROMIUM_PATH=/usr/bin/chromium` nếu sử dụng Chromium hệ thống.
- Build có cảnh báo bundle Firebase lớn (~817 kB trước gzip); cần chia bundle/tải lười trước tối ưu production.
