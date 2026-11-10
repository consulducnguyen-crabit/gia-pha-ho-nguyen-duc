# Vận hành bản nền 0.1

## Phạm vi
Schema version 1. Chưa có migration dữ liệu thật. Backend lời mời chỉ ghi membership,
invitations và audit trong emulator; mọi ghi trực tiếp từ trình duyệt bị từ chối.
Media bị khóa toàn bộ cho đến khi triển khai và kiểm chứng ACL chi tiết. Vai trò
editor/approver chưa có đặc quyền. Không phân phối dữ liệu giả trong frontend bundle.

## Thiết lập dev
Node 24, Java 21. `npm ci`; `npm ci --prefix functions`; `npm run emulators` (project demo-gia-pha).
Ở terminal khác: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed`.
Chạy frontend: `VITE_USE_EMULATORS=true npm run dev`. Đăng nhập thanhvien@example.test / Demo-only-2026! (chỉ emulator).
Không dùng emulator từ hostname bên ngoài localhost/127.0.0.1. Không expose cổng emulator.

Luồng lời mời/cấp quyền có hướng dẫn riêng tại [INVITATIONS.md](INVITATIONS.md).
Functions emulator trên 127.0.0.1:5001; backend fail closed ngoài emulator.
Kết quả mới nhất tại [INVITATIONS_VERIFICATION.md](INVITATIONS_VERIFICATION.md).

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

## Kết quả xác minh

Xem [báo cáo kiểm chứng](VERIFICATION.md) cho kết quả chạy emulator, 30 rules tests,
6 unit tests, Chromium và diễn tập restore. Blocker tải emulator trong bản bàn giao
cũ đã được giải quyết ở môi trường hiện tại; không bỏ rules tests trong CI.

Tra cứu chỉ lấy dữ liệu từ server. Quyền chỉ mở sau snapshot membership từ server;
khi SDK phát hiện mất kết nối, giao diện đóng dữ liệu và chờ xác nhận lại. Người
dùng đã xem dữ liệu vẫn có thể giữ bản sao; đây không phải cơ chế xóa dữ liệu từ xa.

Với emulator và Vite đang chạy, seed trước rồi chạy
`CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. Script kiểm tra thu hồi quyền,
kể cả thu hồi lúc browser offline; chỉ gọi privileged REST ở localhost/demo.
`--setup` dùng cho Vite không bật emulator và chưa cấu hình Firebase.

Build vẫn có cảnh báo bundle Firebase lớn (~817 kB trước gzip); cần chia bundle/tải
lười trước tối ưu production. Backend phê duyệt và ACL media chưa triển khai.

## Lặp lại diễn tập restore (chỉ dữ liệu giả)

Khởi động emulator, chạy `npx vitest run tests/rules.test.ts` để tạo fixtures (gồm
media và names), rồi seed theo hướng dẫn trên. Khi emulator còn chạy:

```sh
node scripts/restore-check.mjs --record /tmp/gia-pha-before-restore.json
npx firebase emulators:export /tmp/gia-pha-backup --project demo-gia-pha
```

Sau khi export thành công, dừng emulator bằng Ctrl+C; khởi động tiến trình mới:

```sh
npx firebase emulators:exec --project demo-gia-pha --only auth,firestore,storage --import /tmp/gia-pha-backup 'node scripts/restore-check.mjs --verify /tmp/gia-pha-before-restore.json'
```

Dùng thư mục export mới mỗi lần, không ghi đè backup chưa kiểm tra. Script so sánh
số lượng và SHA-256 nội dung của 10 collections fixture cùng subcollection names,
kiểm tra sáu hồ sơ giả, UID/đăng nhập Auth và SHA-256 media. Đây là diễn tập fixture
emulator, không chứng minh restore production hoặc kiểm kê toàn bộ schema.
