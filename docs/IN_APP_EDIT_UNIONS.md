# Gỡ liên kết vợ/chồng nhập sai và khôi phục (UNION_REMOVED / UNION_REMOVAL_UNDONE, PR-6)

Mục **Quan hệ vợ/chồng (quản trị)** trên hồ sơ (chỉ quản trị viên) có nút **Gỡ liên kết** ở từng vợ/chồng. Không xóa cứng:
liên kết được ẩn, ghi vào nhật ký và khôi phục được. Hai người vẫn còn trong cây.

## Quyết định đã duyệt (2026-11-12)

- Q1 = A: quản trị viên được `allow get` `unions/{id}` theo mã (KHÔNG liệt kê). Thành viên thường và ẩn danh vẫn không đọc
  được. Đây là thay đổi so với chính sách cũ "không client nào đọc unions" (xem SECURITY_RULES.md).
- Q2 = A: vẫn gỡ được khi người kia thành mồ côi (không còn cha mẹ, con, vợ/chồng khác); giao diện cảnh báo và gợi ý
  "Ẩn người này khỏi cây".
- Q3 = A: vẫn gỡ được khi hai người có con chung; giao diện cảnh báo kèm số con chung. Quan hệ cha/mẹ–con không đổi.
- Q4 = A: KHÔNG sửa thứ tự/trạng thái/ghi chú của liên kết, KHÔNG thêm năm kết hôn.

## Gỡ (`applyUnion`, `removeUnion`, src/editUnion.ts)

- Cần xác nhận (`CONFIRM_REQUIRED`; giao diện bắt buộc tích ô xác nhận). Hai người phải có trong cây và không bị ẩn; liên kết
  phải có trong snapshot (đúng MỘT dòng), tài liệu `unions/{id}` còn "đang hiện" và khớp `partnerIds`/`order` của snapshot.
- Lô nguyên tử đúng **3 ghi**: `unions/{id}` (`deleted: true`, `deletedAt/By`, `deletedWith: null`, `removedAtVersion = n`),
  `treeSnapshots/main` (bỏ dòng `[a, b, order]`, `editVersion + 1`), `auditLogs/edit-{n}`. KHÔNG đụng `persons`,
  `memberProfiles`, `relations` và KHÔNG tính lại đời (liên kết vợ/chồng không truyền dòng).
- Nhật ký `UNION_REMOVED`: `personId` = người đang xem (thuộc `partnerIds`), `target = persons/{personId}`, `unionId`,
  `moreUnionIds = []`, `relationIds = []`, `removedRelationIds = []`, `createdPersonIds = []`, `revertsVersion = null`,
  `before.removed = { spouseId, order }`.
- Liên kết "đang hiện" có thể còn `deletedWith` cũ sau khi ẩn rồi khôi phục một người (chỉ `deleted` là nguồn sự thật): việc gỡ vẫn được phép và đặt `deletedWith: null` (phát hiện khi chạy kiểm tra trình duyệt, có test).
- `deletedWith: null` khi gỡ: xóa dấu "ẩn cùng người" cũ còn sót để liên kết đã gỡ không bị hồi sinh khi khôi phục người.
- Union không có trường `version`, nên rules chứng minh "ghi trong lô này" bằng `deletedAt/restoredAt == request.time`.
  `schemaVersion` không đổi.

## Khôi phục (`restoreRemovedUnion`)

- Đường vào: **Thêm vợ/chồng** -> "Người đã có trong cây" -> chọn đúng người. Giao diện đọc `unions/{id}` theo mã
  (`findRemovedUnion`); nếu có dấu gỡ thì nút "Lưu" đổi thành **Khôi phục liên kết đã gỡ** (không còn báo
  `permission-denied` khó hiểu do tạo trùng liên kết đã ẩn).
- Lõi đọc nhật ký `edit-{removeVersion}` và kiểm: đúng sự kiện `UNION_REMOVED`, đúng `unionId`/cặp người, `removeVersion`
  khớp `removedAtVersion`, không `deletedWith`, dòng chưa có trong snapshot, hai người không bị ẩn.
