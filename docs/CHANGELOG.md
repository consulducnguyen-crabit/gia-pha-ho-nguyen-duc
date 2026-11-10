# 0.1.0 — 2026-11-10

- Nền React/TypeScript/Vite, giao diện tiếng Việt responsive, hash router.
- Firebase Auth và listener quyền enabled; tra cứu theo prefix có limit 30.
- Rules mặc định từ chối, không ghi client; media khóa cho đến khi duyệt chính sách.
- Emulator seed giả, kiểm thử graph/rules, CI và tài liệu vận hành.
- Không chốt quyết định mở, không deploy và không thay đổi dữ liệu thật.

# Cập nhật chính sách và phân quyền

- Người dùng phê duyệt toàn bộ bảy phương án A; ghi tại APPROVED_DECISIONS.md.
- Tra cứu/seed chuyển sang memberProfiles; khóa canonical và dữ liệu nhạy cảm với mọi client.
- Bổ sung ba rules tests chặn đọc chi tiết (17 trường hợp tổng cộng).
- Agent độc lập review tĩnh đạt cho patch giới hạn. Lint/typecheck đạt; unit tests/build đạt trước chỉnh câu chữ cuối. Emulator vẫn chưa xác minh vì mạng chặn storage.googleapis.com; không deploy production.
