# Menu gọn và Cần kiểm tra chỉ cho quản trị viên — 2026-11-15

- Bỏ tab và trang **Tiến độ triển khai** và **Tra cứu thành viên** (`#/roadmap`, `#/persons` nay báo "Không tìm thấy trang"). Ô tìm theo tên vẫn có ở Cây gia phả và Danh sách thành viên; nút ở Tổng quan đổi thành "Xem danh sách thành viên →".
- **Cần kiểm tra** (tab, trang `#/review-queue`, nhãn trong cây/danh sách, khối ở hồ sơ) chỉ hiện với quản trị viên; thành viên thường mở thẳng `#/review-queue` thì về Tổng quan. Đây là ẩn giao diện, KHÔNG phải kiểm soát quyền đọc dữ liệu (rules không đổi).
- Kiểm thử: `scripts/nav-browser-check.mjs` (`npm run test:browser:nav`, đã thêm vào CI).

# Tài khoản điện thoại/email do quản trị viên tạo — 2026-11-14

- PR1: trang đăng nhập hai tab Điện thoại | Email; số điện thoại ngầm thành `0914222987@gp.nguyenduc`; thông báo lỗi thống nhất kèm Zalo đăng ký.
- PR2: khu Tạo tài khoản trong `#/users` (Firebase app phụ, mật khẩu tạm ngẫu nhiên hiện một lần), rules `adminCreateOk`/`passwordChangedOk`, nhật ký `ACCOUNT_CREATED`, màn đổi mật khẩu lần đầu (`mustChangePassword`).
- PR3: **gỡ** lời mời email và đăng nhập bằng liên kết (`invitesClient`, `emailLink`, `EmailLinkLogin`, `InviteAccept`, `UsersInvites`, rules `accountInvites`/`acceptOk`, test và job `test:browser:invites`). Còn lại, chưa dọn: backend lời mời emulator-only (`functions/`, `Membership.tsx`) và xử lý `accountInvites` trong script quản trị `gia-pha:accounts`.

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

# Rules prod đã deploy, sửa thử đạt, bỏ yêu cầu sao lưu - 2026-11-13

- Rules sửa trong app đã deploy lên prod (commit a8c740a); sửa thử một người (c2-thai-son) ĐẠT, nhật ký `edit-1`, `edit-2` hiện đúng ở `#/audit`.
- Người dùng bỏ yêu cầu xây dựng/cấu hình sao lưu khỏi phạm vi dự án: sao lưu không còn là điều kiện trước deploy rules hay sửa thử. Chỉ cập nhật tài liệu; không đổi code/rules/công cụ (cổng `--backup-dir` của import/restore-ghi-đè trên prod giữ nguyên).

# Rà soát giao diện theo chuẩn web — 2026-11-13

- Thêm scripts/ui-standards-audit.mjs (dữ liệu giả, emulator): kiểm lang/title/h1/landmark/heading, nhãn và tên truy cập, vùng bấm, tràn ngang 320/360/768/1280, tab-order và viền focus, 1.4.12, tương phản chữ và token.
- Sửa: skip link, `<main>` cho trang đăng nhập/chờ cấp quyền, title theo route, chuyển focus vào nội dung khi đổi route, nav cao >= 44px, vùng bấm >= 24px cho tên trong cây/danh sách, ô chọn/radio 24px với nhãn cao >= 44px, bỏ h3 trong button, caption bảng tài khoản, icon trang trí aria-hidden, lỗi đăng nhập gắn aria-describedby, trả focus khi đóng panel ẩn/khôi phục người và hồ sơ tra cứu, viền control đủ 3:1 trên nền hero/story, cỡ chữ nhãn nhỏ nhất 11px.
- Không đổi nghiệp vụ, API, quyền, route hay dữ liệu.
- Title đặt theo từng Route (kể cả 404/route bị chặn) và theo trạng thái cổng; `.person-name` giữ diện mạo cũ của thẻ tra cứu; đóng hồ sơ tra cứu focus ô tìm kiếm nếu thẻ đã mất.

# Giao diện: logo, nút cuộn, lối vào Thêm thành viên — 2026-11-13

