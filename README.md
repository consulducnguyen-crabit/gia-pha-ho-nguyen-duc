# Gia phả dòng họ — Codex handoff

Ứng dụng web gia phả riêng tư dành cho một dòng họ nội. Đã có bản nền React/Firebase cục bộ; chưa phát hành production.

## Kiến trúc đã thống nhất
- Frontend: TypeScript, React/Vite (đề xuất), deploy GitHub Pages.
- Identity: Firebase Authentication.
- Database: Cloud Firestore.
- Media: Firebase Cloud Storage (lưu ý dự án Blaze/billing).
- Server-side trusted workflows: Cloud Functions hoặc backend tin cậy tương đương **nếu cần** cho duyệt giao dịch phức tạp, import và tái tính dữ liệu.
- CI/CD: GitHub Actions; không lưu secret trong repo.
- Không dùng Apps Script làm backend chính.

## Quy tắc làm việc
1. Đọc `docs/PROJECT_SPEC.md`, `docs/BUSINESS_RULES.md`, `docs/SECURITY_RULES.md` trước khi viết code.
2. Không tự quyết các mục `OPEN_DECISIONS.md`.
3. Bắt đầu bằng skeleton, emulator, security rules và test trước khi dùng dữ liệu thật.
4. Mọi thay đổi qua branch/PR; production deploy sau khi duyệt.
5. Không đưa dữ liệu gia phả thật, ảnh riêng tư, service account hoặc credentials vào GitHub Pages.
6. Ưu tiên triển khai nhỏ, có kiểm thử và khả năng khôi phục.

## Tài liệu
- `docs/PROJECT_SPEC.md`: phạm vi và màn hình
- `docs/BUSINESS_RULES.md`: quy tắc phả hệ
- `docs/DATABASE_SCHEMA.md`: Firestore collections và index
- `docs/SECURITY_RULES.md`: mô hình quyền
- `docs/IMPLEMENTATION_PLAN.md`: roadmap
- `docs/OPEN_DECISIONS.md`: các quyết định chưa được phê duyệt
- `AGENTS.md`: hướng dẫn cho Codex

## Trạng thái
Đã tạo hai Firebase project tách biệt (`gia-pha-nguyen-duc-dev`, `gia-pha-nguyen-duc-prod`, gói Spark, Firestore asia-southeast1) và kết nối repo GitHub. Chưa deploy rules/backend, chưa đưa dữ liệu thật vào hệ thống. Các chính sách mới nhất xem cuối `docs/APPROVED_DECISIONS.md`.

## Bản triển khai nền 0.1

Mã nguồn đã được dựng trên branch `feat/secure-foundation`. Đã có đăng nhập, kiểm tra quyền và tra cứu hồ sơ; chưa phải toàn bộ P0. Xem [hướng dẫn chạy, kiểm thử và vận hành](docs/OPERATIONS.md) và [changelog](docs/CHANGELOG.md).

Chạy nhanh: `npm ci`, `npm run emulators`; seed theo hướng dẫn rồi `VITE_USE_EMULATORS=true npm run dev`.

Chưa phát hành production. Bảy chính sách đã chốt tại docs/APPROVED_DECISIONS.md; OPEN_DECISIONS chỉ còn các mục hạ tầng và vận hành.

## Backend lời mời thử nghiệm

Đã có callable backend và UI tạo/nhận/thu hồi lời mời, cấp/thu hồi membership trên
emulator. Cài thêm `npm ci --prefix functions` trước `npm run emulators`.
Xem [hướng dẫn lời mời](docs/INVITATIONS.md). Chỉ dùng Auth principal giả có sẵn;
chưa gửi thư, chưa provisioning hoặc quản trị production.

## Đề xuất và phê duyệt thử nghiệm

Đã thêm backend/UI đề xuất hồ sơ cơ bản và thêm quan hệ, với kiểm tra phiên bản,
phiếu duyệt và giao dịch nguyên tử. Xem [PROPOSALS.md](docs/PROPOSALS.md).
Chỉ chạy emulator; chưa hoàn tất toàn bộ P0 hoặc deploy production.