- Ghi: `unions/{id}` (`deleted: false`, `removedAtVersion: null`, `restoredAt/By`), snapshot (thêm dòng ở CUỐI, thứ tự hai
  người theo `partnerIds`, `order` lấy từ nhật ký), nhật ký `UNION_REMOVAL_UNDONE` (`revertsVersion` = số lần gỡ,
  `after = { spouseId, order }`). Thứ tự hiển thị vợ/chồng có thể đổi (liên kết nằm cuối danh sách).

## Rules (firestore.rules)

- `auditCreateOk`: kiểm hình dạng hai sự kiện; `moreUnionIds` rỗng, `relationIds` rỗng; `before.removed.spouseId` là chuỗi khác
  `personId` (gỡ); `revertsVersion` trong `[1, editVersion)` và `after.spouseId` khác `personId` (khôi phục).
- `snapshotUpdateOk`: nhánh gỡ (`get(union).deleted == false`, `getAfter.deleted == true`, `getAfter.removedAtVersion == n`) và
  nhánh khôi phục (`get.deleted == true`, `getAfter.deleted == false`, `getAfter.restoredAt == request.time`).
- `unionLifecycleOk` nhánh gỡ: `id == a.unionId`, `personId` và `before.removed.spouseId` thuộc `partnerIds` (khác nhau),
  chỉ đổi khóa `deleted/deletedAt/deletedBy/deletedWith/removedAtVersion`, `deletedWith == null`, `removedAtVersion == n`.
  Nhánh khôi phục: `resource.removedAtVersion == a.revertsVersion`, `deletedWith == null`, cả hai người `persons.deleted == false`,
  `after.spouseId` thuộc cặp, chỉ đổi `deleted/removedAtVersion/restoredAt/restoredBy`.
- **Vá**: nhánh `PERSON_RESTORED` của `unionLifecycleOk` thêm `resource.removedAtVersion == null` (chặn hồi sinh chéo liên kết
  đã gỡ khi khôi phục một người; xem IN_APP_EDIT_DELETE.md).
- Ngân sách: mỗi tài liệu của lô dùng tối đa vài truy cập nền + 2 truy cập `get` người (khôi phục); tổng thấp hơn nhiều giới
  hạn 10 truy cập/yêu cầu và 20/lô (chỉ dùng chỉ số cố định, không vòng lặp).
- Chỉ `manager()` ghi và đọc. Thứ tự phát hành: deploy RULES trước, rồi frontend. Deploy rules prod cần người dùng duyệt.

## Giới hạn đã biết

- Rules không kiểm nội dung JSON snapshot; script đối soát (mã `UNION_REMOVED_BAD_STATE`, và `SNAPSHOT_UNION_NOT_LIVE` /
  `UNION_NOT_IN_SNAPSHOT` đã có) là lớp kiểm cuối.
- Khôi phục: ô "Thứ tự" bị vô hiệu khi cặp có liên kết đã gỡ (thứ tự lấy từ nhật ký); nút Lưu bị khóa khi đang tra liên kết cũ, và nếu tra lỗi thì báo "Không kiểm tra được liên kết cũ" và khóa gửi (không coi như không có).
- Đối soát thêm `SNAPSHOT_UNION_DUPLICATE`, `UNION_SELF`, `UNION_ORDER_MISMATCH`, và `UNION_REMOVED_BAD_STATE` nay kiểm `removedAtVersion` trỏ tới nhật ký `edit-N` có sự kiện `UNION_REMOVED`.
- Giao diện chỉ đọc được liên kết đã gỡ khi biết đúng cặp (đi từ "Thêm vợ/chồng"); chưa có danh sách liên kết đã gỡ.
- Chưa thử giới hạn truy cập tài liệu của rules trên Firestore thật (chỉ emulator).

## Kiểm thử

`tests/editUnion.test.ts` (lõi), `tests/editRules.test.ts` nhóm "gỡ vợ/chồng: rules", `tests/reconcile.test.ts`,
`tests/replaceGuard.test.ts`, `scripts/edit-browser-check.mjs` (người có 2 vợ/chồng -> gỡ 1 có xác nhận -> cây không còn ->
khôi phục qua "Thêm vợ/chồng" -> đối soát ĐẠT; không tràn ngang 360/768/1280).
