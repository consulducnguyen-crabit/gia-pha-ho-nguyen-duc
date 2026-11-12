# Sửa dữ liệu trực tiếp trong app (PR A — lõi và rules)

Quyết định 2026-11-11: sau giai đoạn làm sạch, Firestore là nguồn dữ liệu duy nhất; admin sửa
trực tiếp trong app trên gói Spark (không Blaze, không Functions). PR này chỉ có **lõi và rules**,
chưa có giao diện (PR B) và chưa có thao tác quan hệ (PR C).

## Mô hình ghi

Mỗi lần sửa là MỘT lô ghi nguyên tử (`runTransaction`, đọc và ghi cùng giao dịch):

| Tài liệu                       | Cách ghi                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| `persons/{id}`                 | merge; `profileVersion` + 1 (rules bắt buộc)               |
| `memberProfiles/{id}`          | ghi đầy đủ lại (không còn trường cũ); `profileVersion` + 1 |
| `personPrivate/{id}`           | merge `note` (chỉ khi ghi chú đổi)                         |
| `treeSnapshots/main`           | chỉ `data` và `editVersion` + 1                            |
| `auditLogs/edit-{editVersion}` | tạo mới, không sửa/xóa                                     |

Lõi thuần `src/editCore.ts` (`applyEdit`) tính ra lô này; `src/editClient.ts` (`commitEdit`) đọc/ghi.
Thao tác hiện có: `updatePerson` (tên, năm sinh, năm mất, ghi chú, chi, giới tính, thêm/gỡ cờ;
gỡ cờ = đã xác minh).

## Khóa phiên bản

`treeSnapshots/main.editVersion` (số nguyên, thiếu = 0) tăng đúng 1 mỗi lần sửa. Giao diện gửi
`expectedVersion` đã đọc; lệch thì `applyEdit` ném `VERSION_CONFLICT`. Ở rules, id nhật ký suy từ
phiên bản (`edit-{n}`) và chỉ `create`, nên hai người cùng ghi phiên bản n thì người sau thất bại
(nhật ký đã tồn tại) và không có lần sửa nào thiếu nhật ký. `dataVersion` (mã lô nạp) giữ nguyên.

## Rules (`editGate`)

Chỉ `manager()` (`canManageMembership`). Lô hợp lệ phải có ĐỦ bốn phần, ràng buộc chéo nhau:
`persons/{id}` và `memberProfiles/{id}` (`profileVersion` + 1), `treeSnapshots/main`
(`editVersion` + 1, chỉ `data` chuỗi < 900000 ký tự), và `auditLogs/edit-{n}` (`actorUid` là người gọi,
`personId`, `target == persons/{personId}`, `timestamp == request.time`). Snapshot chỉ được cập nhật khi
persons và memberProfiles của người trong nhật ký cùng tăng phiên bản; persons/personPrivate/memberProfiles
chỉ ghi khi snapshot và nhật ký có trong lô.

Allowlist trường: `memberProfiles` chỉ tên + năm sinh/mất (đúng quyết định riêng tư, đúng kiểu);
`persons` chỉ displayName, normalizedName, birth, death, branchCode, sex, sexBasis, reviewFlags,
profileVersion, updatedAt (= `request.time`), updatedBy (= người gọi); `personPrivate` chỉ `note` ≤ 2000
ký tự và chỉ cho người đã tồn tại; nhật ký chỉ các khóa cố định. Không tạo/xóa `persons`, không sửa/xóa
nhật ký. Admin đọc được `persons`, `personPrivate` và `get` từng nhật ký `PERSON_EDITED`; nhật ký tài khoản/lời mời vẫn đóng với mọi client, không liệt kê được.

## Giới hạn đã biết

- Rules không phân tích JSON của snapshot, nên không chứng minh `data` khớp `persons`/`relations`
  (một admin hoặc client lỗi vẫn có thể ghi snapshot lệch quan hệ, miễn kèm persons/profiles/nhật ký hợp
  lệ của một người). Cần script đối soát snapshot ↔ persons ↔ relations chạy định kỳ (việc còn lại, PR D).