- Logo chữ Đức (德) kiểu thư pháp (SVG nhúng, xem FONT_LICENSES.md) thay cho ký tự ❧.
- Nút cuộn nổi lên đầu / xuống cuối trên mọi màn hình (kể cả đăng nhập).
- Quản trị viên: nút "Thêm thành viên" ở Tổng quan và Cây gia phả, mở trang `#/add-member` chọn người gốc rồi mở sẵn biểu mẫu Thêm con / Thêm vợ/chồng hiện có (`?add=child|spouse`, tham số bị xóa sau khi mở). Không thêm đường ghi mới; rules và nhật ký không đổi.

# PR-A: rules cấp quyền trong app — 2026-11-13

- `firestore.rules`: sổ quản trị viên `accessControl/admins`, quản trị viên sửa `users` (enabled/quản trị/tên) kèm nhật ký `account-{uid}-{accessVersion}`, lời mời `accountInvites` (chỉ Chỉ xem, hạn <= 7 ngày), nhận lời mời tự tạo `users/{uid}`. Nhánh `edit-N` giữ nguyên.
- Thêm `tests/accountRules.test.ts` (dữ liệu giả) vào `test:rules`; cập nhật đoạn "manager" trong `tests/rules.test.ts`.
- Chỉ rules/test/tài liệu: chưa có UI, chưa có script khởi tạo sổ, chưa deploy, không chạm dữ liệu thật. Sổ phải được khởi tạo trước khi dùng thao tác tài khoản (xem ACCOUNTS.md).
- Sửa theo review độc lập: nhật ký lời mời cùng yêu cầu và gắn 1:1 bằng `inviteKey` (sha256), mã nhật ký thu hồi kèm uid; `approvedBy/At`, `disabledBy/At` bị ràng buộc; sổ chỉ đổi cùng lô với users đổi trạng thái admin; nhận lời mời đòi người phát hành còn trong sổ. Kiểm chứng bằng Auth emulator: đăng nhập liên kết email có provider `password`.

# PR-B: script giữ sổ quản trị viên đồng bộ — 2026-11-13

- `accounts-core.ts`: `ledgerAfter`, `buildRegistry`, `diffRegistry`, `normalizeUser`; `buildRevoke` đặt `canManageMembership: false`; `buildGrant`/`buildRole` luôn ghi bool tường minh.
- `accounts.ts`: ghi users + sổ + nhật ký trong một giao dịch; lệnh `registry` (`--verify` chỉ đọc, mã 1 nếu lệch; `--rebuild` dry-run mặc định, `--apply` mới ghi, nhật ký `ACCOUNT_LEDGER_REBUILT` không email). `--force` không còn cho phép làm số quản trị viên về 0 (từ chối vô điều kiện).
- Kiểm chứng end-to-end trên emulator (Auth + Firestore) và bằng rules; chưa chạy trên project thật. Không có migration dữ liệu thật (`docs/migrations.json` không đổi: chưa có migration nào được duyệt chạy trên prod).
- Sửa theo review: ghi users đổi quyền quản trị bị từ chối khi sổ thiếu/lệch (không tự dựng sổ), kiểm tra giao rỗng sau ghi, nhật ký rebuild chỉ `create`, kiểm tra version sổ/users hỏng, `create` kiểm tra trước khi tạo Auth, cảnh báo grant khôi phục quyền cũ.
- Bằng chứng: `npm run test:accounts:e2e` (`scripts/accounts-e2e-check.mjs`) chạy tự động trên emulator Auth + Firestore, gồm bước dùng sổ do script dựng làm fixture cho rules.
- Review lần hai: mã nhật ký rebuild duy nhất (`ledger-rebuild-{version}-{epochMillis}`); `grant`/`create` kiểm tra sổ trước khi tạo tài khoản Auth hoặc xác minh email; thông báo sổ lệch nêu rõ (uid trùng/sổ hỏng/thiếu/thừa); kiểm giới hạn 400 trong giao dịch rebuild; e2e thêm ca rebuild sau khi xóa sổ và ca từ chối không tác dụng phụ.

# PR-C: giao diện cấp quyền/sửa/vô hiệu hóa tài khoản — 2026-11-13

- `src/accountsClient.ts`: `buildAccountUpdate` (thuần) + `updateAccount` (giao dịch Firestore ghi users, sổ `accessControl/admins`, nhật ký `account-{uid}-{accessVersion}` qua firestore.rules hiện có; giá trị cụ thể, không increment/arrayUnion). `src/Users.tsx`: nút Sửa, panel đổi tên/quyền Quản trị-Chỉ xem, vô hiệu hóa có xác nhận/bật lại, khóa khi sổ thiếu. Chưa có lời mời (PR-D). Không sửa `firestore.rules`.
- Kiểm thử: tests/accountsClient.test.ts, tests/accountsClientRules.test.ts, `npm run test:browser:users` (thêm vào CI).

