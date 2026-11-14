# Codex instructions — genealogy app

Ngôn ngữ sản phẩm: tiếng Việt chuẩn, ngày giờ Việt Nam; UI có cá tính, nền sáng, xanh lá nhạt tinh tế; không dùng giao diện AI mẫu rập khuôn. Giao diện responsive.

## Luật giao diện bắt buộc

Đọc UI_DESIGN_RULES.md trước mọi thay đổi UI. Người dùng duyệt áp dụng dần lên
giao diện hiện có: tái sử dụng màu xanh lá/nền sáng và font hiện hữu; chuẩn hóa
tokens, form, focus và responsive. Không tự thiết kế lại toàn bộ hoặc đổi nghiệp
vụ/API/quyền vì thẩm mỹ. Kiểm tra 360/768/1280 px và chiều rộng thực tế; báo đúng
phần đã kiểm chứng. Quyền commit/push/deploy theo ủy quyền mới bên dưới.

## Ủy quyền cập nhật — 11/11/2026

Người dùng cho phép tự triển khai trong phạm vi đã duyệt; sau mỗi phiên code đã
kiểm thử và phản biện, tự commit và push lên GitHub, không hỏi lại quyền này.
Repository đích: consulducnguyen-crabit/gia-pha-ho-nguyen-duc. Không force-push hoặc
ghi đè lịch sử người khác. Phát hành GitHub Pages frontend chưa kết nối dữ liệu
đã được chọn; không dùng sự cho phép này để tự bật billing hoặc deploy backend
emulator-only thành production. Chỉ hỏi khi thiếu thông tin bắt buộc hoặc có quyết
định vượt chính sách, luôn nêu ít nhất ba phương án và phương án đề xuất.

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
- Người dùng tái xác nhận: nội dung cần làm rõ trong phạm vi tự quyết phải được Codex chủ động lập phương án và giao agent độc lập phản biện; khi phương án đạt thì tự triển khai, tiếp tục review/sửa/kiểm thử đến khi đạt tiêu chí nghiệm thu. Không dừng để xin xác nhận lại cho các bước đã được ủy quyền hoặc các chính sách đã duyệt.
- Với nội dung có thể tự quyết trong phạm vi được giao: lập phương án, giao agent độc lập phản biện, sửa code và chạy kiểm thử phù hợp. Lặp lại review/fix cho đến khi đạt; không coi việc agent đồng ý là thay thế bằng chứng kiểm thử.
- Được phép sử dụng agent độc lập cho phản biện và kiểm tra triển khai.
- Với nội dung không thể tự quyết (chính sách dòng họ, quyền riêng tư, ngân sách, quyền quản trị hoặc thay đổi production chưa được duyệt): đặt câu hỏi kèm tối thiểu ba phương án cụ thể, luôn đánh dấu phương án Codex đề xuất và giải thích ngắn tác động. Không coi im lặng là chấp thuận.
- Trong khi chờ trả lời, tiếp tục các phần độc lập; không tự áp dụng chính sách chưa được chốt vào dữ liệu thật.
- Khi cần thao tác thủ công trên website ngoài khả năng công cụ: nêu rõ website, thao tác, giá trị cần nhập không nhạy cảm và kết quả cần người dùng xác nhận. Không yêu cầu gửi secret trong chat.
- Báo trung thực phần đã hoàn thành, kiểm thử đạt, blocker và phần còn chờ quyết định. Không tuyên bố hoàn thiện nếu còn thiếu bằng chứng nghiệm thu.

## Quy tắc bắt buộc: chạy Playwright trên môi trường dev trước khi merge — 2026-11-15

Người dùng yêu cầu (bắt buộc, áp dụng mọi phiên sửa code, giữ nguyên luồng nhánh riêng → PR → CI → hỏi merge):
- Sau khi sửa code và **trước khi merge PR vào `main`**, tự chạy Playwright trên môi trường dev (Vite dev server + Firebase emulator, chỉ dữ liệu giả) và xem kết quả. Không dùng production hay dữ liệu thật cho bước này.
- Phải chạy các kịch bản trình duyệt phủ khu vực đã sửa (`npm run test:browser:<tên>`), cộng toàn bộ các job trong job `browser` của `.github/workflows/ci.yml`. Thay đổi giao diện: kiểm thêm 360/768/1280 px và xem ảnh chụp.
- Thay đổi chưa có kịch bản phủ thì thêm hoặc cập nhật script Playwright ngay trong PR đó.
- Báo rõ trong PR và khi hỏi merge: job nào đã chạy, kết quả, job nào không chạy được và lý do. Không đề nghị merge khi còn job liên quan đang lỗi mà chưa giải thích. CI xanh không thay thế bước này.
- Thay đổi chỉ gồm tài liệu (không đụng mã chạy) được miễn chạy Playwright, nhưng phải nói rõ là miễn.
- Hiện chưa có môi trường dev triển khai riêng cho frontend (chỉ emulator cục bộ). Khi có project dev được triển khai, kiểm thêm trên đó.