- Nhật ký chứng minh AI sửa NGƯỜI NÀO ở phiên bản nào (rules ép kiểu khóa cố định); nội dung `fields`/`before`/
  `after` do client điền, rules không kiểm chi tiết.
- Đổi giới tính bị từ chối nếu mâu thuẫn vai trò cha (F)/mẹ (M) trong quan hệ hiện có.
- Xóa năm (null) bỏ cả ngày đầy đủ của ngày gốc mà không cần xác nhận; giá trị cũ còn trong nhật ký.
- Sửa năm giữ tháng/ngày của ngày gốc; ngày gốc "không rõ/mâu thuẫn" chỉ bị thay khi gửi
  `replaceRawDate`. Nhật ký giữ nguyên object ngày cũ.
- Nhật ký KHÔNG lưu nguyên văn ghi chú (riêng tư, không xóa được từ client), chỉ độ dài; nội dung cũ của
  ghi chú chỉ khôi phục từ sao lưu. Tên/năm/chi/giới tính/cờ lưu trước-sau.
- Cờ `DUP_NAME` khi đổi tên: form sửa so tên mới (đúng dấu, không phân biệt hoa/thường, cùng đời đã biết) với snapshot, hiện cảnh báo kèm liên kết và tự gắn cờ cho CHÍNH người đang sửa (gỡ nếu tên mới không còn trùng). Người trùng kia KHÔNG bị ghi vì rules chỉ cho mỗi lần sửa một người; admin gắn cờ cho họ bằng form nếu cần. Form thêm con chỉ cảnh báo (rules bắt buộc `reviewFlags` rỗng khi tạo). Chỉ so khi đời đã biết, giống quy tắc nạp dữ liệu.
- `--replace` của script nạp giữ `editVersion` cũ (tránh khóa chết vì `edit-N` còn) nhưng vẫn GHI ĐÈ các sửa
  trong app; bị chặn trên prod và cần --discard-app-edits ở dev (xem INTEGRITY_GUARD.md). Không chạy `--replace` trên prod sau khi có sửa trong app.
  Khôi phục từ sao lưu cũ cũng cần giữ `editVersion` lớn nhất của `auditLogs/edit-*`.
- Giao diện và các thao tác quan hệ/hôn nhân/ẩn–khôi phục đã có; quan hệ cha/mẹ đã bị thay thế chưa khôi phục được riêng lẻ (xem IN_APP_EDIT_UI.md, _ADD, _RELATIONS, _DELETE, _UNIONS).

## Kiểm thử

`npm test` (tests/editCore.test.ts) và `npm run test:rules` (tests/editRules.test.ts: admin hợp lệ,
member/anonymous bị chặn, thiếu nhật ký/snapshot, sai target/actor, nhảy phiên bản, phát lại,
`profileVersion`, không xóa/sửa nhật ký). Dữ liệu giả, project `demo-gia-pha-edit`.

## Xem nhật ký

Trang `#/audit` (chỉ quản trị viên) đọc `auditLogs/edit-{n}` theo mã để xem lại mọi lần sửa; không đổi rules. Xem AUDIT_LOG_UI.md.

## Tài liệu liên quan

- [IN_APP_EDIT_UI.md](IN_APP_EDIT_UI.md) (biểu mẫu), [IN_APP_EDIT_ADD.md](IN_APP_EDIT_ADD.md) (thêm con/vợ chồng), [IN_APP_EDIT_RELATIONS.md](IN_APP_EDIT_RELATIONS.md) (cha/mẹ), [IN_APP_EDIT_DELETE.md](IN_APP_EDIT_DELETE.md) (ẩn/khôi phục), [IN_APP_EDIT_UNIONS.md](IN_APP_EDIT_UNIONS.md) (liên kết vợ/chồng).
- [AUDIT_LOG_UI.md](AUDIT_LOG_UI.md) (nhật ký), [INTEGRITY_GUARD.md](INTEGRITY_GUARD.md) (đối soát), [PROD_ROLLOUT.md](PROD_ROLLOUT.md) (phát hành prod), [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md) (nghiệm thu).