# PR-D: lời mời thành viên bằng email + đăng nhập bằng liên kết email — 2026-11-13

- `src/invitesClient.ts` (tạo/thu hồi/nhận lời mời, nhật ký 1:1 bằng sha256 khóa email), `src/emailLink.ts` + `src/EmailLinkLogin.tsx` (đăng nhập không mật khẩu bằng liên kết email, hoàn tất cả khi mở trên thiết bị khác), `src/InviteAccept.tsx` (nút "Nhận lời mời" ở màn chờ cấp quyền), `src/UsersInvites.tsx` (khu "Mời thành viên" trong `#/users`). Lời mời chỉ cấp Chỉ xem, hạn 7 ngày (client ghi 6 ngày 22 giờ). Không sửa `firestore.rules`; không có đăng ký mật khẩu.
- Hệ lời mời cũ emulator-only (`#/accounts`, `AcceptInvitation`) bị ẩn khỏi giao diện (giữ mã); `scripts/invitation-browser-check.mjs` đánh dấu ngừng dùng; bỏ trang `/accounts` khỏi `ui-check.mjs` và `ui-standards-audit.mjs`.
- Kiểm thử: `tests/invitesClient.test.ts`, `tests/invitesClientRules.test.ts`, `npm run test:browser:invites` (Auth emulator thật: liên kết email, nhận lời mời, thu hồi/hết hạn/email lạ bị chặn; thêm vào CI).
- Chưa kiểm chứng: Firebase Auth thật, hạn mức/độ tin cậy gửi thư, Firestore thật.
- Review PR-D: liên kết email xử lý ở cấp App (chụp + làm sạch URL ngay, màn "đang đăng nhập tài khoản khác"); `updatePassword` ngẫu nhiên sau đăng nhập liên kết để chặn pre-hijacking (chưa kiểm chứng trên Firebase thật); giữ href khi email sai/mất mạng; email tạm hết hạn 1 giờ; thời gian chờ 60 giây giữa các lần gửi; khu mời chỉ báo khóa sau khi tải xong; không nuốt lỗi mạng thành "chưa có lời mời"; ẩn "Mời lại" cho email đã có tài khoản; thêm ca rules âm (anonymous, khai gian hết hạn/thu hồi/đã dùng, đồng hồ lệch).

# Lệnh xóa hẳn tài khoản (delete) — 2026-11-13

- `accounts.ts`/`accounts-core.ts`: lệnh `delete --email E [--apply --confirm-delete E]` (hàm thuần `planDelete`): chỉ xóa tài khoản đã vô hiệu hóa, không phải quản trị viên, sổ khớp users, còn quản trị viên sau khi xóa; giao dịch xóa `users/{uid}` + nhật ký `ACCOUNT_DELETED` (không email/tên) rồi mới xóa Auth; lời mời PENDING chỉ cảnh báo. Chạy thử có đọc dữ liệu (chỉ đọc) để in kế hoạch thật.
- Cập nhật hướng dẫn trong `#/users` và `docs/ACCOUNTS.md`; `scripts/accounts-e2e-check.mjs` thêm kịch bản delete trên emulator. Chưa chạy trên Firebase thật.
- Review `delete`: lời mời PENDING còn hạn nay CHẶN xóa (xóa xong người đó đăng nhập lại cùng email sẽ nhận lại quyền qua chính lời mời đang chờ, không cần ai mời lại); hàm thuần `recheckDelete` cho bước kiểm lại trong giao dịch; câu `--ack` riêng `XOA TAI KHOAN <project>` cho lệnh xóa; nhật ký `authOnly: true`; `auth/user-not-found` coi là đã xong.

# Lời mời một bước — 2026-11-13

