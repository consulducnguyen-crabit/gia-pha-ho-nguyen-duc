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

# Thêm con và vợ/chồng trong app (PR C1, 2026-11-11)

- `applyAdd`, `commitAdd`, biểu mẫu Thêm con / Thêm vợ/chồng; rules cho PERSON_ADDED và SPOUSE_ADDED.
  Chỉ thêm, không ghi đè quan hệ cũ. Xem IN_APP_EDIT_ADD.md. Chưa deploy rules lên prod.

# Đổi cha/mẹ và loại con (PR C2a, 2026-11-11)

- `applyRelation`, `commitRelation`, mục quản trị quan hệ cha mẹ; rules cho PARENT_CHANGED và
  RELATION_TYPE_CHANGED. Quan hệ bị thay được ẩn (xóa mềm), không xóa cứng. Xem IN_APP_EDIT_RELATIONS.md.

# Gỡ liên kết vợ/chồng nhập sai (PR-6, 2026-11-12)

- `applyUnion`, `commitUnion`, mục "Quan hệ vợ/chồng (quản trị)", khôi phục qua "Thêm vợ/chồng"; rules cho `UNION_REMOVED` và `UNION_REMOVAL_UNDONE`; admin `get` unions theo mã (không liệt kê).
- Vá rules: `PERSON_RESTORED` không hồi sinh liên kết đã gỡ (`removedAtVersion != null`).
- Đối soát thêm `UNION_REMOVED_BAD_STATE`; `EDIT_EVENTS` thêm hai sự kiện. Xem IN_APP_EDIT_UNIONS.md. Chưa deploy rules lên prod.

# Trang nhật ký chỉnh sửa (PR-7, 2026-11-12)

- Route `#/audit` chỉ cho quản trị viên: đọc `auditLogs/edit-{n}` theo mã, phân trang 20 bản, lọc trong bản đã tải, nhãn tiếng Việt cho 12 sự kiện, bảo vệ dữ liệu không tin cậy và quyền riêng tư (chỉ hiện năm, ghi chú chỉ độ dài). Không đổi rules.
- `formatVnTime` dùng chung (dd/mm/yyyy HH:mm, giờ VN), `Users.tsx` dùng lại. Thêm test rules đọc nhật ký và kiểm tra trình duyệt (`test:browser:audit`). Xem AUDIT_LOG_UI.md.

# PR-9 — Hiển thị thông tin chi — 2026-11-12

- Hồ sơ người: thêm dòng "Chi này có nguồn gốc hợp nhất từ: …" (`mergedFrom`) dưới nhãn chi, cho mọi thành viên.
- Cây gia phả: khi chọn chi ở bộ lọc hiện khối thông tin chi (tên chi, thủy tổ chi có liên kết nếu có trong cây, nguồn gốc hợp nhất). Quản trị viên (`canManageMembership`) còn thấy "Ghi chú quản trị (chi)".
- Chuỗi dài hơn 500 ký tự được cắt kèm nút "Xem đầy đủ"; mọi chuỗi render bằng text, không `dangerouslySetInnerHTML`, không `href` từ dữ liệu (liên kết thủy tổ chỉ khi mã khớp `^[A-Za-z0-9_-]{1,100}$` và có trong ảnh chụp).
- Chỉ đọc/hiển thị: không đổi rules, schema, API. Mã mới: `src/branchInfo.ts`, `src/BranchInfoView.tsx`; test `tests/branchInfo.test.ts`, `scripts/branch-info-browser-check.mjs` (`npm run test:browser:branch`, đã thêm vào CI).

# PR-8 — Cảnh báo chi lệch người khai chi — 2026-11-12

- Đối soát thêm cảnh báo chỉ-đọc `BRANCH_FOUNDER_MISMATCH` (`reconcileWarnings`), in phần "CẢNH BÁO" riêng, không đổi mã thoát. Chỉ mã + mã người, không tên.
- Không đổi chi hàng loạt trong app; không đổi rules/src/schema/snapshot. Ghi quyết định Q1–Q4 vào OPEN_DECISIONS.md.

# PR-3 — Dọn kỹ thuật — 2026-11-12

- Gom `SNAPSHOT_MAX_BYTES` (850000) và `exceedsSnapshotLimit()` vào `src/editCore.ts` (bỏ 4 bản trùng và 5 chỗ kiểm lặp; thông báo/mã lỗi giữ nguyên). Ghi chú đồng bộ với giới hạn `< 900000` trong firestore.rules (không đổi rules). Thêm test ngưỡng và ký tự nhiều byte.
- Tách vendor trong `vite.config.ts` (`manualChunks`): `react` 260.05 kB, `firebase` 559.06 kB, chunk ứng dụng 136.36 kB (trước đó một chunk 958.72 kB). Thử tách riêng `@firebase/firestore` nhưng bản build bị lỗi chạy "Cannot access ... before initialization" (phụ thuộc vòng giữa hai chunk; phát hiện khi mở bản build bằng `vite preview`, browser check dùng Vite dev nên không bắt được) nên bỏ. `chunkSizeWarningLimit` đặt 600 có chủ đích vì SDK Firebase không tách an toàn. Thử lazy-load Proposals/Membership nhưng bỏ vì trang quá nhỏ, không giảm chunk chính.
- `pages.yml` chỉ phát hành sau khi workflow "CI" thành công trên push main (chi tiết: DEPLOYMENT.md).

# Nghiệm thu Giai đoạn 2 và chuẩn bị phát hành prod - 2026-11-13

- Chỉ tài liệu, không đổi code/rules/dữ liệu. Thêm ACCEPTANCE_CHECKLIST.md (phần A thử ngay trên Pages; phần B chỉ sau sao lưu và deploy rules prod; cách báo lỗi).
- PROD_ROLLOUT.md: liệt kê đủ 12 sự kiện sửa trong app, thay đổi chính sách đọc (admin `get` unions/auditLogs theo mã), thứ tự phát hành Giai đoạn 3 (7 bước), rủi ro giới hạn truy cập tài liệu của rules chưa thử trên Firestore thật, nhắc smoke test bản build.
- OPEN_DECISIONS.md: bảng tổng hợp 10 quyết định đang chờ (3 phương án và đề xuất mỗi câu, chưa chốt).
