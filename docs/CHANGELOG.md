# 0.1.0 — 2026-11-10

- Nền React/TypeScript/Vite, giao diện tiếng Việt responsive, hash router.
- Firebase Auth và listener quyền enabled; tra cứu theo prefix có limit 30.
- Rules mặc định từ chối, không ghi client; media khóa cho đến khi kiểm chứng ACL.
- Emulator seed giả, kiểm thử graph/rules, CI và tài liệu vận hành.
- Không chốt quyết định mở, không deploy và không thay đổi dữ liệu thật.

# Cập nhật chính sách và phân quyền

- Người dùng phê duyệt toàn bộ bảy phương án A; ghi tại APPROVED_DECISIONS.md.
- Tra cứu/seed chuyển sang memberProfiles; khóa canonical và dữ liệu nhạy cảm với mọi client.
- Bổ sung ba rules tests chặn đọc chi tiết (17 trường hợp tổng cộng).
- Agent độc lập review tĩnh đạt cho patch giới hạn. Lint/typecheck đạt; unit tests/build đạt trước chỉnh câu chữ cuối. Emulator vẫn chưa xác minh vì mạng chặn storage.googleapis.com; không deploy production.

# Kiểm chứng emulator và sửa bản nền — 2026-11-10

- Chạy 17 rules tests gốc đạt; thêm 13 regression tự nâng quyền, sửa/xóa canonical,
  subcollection và thu hồi membership. Suite mở rộng đạt 30/30.
- Chặn response tìm kiếm cũ ghi đè response mới; vô hiệu hóa response sau unmount.
- Không mở quyền từ snapshot cache; tra cứu server-only; cho đăng xuất khi chờ quyền.
- Chromium kiểm tra đăng nhập/tra cứu/mobile, thu hồi quyền và thu hồi khi offline.
- Thêm script đối chiếu fixture restore và hướng dẫn export/import emulator.
- Hai agent độc lập phản biện và bổ sung regression. Không đổi bảy chính sách,
  không mở canonical/media, không deploy hoặc thay đổi production.

# Backend lời mời — 2026-11-10

- Functions callable emulator-only và Admin SDK server riêng; fail closed trước
  mọi Admin operation nếu không đúng project demo và loopback hosts.
- Tạo/nhận/thu hồi lời mời, thu hồi membership và audit transaction; chỉ role member.
- Token dùng một lần, UID/email binding, thời hạn dev48h, accessVersion chống lời
  mời cũ sau thu hồi; UUID receipt chống retry gây thay đổi quyền đã cấp lại.
- UI nhận lời mời và quản lý chỉ trong emulator với capability xác nhận từ server.
- Bổ sung 33 backend integration cases, 11 guard tests và browser regression.
  32 integration chạy cùng suite đạt, ca cuối mới thêm chạy riêng đạt.
- Cài/build/test backend trong CI; hướng dẫn fixtures, rollback và giới hạn Auth
  principal có sẵn. Chưa provisioning/gửi thư, production authority hoặc deploy.

# Bước đề xuất/phê duyệt (thay đổi chưa commit)

- Backend/UI hồ sơ cơ bản và thêm quan hệ; revision bất biến, kiểm tra phiên bản,
  phiếu hiện hành và commit canonical/projection/quan hệ/audit nguyên tử.
- Truyền dòng cần hai reviewer khác nhau, không tự duyệt; graph lock chặn cycle,
  trùng/xung đột và nhiều đường truyền dòng chưa xử lý.
- Sửa queue starvation và accessibility; 30 integration đề xuất, 34 integration
  membership, unit tests và Chromium đạt. Xem PROPOSALS_VERIFICATION.md.
- Chưa commit, thay đổi remote hoặc deploy production.

# Sửa trực tiếp trong app — lõi (PR A, 2026-11-11)

- `applyEdit` (hàm thuần) và `commitEdit` (giao dịch Firestore) cho thao tác sửa người.
- Rules: admin (`manager()`) ghi persons/memberProfiles/personPrivate/snapshot chỉ khi cùng lô có
  nhật ký `auditLogs/edit-{n}` và `editVersion` + 1; nhật ký chỉ thêm. Xem IN_APP_EDIT.md.
- Chưa giao diện, chưa thao tác quan hệ, chưa deploy rules lên prod.

# Sửa hồ sơ trong app — giao diện (PR B, 2026-11-11)

- Nút "Sửa hồ sơ" và biểu mẫu trên trang hồ sơ, chỉ quản trị viên; xem IN_APP_EDIT_UI.md.
- `parseSnapshot` đọc `editVersion`; thêm `editForm.ts`, `PersonEdit.tsx`, kiểm tra trình duyệt.
