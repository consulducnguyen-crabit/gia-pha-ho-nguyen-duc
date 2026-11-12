# Đổi cha/mẹ và loại con nuôi/ruột trong app (PR C2a)

Trang hồ sơ của quản trị viên có mục **Quan hệ cha mẹ (quản trị)**: đổi loại con nuôi/ruột cho từng
quan hệ và nút **Đặt hoặc đổi cha/mẹ**. Xóa mềm người/quan hệ và khôi phục là PR C2b.

## Quy tắc (src/editRelation.ts, hàm thuần `applyRelation`)

- `setParent` đặt cha hoặc mẹ cho một người đã có. Vai trò do người dùng chọn rõ, không suy từ giới tính;
  từ chối cha là nữ / mẹ là nam theo giới tính đã ghi.
- **Thay cha/mẹ đang có cần xác nhận** (`CONFIRM_REQUIRED`). Quan hệ cũ KHÔNG bị xóa cứng: tài liệu được
  đánh dấu `deleted`, `deletedAt/By`, `replacedBy`; snapshot bỏ dòng đó; nhật ký ghi quan hệ cũ (`before.removed`).
- Chống vòng lặp: không chọn con cháu (kể cả qua mẹ) làm cha/mẹ. Thủy tổ không thể có cha.
- Người thuộc dòng họ chỉ có cha thuộc dòng họ và đã nối tới thủy tổ (có đời): không tạo thủy tổ thứ hai.
  Nối một nhóm "mồ côi" vào cây tính lại đời cho cả nhánh.
- `lineageTransmission` = vai trò cha và cả hai thuộc dòng họ; con nuôi vẫn truyền dòng.
- Đời tính lại chỉ trong snapshot (`recomputeGenerations`), `persons.generation` là giá trị lịch sử.
- Không tạo lại một quan hệ đã từng có (kể cả đã ẩn): cần chức năng khôi phục (C2b).
- `setRelationType` đổi nuôi/ruột; `version` của quan hệ tăng 1; đời không đổi.

## Rules

Sự kiện `PARENT_CHANGED` (tạo quan hệ mới, ẩn quan hệ cũ nêu trong `removedRelationIds`) và
`RELATION_TYPE_CHANGED` (cập nhật `relationType`). Cập nhật quan hệ chỉ được đổi đúng các khóa cho phép,
`version` + 1, quan hệ phải thuộc người nêu trong nhật ký; không xóa cứng. Admin được `get` quan hệ theo mã
(không liệt kê). Snapshot chỉ cập nhật khi quan hệ mới được tạo / quan hệ cũ đã ẩn / phiên bản quan hệ tăng.

## Hoàn tác lần thay cha/mẹ (sự kiện PARENT_REVERTED)

Nút **Hoàn tác lần thay cha/mẹ** ở mục "Quan hệ cha mẹ (quản trị)" của từng dòng cha/mẹ. Một lô nguyên tử gồm bốn ghi:
quan hệ cũ sống lại (`deleted: false`, `replacedBy` bị XÓA để người con còn ẩn/khôi phục được về sau), quan hệ hiện
tại bị ẩn (`deleted`, `revertedAtVersion`), snapshot, và nhật ký `PARENT_REVERTED` (`relationIds` = quan hệ cũ,
`removedRelationIds` = quan hệ hiện tại, `revertsVersion` = số phiên bản của lần thay `PARENT_CHANGED` bị hoàn tác).

- Giao diện tự tìm lần thay: quan hệ hiện tại có `sourceRefs` trỏ tới nhật ký `PARENT_CHANGED` có quan hệ bị thay.
  Chỉ lần thay MỚI NHẤT của vai trò đó hoàn tác được (quan hệ hiện tại luôn do lần thay gần nhất tạo ra). Thay hai lần
  thì hoàn tác lần hai trước; sau đó nút lại đề xuất lần một.
- Lõi (`applyRevert`) kiểm lại trong giao dịch: nhật ký đúng sự kiện/người/quan hệ, quan hệ cũ đang ẩn và `replacedBy`
  đúng, cha/mẹ cũ và người con không bị ẩn và có trong cây, không tạo vòng lặp, cha dòng họ phải có đời, giới tính không
  trái vai trò, loại con và `lineageTransmission` của quan hệ cũ khớp nhật ký (lấy từ tài liệu quan hệ cũ, không tính lại).
- Rules: mỗi tài liệu tự chứng minh bằng chính nó + một `getAfter` chéo (quan hệ cũ có `replacedBy` đúng quan hệ bị ẩn
  trong lô; quan hệ bị ẩn có `sourceRefs == auditLogs/edit-{revertsVersion}` và đúng cặp), cha/mẹ cũ và con chưa bị ẩn.
- Nếu loại con (nuôi/ruột) của quan hệ hiện tại đã đổi sau lần thay, hoàn tác vẫn được và thay đổi đó KHÔNG được giữ
  (giao diện có cảnh báo; loại ấy vẫn nằm trong tài liệu quan hệ đã ẩn và `before` của nhật ký).
