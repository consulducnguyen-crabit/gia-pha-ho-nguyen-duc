# Đề xuất và phê duyệt — emulator

Chỉ dùng demo-gia-pha, Auth/Functions/Firestore emulator loopback và dữ liệu giả.
Không deploy production, không chọn người quản trị thật hoặc thay đổi bảy chính sách.

## Phạm vi

- PERSON_BASIC: tạo hồ sơ hoặc đổi displayName theo baseVersion. Backend xây
  memberProfiles bằng bốn trường allowlist; không sao chép private fields.
- RELATION_CREATE: thêm quan hệ mới, vai trò FATHER/MOTHER và loại
  BIOLOGICAL/ADOPTIVE do người đề xuất chỉ định. Không suy từ họ hoặc giới tính.
- Truyền dòng theo nam: chỉ vai trò cha mới truyền dòng; con nuôi cũng tính đời. Lý do tùy chọn. Từ 2026-11-11 mọi đề xuất, kể cả truyền dòng,
  chỉ cần một người duyệt (khác người đề xuất). Không tự duyệt.
- Chưa sửa/xóa/gộp quan hệ, tính đời/chi, nhập Excel hoặc duyệt dữ liệu nhạy cảm.

## Invariants

DRAFT → SUBMITTED → NEEDS_INFO / REJECTED / APPROVED. NEEDS_INFO xóa phiếu và
bắt buộc tác giả sửa, tăng revision trước khi gửi lại. REJECTED là trạng thái cuối.
Mỗi revision được lưu bất biến tại proposalRevisions; khi áp dụng backend kiểm tra
snapshot này còn khớp. Audit chỉ ghi ID/trạng thái/version, không tên hay căn cứ.

Backend kiểm tra membership và Auth hiện tại; quyền duyệt là capability explicit
canReviewChanges, chỉ trong fixtures. Trường canReviewLineage cũ không còn được dùng.
Phiếu gắn revision, accessVersion và updateTime tài khoản. Quyền duyệt được kiểm
tra lại ngay trước commit cuối; quyền bị thu hồi thì không duyệt được.

Áp dụng canonical, projection/quan hệ, trạng thái và audit trong cùng transaction.
Kiểm tra baseVersion, ảnh trước và phiên bản hồ sơ liên quan; retry APPROVED không
áp dụng lần hai. Không trả canonical private extras trong before/after.

Graph lock graphState/parentage tuần tự hóa các lần thêm quan hệ. Kiểm tra toàn
đồ thị tối đa 200 quan hệ: vòng lặp, duplicate parent-child, xung đột cùng vai trò
và loại quan hệ, nhiều đường truyền dòng vào một người, endpoint thiếu hoặc graph
cũ sai cấu trúc đều bị chặn. Không âm thầm ghi đè xung đột. Chưa tái kiểm chứng
nội dung mọi nguồn lịch sử; quan hệ mới tham chiếu revision đề xuất bất biến.

## Chạy thử

Node24/Java21; cài npm ci và npm ci --prefix functions, rồi npm run emulators.
Terminal khác:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:proposals
VITE_USE_EMULATORS=true npm run dev -- --host 127.0.0.1
```

Tài khoản giả: nguoidexuat@example.test, duyetmot@example.test,
duyethai@example.test (người duyệt thứ hai, dùng khi cần thử nhiều người duyệt); cùng mật khẩu Demo-only-2026!. Seed có hai hồ sơ
demo-parent/demo-child với projection cơ bản, không quan hệ được suy ra tự động.
Mở các phiên riêng để thử Đề xuất thay đổi và Hộp duyệt.

## Kiểm thử

```sh
npm run test:proposals:unit
npm run test:proposals
```

Khi emulator/Vite đang chạy, seed fixture trên graph mới trước khi chạy:

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/proposal-browser-check.mjs
```

Không chạy rules fixtures song song graph tests: bộ rules có cố ý tạo quan hệ
sai cấu trúc để thử deny. Suite proposals chỉ dọn fixture graph giả của emulator;
không được trỏ tới hệ thống thật. Index mới chỉ là file cấu hình, chưa deploy.

## Giới hạn vận hành và rollback

Danh sách có giới hạn 30; dùng mã đề xuất để tải hồ sơ cụ thể. Chưa có phân trang
production. Auth và Firestore không có transaction xuyên hệ thống. Emulator không
chứng minh xác thực JWT/App Check, rate limiting hoặc năng lực production.

Không migrate dữ liệu thật. Giữ schema1, thêm collections/fields tương thích của
bản thử nghiệm; requests cũ thiếu cấu trúc sẽ bị từ chối thay vì tự nâng schema.
Rollback bằng dừng emulator và dùng mã đã bàn giao trước; không reset/xóa thay đổi
đang làm. Nếu cần giữ fixture, export và kiểm tra backup theo OPERATIONS.md trước.