- `#/users`: nút **Gửi thư mời** tạo lời mời và gửi thư ngay (đổi nhãn: Gửi lại thư mời / Mời lại và gửi thư; bảng có "Gửi lại thư" và "Thu hồi"); tạo xong gửi lỗi vẫn giữ lời mời và báo rõ.
- Liên kết trong thư mang `?invitee=<email>`: mở là tự đăng nhập (không hỏi email), tự kích hoạt lời mời (`InviteAccept`) và hiện lời chào một lần (`WelcomeBanner`, cờ sessionStorage). Email trong URL chỉ là đầu vào cho Firebase; quyền do rules quyết định. Giữ `updatePassword` ngẫu nhiên và màn xung đột tài khoản.
- Test: `tests/invitesClient.test.ts` (continue URL, `?invitee=`, lời chào), `scripts/invites-browser-check.mjs` (một bước, thiết bị sạch, `?invitee=` sai, thu hồi/hết hạn không kích hoạt, gửi lại, cooldown, tên có HTML, 360/768/1280). Chưa kiểm chứng trên Firebase thật.
- Review mời một bước: `?invitee=` chỉ gắn cho thư của quản trị viên; header "Đang đăng nhập: {email}" và lời chào nêu email + nút "Không phải bạn? Đăng xuất"; cờ chào mừng gắn uid và bị xóa khi đăng xuất/đổi tài khoản, đọc rồi xóa khi hiện; `InviteAccept` giữ lỗi cuối/đang kích hoạt theo khóa ở cấp module; khóa ô tên khi gửi lại; chặn mời email đã có tài khoản.

# Giới tính trong ảnh chụp cây — 2026-11-13

- Người dùng duyệt: `treeSnapshots/main` thêm phần tử thứ 8 `sex` cho mỗi người (giữ `schemaVersion` 1); `parseSnapshot` nhận 6/7/8 phần tử.
- App ghi/giữ `sex` khi sửa, thêm, khôi phục; nạp dữ liệu (`import-plan`) ghi `sex`; `reconcile` thêm `SEX_MISMATCH` và cảnh báo `SEX_NOT_IN_SNAPSHOT`.
- Lệnh mới `npm run gia-pha:snapshot-sex` (backfill/`--strip`), hành động cổng prod `DONG BO GIOI TINH`. Chưa chạy trên production.

# Đã mất không rõ năm — 2026-11-14

- Người dùng yêu cầu: checkbox "Đã mất" cho từng thành viên để làm sạch dữ liệu khi biết đã mất nhưng không rõ năm mất.
- `persons.deceased` (boolean, tùy chọn) và phần tử thứ 9 của bộ dữ liệu trong `treeSnapshots/main` (giữ `schemaVersion` 1; `parseSnapshot` nhận 6–9 phần tử). Rules `persons` cho phép khóa `deceased` kiểu boolean khi sửa/tạo; `memberProfiles` không đổi.
- Form Thêm/Sửa có checkbox "Đã mất"; có năm mất thì checkbox tự chọn và khóa (năm mất vẫn là nguồn chuẩn). Cây và hồ sơ hiện "đã mất" khi không có năm mất; Tổng quan tính là đã mất (không có tuổi, không bị coi là đang sống).
- `reconcile` thêm `DECEASED_MISMATCH`. Không cần backfill: dữ liệu cũ mặc định chưa đánh dấu. Chưa deploy rules lên production.

# Ghi chú hiển thị cho mọi thành viên — 2026-11-14

- Người dùng duyệt (phương án "Mọi thành viên"): ghi chú từng người hiện dạng tooltip ở Cây gia phả. Ảnh chụp cây thêm phần tử thứ 10 `note` (đã cắt 300 ký tự); `parseSnapshot` nhận 6–10 phần tử; `personPrivate` giữ bản đầy đủ cho quản trị viên.
- App công bố ghi chú khi sửa/thêm/khôi phục người (lưu lại một người = công bố ghi chú hiện có của họ); nhãn form đổi thành "Ghi chú (mọi thành viên đã đăng nhập đều xem được)" kèm cảnh báo; nhật ký đổi nhãn "Ghi chú" (vẫn chỉ ghi độ dài).
- Tooltip `PersonNameLink`: rê chuột/focus, giữ ~0,5 giây trên cảm ứng, Esc/chạm ngoài/cuộn để tắt, `aria-describedby`, chữ thuần.
- Lệnh mới `npm run gia-pha:snapshot-note` (dry-run mặc định, `--show` để rà soát, `--apply --expect-version`, `--strip`), hành động cổng prod `CONG BO GHI CHU`. Ghi chú cũ KHÔNG tự công bố hàng loạt. Chưa chạy trên production.
- Sửa kèm: `gia-pha:snapshot-sex` đọc được bộ 9–10 phần tử.