- Không có "làm lại" sau khi hoàn tác (quan hệ mới đã tồn tại thì không tạo lại bằng luồng đổi cha/mẹ).
- Thứ tự phát hành: deploy RULES trước, rồi frontend. Deploy rules prod cần người dùng duyệt.

## Gỡ quan hệ cha/mẹ nhập sai và khôi phục (PARENT_REMOVED / PARENT_REMOVAL_UNDONE)

Nút **Gỡ quan hệ** ở từng dòng cha/mẹ (mục "Quan hệ cha mẹ (quản trị)") ẩn một quan hệ nhập sai mà KHÔNG thay bằng người khác.

- Quyết định: **không gỡ được quan hệ truyền dòng** (`lineageTransmission`; cha theo dòng chỉ thay được) vì sẽ đứt dòng và
  đời của cả nhánh. Giao diện ẩn nút và giải thích. Mẹ, cha họ ngoại... (không truyền dòng) gỡ được.
- Cần xác nhận (`CONFIRM_REQUIRED`). Lô nguyên tử 3 ghi: quan hệ (`deleted`, `deletedAt/By`, `deletedWith: null`,
  `removedAtVersion = n`), snapshot (bỏ dòng; KHÔNG tính lại đời), nhật ký `PARENT_REMOVED` (`removedRelationIds` = quan hệ,
  `relationIds` = [], `before.removed` = người/vai trò/loại).
- Quan hệ có được do một lần thay (`replacedBy` ở quan hệ cũ) vẫn gỡ được; cha/mẹ cũ chỉ đưa lại được bằng cách khôi phục
  quan hệ đã gỡ rồi "Hoàn tác lần thay" (giao diện cảnh báo trước khi gỡ).
- **Khôi phục**: trong "Đặt hoặc đổi cha/mẹ", chọn đúng người đã bị gỡ -> nút **Khôi phục quan hệ đã gỡ** (giao diện đọc
  `removedAtVersion` từ quan hệ theo mã; admin được `get` theo mã). Lõi (`restoreRemovedParent`) đọc nhật ký `edit-{removeVersion}`
  và kiểm: đúng sự kiện/người/quan hệ, quan hệ còn đúng trạng thái "đã gỡ" (không `replacedBy`/`revertedAtVersion`/`deletedWith`),
  chỗ cha/mẹ của vai trò đó đang TRỐNG, cha/mẹ và con không bị ẩn, không vòng lặp, giới tính khớp, không có vai trò kia.
  Ghi: quan hệ (`deleted: false`, `removedAtVersion` xóa, `restoredAt/By`), snapshot (thêm dòng, không truyền dòng), nhật ký
  `PARENT_REMOVAL_UNDONE` (`revertsVersion`).
- Rules: mỗi tài liệu tự chứng minh bằng nhật ký trong lô; `removedAtVersion == n` (gỡ) và `== revertsVersion` (khôi phục);
  không gỡ quan hệ `lineageTransmission == true` hay đã ẩn; ngân sách <10 truy cập tài liệu mỗi yêu cầu.
- **Lỗ hổng đã vá**: nhánh `PERSON_RESTORED` trước đây chỉ kiểm `deletedWith == người`, nên quan hệ đã gỡ còn `deletedWith` cũ
  có thể bị hồi sinh. Nay (1) khi gỡ ghi `deletedWith: null`, (2) mọi nhánh hồi sinh (`PERSON_RESTORED`, `PARENT_REVERTED`)
  yêu cầu `removedAtVersion == null`; khôi phục việc gỡ xóa `removedAtVersion` để quan hệ về trạng thái bình thường.
- Chuỗi a->c, gỡ c, khôi phục việc gỡ, "Hoàn tác lần thay" về a: chạy được (có test rules).

## Giới hạn đã biết

- Đổi cha sang người thuộc chi khác KHÔNG tự đổi chi của người con và cháu; cần sửa chi bằng form sửa hồ sơ.
- Quan hệ đã ẩn do thay cha/mẹ chỉ đưa lại bằng "Hoàn tác lần thay" (không khôi phục tùy ý); quan hệ đã GỠ chỉ khôi phục bằng nút riêng; `functions/src/proposals.ts` (chỉ emulator) chưa lọc
  `deleted` khi kiểm đồ thị; `counts.relations` của snapshot không được cập nhật khi thêm/ẩn quan hệ.

- Rules không kiểm nội dung JSON snapshot và không kiểm hai vai trò trong một lô; script đối soát (PR D).
- Chưa thử giới hạn truy cập tài liệu của rules trên Firestore thật.
- Chưa đổi loại người (dòng họ ↔ họ ngoại) và chưa chuyển nhóm mồ côi bằng thao tác riêng.

## Kiểm thử

`tests/editRelation.test.ts`, `tests/editRules.test.ts` (nhóm "đổi cha/mẹ và loại con"),
`scripts/edit-browser-check.mjs` (đặt cha cho người chưa nối, thay cha có xác nhận, đổi sang con nuôi, gỡ mẹ có xác nhận rồi khôi phục).
