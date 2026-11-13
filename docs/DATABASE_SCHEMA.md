# Firestore data model — proposal, not final

## Collections

- `persons/{personId}`: displayName, normalizedName, sex(optional), birth/death date objects, lineageStatus, profileVersion, createdAt, updatedAt.
- `persons/{personId}/names/{nameId}`: type, value, sourceRefs.
- `relations/{relationId}`: parentId, childId, relationType, lineageTransmission, verificationStatus, sourceRefs, version.
- `unions/{unionId}`: partnerIds, status, eventDate, sourceRefs.
- `relations/{id}` bị ẩn khi hoàn tác thay cha/mẹ có `revertedAtVersion`; `auditLogs` sự kiện `PARENT_REVERTED` có `revertsVersion` (xem IN_APP_EDIT_RELATIONS.md).
- `relations/{id}` bị gỡ (cha/mẹ nhập sai) có `deleted`, `removedAtVersion` = số edit của sự kiện `PARENT_REMOVED`; khôi phục (`PARENT_REMOVAL_UNDONE`, `revertsVersion` = số đó) đặt `deleted: false` và đặt `removedAtVersion` về `null`. Quan hệ còn `removedAtVersion` không bị hồi sinh bởi luồng nào khác.
- `unions/{id}` bị gỡ (vợ/chồng nhập sai) có `deleted: true`, `deletedWith: null`, `removedAtVersion` = số edit của sự kiện `UNION_REMOVED`; khôi phục (`UNION_REMOVAL_UNDONE`, `revertsVersion` = số đó) đặt `deleted: false`, `removedAtVersion: null`, `restoredAt/By`. Union không có `version`; không đổi `schemaVersion`. Liên kết còn `removedAtVersion` không bị hồi sinh bởi `PERSON_RESTORED` (xem IN_APP_EDIT_UNIONS.md).
- `auditLogs/edit-N` (ẩn/khôi phục người): `unionId` = liên kết vợ/chồng đầu, `moreUnionIds` = tối đa 5 liên kết còn lại (xem IN_APP_EDIT_DELETE.md).
- `branches/{branchId}`: name, founderPersonId, parentBranchId, status, mergedFrom (ghi chú nguồn gốc nếu nhánh hợp nhất từ dòng khác; không tách gốc riêng).
- `generationOverrides/{overrideId}`: personId, generation, reason, approvedBy, approvedAt.
- `changeRequests/{requestId}`: authorUid, status, baseVersions, proposedOperations, evidenceRefs, decision.
- `users/{uid}`: enabled, roleIds, approvedAt, approvedBy; server-controlled.
- `media/{mediaId}`: ownerPersonId, storagePath, mime, classification, uploadedBy.
- `importBatches/{batchId}`: state, checksum, validationSummary, actorUid.
- `auditLogs/{logId}`: event, actorUid, target, timestamp, summary.
- `treeSnapshots/{scopeId}`: dataVersion, generatedAt, restricted cache payload; optional.

## Design requirements

- UUID/Firestore IDs, no row numbers as identifiers.
- Denormalized display fields only as cache; canonical relations in `relations`.
- Query indexes for parentId, childId, branchId, normalizedName, status/createdAt.
- Avoid unbounded reads and N+1 requests when drawing a tree.
- Version checks and transactional writes for approval.
- Do not assume Firestore offers SQL joins/recursive CTE. Build bounded graph traversal in trusted code or versioned materialized snapshots.
- Audit and multi-record changes must respect Firestore transaction/batch limits.
- Plan for sensitive-field segregation if privacy tiers are approved.
- Date object: `{calendar, year, month, day, precision, leapMonth, approximate, originalText}` with nullable components.
- Keep a migration manifest and backward compatibility strategy.

## Storage

Paths like `private/persons/{personId}/{mediaId}`; Storage Rules must check membership/role, not rely on obscurity of URLs. Avoid long-lived publicly usable download tokens for restricted media.

## Privacy revision — đã phê duyệt chính sách

`memberProfiles/{personId}` là projection tạo bằng allowlist: displayName, normalizedName, profileVersion, schemaVersion, birthYear, deathYear (nạp bằng script quản trị; cập nhật trong lô sửa của quản trị viên). Không chứa ngày sinh đầy đủ, liên hệ, nguồn, ghi chú hoặc lý do ngoại lệ. Client chỉ đọc collection này khi enabled.
`persons`, `personPrivate` chỉ quản trị viên (`manager`) đọc; `relations` chỉ `get` theo mã (trong giao dịch của quản trị viên), `unions` chỉ quản trị viên `get` theo mã (không liệt kê; thay đổi 2026-11-12 để biết liên kết đã gỡ), ghi qua lô sửa; thành viên thường không đọc được các collection này (tên và quan hệ cho thành viên lấy từ `memberProfiles` và `treeSnapshots/main`). Không migrate hay tự công bố dữ liệu cũ; phải có dry-run và review phân loại trước backfill. Seed dev chỉ ghi projection giả.

