# Codex instructions — genealogy app

Ngôn ngữ sản phẩm: tiếng Việt chuẩn, ngày giờ Việt Nam; UI có cá tính, nền sáng, xanh lá nhạt tinh tế; không dùng giao diện AI mẫu rập khuôn. Giao diện responsive.

Priorities: (1) bảo mật dữ liệu cá nhân, (2) đúng quan hệ phả hệ, (3) khả năng kiểm toán/khôi phục, (4) hiệu năng, (5) giao diện.

Never:
- expose genealogical data in repository, public assets, generated static JSON, logs or analytics;
- place Admin SDK credentials or private keys in browser or repository;
- trust client-side roles or approvals;
- allow a normal member to write canonical person/relationship records;
- deploy rules permitting unauthenticated read or wildcard write;
- infer paternal lineage solely from surname or gender;
- silently override a parentage conflict;
- change production data or security rules without explicit approval.

Before implementation: identify unresolved decisions in `docs/OPEN_DECISIONS.md`. Work in PR-sized changes with emulator tests. Use fake seed data only. Never treat a GitHub Pages URL as private: it hosts public frontend assets.

Use GitHub Actions least privilege and environment protection. Maintain schema version, migrations, backup/restore documentation. For destructive data operations require dry run and verified backup.

## Quy trình do người dùng phê duyệt — 2026-11-10

Các hướng dẫn này ưu tiên hơn giới hạn tự quyết trong tài liệu bàn giao cũ.
- Với nội dung có thể tự quyết trong phạm vi được giao: lập phương án, giao agent độc lập phản biện, sửa code và chạy kiểm thử phù hợp. Lặp lại review/fix cho đến khi đạt; không coi việc agent đồng ý là thay thế bằng chứng kiểm thử.
- Được phép sử dụng agent độc lập cho phản biện và kiểm tra triển khai.
- Với nội dung không thể tự quyết (chính sách dòng họ, quyền riêng tư, ngân sách, quyền quản trị hoặc thay đổi production chưa được duyệt): đặt câu hỏi kèm tối thiểu ba phương án cụ thể, luôn đánh dấu phương án Codex đề xuất và giải thích ngắn tác động. Không coi im lặng là chấp thuận.
- Trong khi chờ trả lời, tiếp tục các phần độc lập; không tự áp dụng chính sách chưa được chốt vào dữ liệu thật.
- Khi cần thao tác thủ công trên website ngoài khả năng công cụ: nêu rõ website, thao tác, giá trị cần nhập không nhạy cảm và kết quả cần người dùng xác nhận. Không yêu cầu gửi secret trong chat.
- Báo trung thực phần đã hoàn thành, kiểm thử đạt, blocker và phần còn chờ quyết định. Không tuyên bố hoàn thiện nếu còn thiếu bằng chứng nghiệm thu.
