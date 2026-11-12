# Firestore data model — proposal, not final

## Collections
- `persons/{personId}`: displayName, normalizedName, sex(optional), birth/death date objects, lineageStatus, profileVersion, createdAt, updatedAt.
- `persons/{personId}/names/{nameId}`: type, value, sourceRefs.
- `relations/{relationId}`: parentId, childId, relationType, lineageTransmission, verificationStatus, sourceRefs, version.
- `unions/{unionId}`: partnerIds, status, eventDate, sourceRefs.
- `relations/{id}` bị ẩn khi hoàn tác thay cha/mẹ có `revertedAtVersion`; `auditLogs` sự kiện `PARENT_REVERTED` có `revertsVersion` (xem IN_APP_EDIT_RELATIONS.md).
- `relations/{id}` bị gỡ (cha/mẹ nhập sai) có `deleted`, `removedAtVersion` = số edit của sự kiện `PARENT_REMOVED`; khôi phục (`PARENT_REMOVAL_UNDONE`, `revertsVersion` = số đó) đặt `deleted: false` và đặt `removedAtVersion` về `null`. Quan hệ còn `removedAtVersion` không bị hồi sinh bởi luồng nào khác.
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
`memberProfiles/{personId}` là projection do backend tạo bằng allowlist: displayName, normalizedName, profileVersion, schemaVersion. Không chứa ngày sinh đầy đủ, liên hệ, nguồn, ghi chú hoặc lý do ngoại lệ. Client chỉ đọc collection này khi enabled.
`persons`, `personPrivate`, names và mọi quan hệ/override hiện mặc định từ chối client để tránh lộ dữ liệu qua document phụ. Chưa có backend tạo projection production. Không migrate hay tự công bố dữ liệu cũ; phải có dry-run và review phân loại trước backfill. Seed dev chỉ ghi projection giả.

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