## Lời mời — schema 1, chỉ emulator

- invitations/{sha256Token}: targetUid, email, issuerUid, issuerAccessVersion,
  targetAccessVersion, status (PENDING/ACCEPTED/REVOKED), createdAt, expiresAt,
  schemaVersion; acceptedBy/At hoặc revokedBy/At khi chuyển trạng thái. Không lưu mã thô.
- users bổ sung accessVersion: integer tăng khi cấp/thu hồi membership;
  canManageMembership chỉ ở fixture manager do server tạo. Legacy missing version=0;
  null/invalid version bị từ chối. Không cho client tự sửa bất kỳ trường quyền nào.
- auditLogs bổ sung sự kiện INVITATION_CREATED/ACCEPTED/REVOKED và MEMBERSHIP_DISABLED.
  Receipt thu hồi dùng request UUID để retry không ghi lại; không có email/token thô.

Không migrate dữ liệu thật hoặc đổi schema version gốc. Xem INVITATIONS.md cho
invariants transaction và các quyết định production chưa chốt.

## Đề xuất — schema 1, chỉ emulator

- changeRequests: authorUid, status, revision, operation, before (allowlist từ
  projection), requiredApprovals (backend suy ra và đối chiếu), votes, reviewNote,
  needsEdit và timestamps. Không dùng client-supplied role/status/approval.
- proposalRevisions/{requestId}-r{revision}: snapshot bất biến operation/before và
  danh tính tác giả. Apply kiểm tra snapshot tồn tại và khớp trước khi ghi canonical.
- Phiếu gồm UID, revision, accessVersion và userUpdateTime. Quyền canReviewChanges
  (canReviewLineage cũ không còn dùng) chỉ được cấp bởi fixture server-side trong bản thử nghiệm.
- graphState/parentage: schemaVersion và version, khóa giao dịch chung cho mọi
  lần thêm quan hệ. relations mới có parentRole, relationType, lineageTransmission,
  verificationStatus=APPROVED, version, schemaVersion và sourceRefs trỏ revision.
- Audit chỉ metadata ID/trạng thái/version; không ghi tên hoặc căn cứ đề xuất.

Không có migration production; request/graph cũ thiếu cấu trúc bị chặn. Capability
reviewer được bảo vệ khỏi luồng quản lý ordinary-member để không âm thầm xóa quyền.
Xem PROPOSALS.md về workflow, giới hạn graph và rollback.

## Tài khoản và lời mời trong app — schema 1 (PR-A, chưa deploy)

- `accessControl/admins`: `adminUids` (list<string>, 1..20), `version` (int, +1 mỗi lần đổi), `lastTargetUid` (string), `schemaVersion` 1. Bất biến: uid thuộc `adminUids` khi và chỉ khi `users/{uid}.enabled == true && canManageMembership == true`. Client chỉ update; khởi tạo bằng script Admin.
- `accountInvites/{emailViếtThường}`: `email`, `role` ('VIEWER'), `displayName`?, `status` (PENDING|ACCEPTED|REVOKED), `nonce` (36 ký tự), `createdBy`, `createdAt`, `expiresAt` (<= 7 ngày), `acceptedBy/At`, `revokedBy/At`, `schemaVersion` 1. Chứa email nên chỉ quản trị viên và đúng người được mời đọc được.
- `users/{uid}` tạo khi nhận lời mời có thêm `email`, `displayName`?, `approvedBy`, `approvedAt`, `invitationNonce`; `updatedBy/At`, `disabledBy/At` khi quản trị viên sửa. `accessVersion` tăng 1 mỗi lần sửa.
- `auditLogs` thêm sự kiện: `ACCOUNT_UPDATED` (`account-{uid}-{accessVersion}`; `fields` thuộc enabled/admin/displayName, `before/after` chỉ `enabled/admin`, không tên/email), `INVITATION_ACCEPTED` (`account-{uid}-1`), `INVITE_CREATED` (`invite-{nonce}`), `INVITE_REVOKED` (`invite-{nonce}-revoked-{uid}`); cả hai có `inviteKey` = sha256 hex thường của khóa email (không ghi email) và `timestamp` = thời điểm máy chủ. Không client nào đọc được các nhật ký này.
- Không migration dữ liệu thật; sổ được tạo từ danh sách quản trị viên hiện có bằng script ở PR sau.
