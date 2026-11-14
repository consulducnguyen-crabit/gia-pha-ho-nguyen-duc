# Security requirements — mandatory

1. GitHub Pages publishes **public frontend assets**; never put private genealogical records in repo, `public/`, build outputs or static JSON.
2. Firebase Auth login alone is insufficient: verify `users/{uid}.enabled == true` (or trusted custom claims) in Firestore and Storage rules.
3. Default deny. Unauthenticated or unapproved users cannot read any genealogy data or media.
   3b. **Thay đổi so với chính sách cũ (2026-11-12, người dùng duyệt)**: quản trị viên (`manager()`) được `allow get` `unions/{id}` theo mã để nhận biết liên kết vợ/chồng đã gỡ (IN_APP_EDIT_UNIONS.md). Vẫn KHÔNG cho liệt kê; thành viên thường, ẩn danh và tài khoản bị tắt vẫn không đọc được `unions`.
4. (Admin edits in-app only through the audited, versioned batch in IN_APP_EDIT.md.) Ordinary members may create constrained change requests, but cannot write `persons`, `relations`, `branches`, `users`, `auditLogs`, or approve their own request.
5. Privileged approval is executed by trusted backend with authenticated role verification and idempotent, version-checked operations. Do not trust `role`, `approvedBy`, or `status` sent by client.
6. Account provisioning, role elevation and disabling users: client writes to `users` are allowed ONLY through the guarded paths of "Cấp quyền trong app" below (PR-A, 2026-11-13); never self-assign admin, never trust a client-side role.
7. Storage rules enforce path ownership, mime/size limits, and role-based access; media metadata must not bypass ACL.
8. For high-risk operations (bulk imports, merging identities, changing lineage), use dry-run, explicit confirmation, backup and audit.
9. Separate Firebase dev/prod projects; production changes require review.
10. Test rules with Firebase Emulator: anonymous, pending, member, editor, approver, disabled user; direct SDK attacks, cross-document access, query filtering, file access.
11. Keep API keys vs secrets distinct: Firebase web config can be public, service-account keys cannot. Security depends on Rules and trusted backend, not obscuring web config.
12. Configure App Check where appropriate as defense-in-depth, not as substitute for authentication and rules.
13. Plan privacy notices, data retention, deletion/correction procedures, export and access audit.

Never deploy permissive placeholder rules to production.

## Cấp quyền trong app (PR-A, chỉ rules + test; chưa deploy)

Gói Spark, không Cloud Functions: quyền quản trị tài khoản được thực thi bằng `firestore.rules` (test: `tests/accountRules.test.ts`, 100% dữ liệu giả).

- **Sổ quản trị viên** `accessControl/admins` (`adminUids` <= 20, `version`, `lastTargetUid`, `schemaVersion` 1). Bất biến: uid thuộc `adminUids` khi và chỉ khi `users/{uid}.enabled == true && canManageMembership == true`. Client KHÔNG tạo/xóa sổ (khởi tạo bằng script Admin ở PR sau). Cập nhật: người thao tác thuộc sổ cũ và `manager()`, mục tiêu khác chính mình, `version` +1, `lastTargetUid` = mục tiêu, đúng một uid đổi mỗi lần, sổ sau không rỗng. **Sổ KHÔNG được cập nhật đứng riêng**: chỉ đổi trong cùng lô với `users/{mục tiêu}` đổi trạng thái admin (get khác getAfter, đúng chiều nâng/hạ) và nhật ký ACCOUNT_UPDATED đi kèm. Sổ đã lệch (users đổi ngoài lô, ví dụ thu hồi bằng script Admin) phải do script Admin sửa ở PR sau; client không sửa được.
- **Quyền quản trị viên = `manager()` VÀ có trong sổ** (`ledgerAdmin()`); quản trị viên có cờ trong `users` nhưng thiếu trong sổ không làm được gì (đóng khi lỗi, kể cả khi sổ chưa tồn tại).
- **Sửa `users/{uid}` của người khác**: chỉ `enabled`, `canManageMembership`, `displayName`, `accessVersion`, `updatedBy/At`, `approvedBy/At`, `disabledBy/At`. Không chạm `roleIds`, `canReviewChanges`, `email`, `schemaVersion`. `accessVersion` +1, `updatedBy == auth.uid`, `updatedAt == request.time`, `canManageMembership` kéo theo `enabled`. Lô bắt buộc có `auditLogs/account-{uid}-{accessVersion}` (ACCOUNT_UPDATED); nếu trạng thái admin đổi thì bắt buộc ghi cả sổ, nếu không đổi thì sổ KHÔNG được đổi. Không tự thao tác trên chính mình; client không tạo/xóa `users` (trừ nhận lời mời).
- **Tạo tài khoản bởi quản trị viên** (`adminCreateOk`): chỉ quản trị viên có trong sổ, uid mới, hồ sơ chỉ xem (`enabled`, `roleIds:[member]`, không `canManageMembership`/`canReviewChanges`), `mustChangePassword: true`, `createdVia` phone/email, kèm `auditLogs/account-{uid}-1` (`ACCOUNT_CREATED`) trong cùng lô. Người dùng tự hạ `mustChangePassword` của chính mình (`passwordChangedOk`) — cờ chỉ điều khiển màn đổi mật khẩu, không phải ranh giới bảo mật. Lời mời qua email đã gỡ (PR3).
- Không còn đường tự kích hoạt: người dùng không tự tạo `users/{uid}` được (`allow create` chỉ còn `adminCreateOk`).
- Nhật ký tài khoản vẫn **không client nào đọc được** (rule `get` auditLogs chỉ cho 12 sự kiện sửa); `ACCOUNT_UPDATED` chỉ chứa cờ `enabled/admin`, không tên, không email.
- `approvedBy/At`, `disabledBy/At` (nếu có trong lần sửa) bắt buộc bằng `auth.uid` / `request.time`.
- Đã kiểm chứng bằng Auth emulator (REST `sendOobCode` EMAIL_SIGNIN, `signInWithEmailLink`): token đăng nhập bằng liên kết email có `firebase.sign_in_provider = 'password'` và `email_verified = true`, nên danh sách provider `['google.com', 'password']` là đúng; đăng ký mật khẩu thường có `email_verified = false` và bị chặn. Chưa kiểm chứng trên Firebase Auth thật.
- Hàm `hashing.sha256(...).toHexString()` của rules trả chữ HOA; rules dùng `.lower()` để so với chuỗi hex thường của client.
- Ngân sách truy cập tài liệu: mỗi thao tác <= 6 tài liệu riêng biệt (giới hạn 10/thao tác, 20/lô).
- Chống đua ghi: client phải ghi `version`/`adminUids` bằng giá trị cụ thể; lô dựng từ sổ cũ bị từ chối vì `version` đã đổi, hai quản trị viên cùng nâng hai người khác nhau từ cùng sổ cũ chỉ một lô thắng. Hành vi thật (đo trên emulator): nếu client dùng `increment(1)`/`arrayUnion(uid)`, rules đánh giá giá trị KẾT QUẢ tính trên trạng thái hiện hành, nên lô dựng từ sổ cũ vẫn qua nhưng được tính lại trên sổ mới (không ghi đè mất người vừa nâng); điều này an toàn nhưng không còn là "thất bại khi lỗi thời". UI nên ghi giá trị cụ thể trong transaction để phát hiện xung đột. Commit đồng thời thật chỉ kiểm chứng được trên Firestore thật; emulator mô phỏng tuần tự.
