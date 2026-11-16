# Đề xuất thêm thành viên của thành viên thường (chỉ Firestore rules, không Functions)

Trạng thái: PR1 (lõi, rules, test, tài liệu; chưa có giao diện). PR2 = giao diện thành viên, PR3 = giao diện quản trị viên. Rules **chưa deploy production**; người dùng tự deploy sau khi PR1 merge.

Yêu cầu gốc: thành viên gửi đề xuất thêm thành viên mới; ghi thành nhật ký; quản trị viên kiểm tra thông tin rồi duyệt để ghi vào DB.

**Khác với `docs/PROPOSALS.md`:** luồng đó (`changeRequests`, `functions/src/proposals.ts`, `src/Proposals.tsx`) cần Cloud Functions/Blaze và chỉ chạy trên emulator. Luồng này chạy hoàn toàn bằng Firestore rules trên gói Spark; không dùng và không đổi luồng kia.

## Phạm vi

- Chỉ **thêm người MỚI** gắn vào người đã có: `CHILD` (thêm con) hoặc `SPOUSE` (thêm vợ/chồng). Không có "nối người đã có", không sửa/xóa.
- Thành viên không bao giờ ghi vào dữ liệu chính (`persons`, `relations`, `unions`, `treeSnapshots`, `auditLogs`...). Họ chỉ ghi `memberProposals` và `proposalThrottle`.
- Người duyệt = **quản trị viên trong sổ** (`ledgerAdmin()`, mọi admin trong `accessControl/admins`), không dùng `canReviewChanges`. Quản trị viên **không duyệt đề xuất của chính mình**.
- Đề xuất giữ **vĩnh viễn** như nhật ký (không có delete, kể cả với admin).
- "Nguồn/căn cứ" (`source`, ≤ 300 ký tự) chỉ nằm trong đề xuất, không đưa vào hồ sơ chính thức.

## Dữ liệu: `memberProposals/{id}` (schemaVersion 1)

`id == newId`, dạng `p-[a-z0-9]{12}` (cùng dạng mã người do `newPersonId()` sinh). Chi tiết trường: `docs/DATABASE_SCHEMA.md`.

Trạng thái và chuyển trạng thái:

| Từ         | Sang                          | Ai                                     |
| ---------- | ----------------------------- | -------------------------------------- |
| PENDING    | APPROVED, REJECTED, NEEDS_INFO | quản trị viên trong sổ, khác tác giả  |
| NEEDS_INFO | APPROVED, REJECTED            | quản trị viên trong sổ, khác tác giả   |
| PENDING    | WITHDRAWN                     | tác giả                                |
| NEEDS_INFO | WITHDRAWN                     | tác giả                                |

APPROVED, REJECTED, WITHDRAWN là trạng thái cuối. Nhãn tiếng Việt (`statusLabel`): CHỜ DUYỆT, ĐÃ DUYỆT, TỪ CHỐI, CẦN BỔ SUNG, ĐÃ RÚT.

- **Nội dung đề xuất không bao giờ sửa** (rules chỉ cho đổi `status`, `updatedAt`, `withdrawnAt`, các trường `infoRequest*` và các trường quyết định cuối).
- **Hai nhóm trường tách biệt để không mất dấu vết kiểm toán:** yêu cầu bổ sung (PENDING → NEEDS_INFO) chỉ ghi `infoRequestedBy`, `infoRequestedAt`, `infoRequestReason` (bắt buộc 1–500 ký tự); quyết định cuối (REJECTED/APPROVED) chỉ ghi `decidedBy`, `decidedAt`, `decisionReason`, `appliedEditVersion` và **cấm đổi** `infoRequest*`. `decisionReason` bắt buộc 1–500 ký tự khi REJECTED, tùy chọn khi APPROVED; NEEDS_INFO không bao giờ ghi `decisionReason`/`decidedBy`. NEEDS_INFO → NEEDS_INFO bị chặn (hỏi lần hai: từ chối hoặc duyệt, tác giả có thể gửi lại).
- **Gửi lại** = tạo đề xuất MỚI có `resubmitOf` trỏ đề xuất cũ, trong cùng lô rút lại đề xuất cũ (WITHDRAWN). Không sửa đề xuất cũ.
- Quản trị viên khi duyệt có thể **sửa nội dung ghi vào bản chính thức** (`edits` trong `commitApproveProposal`) nhưng không đổi `anchorId`/`kind`/`newId`; đề xuất gốc vẫn giữ nguyên.

## Luồng

1. **Gửi** (`submitProposal`): một lô gồm `memberProposals/{id}` (PENDING) + `proposalThrottle/{uid}` [+ rút đề xuất cũ khi gửi lại].
2. **Rút** (`withdrawProposal`): tác giả, khi PENDING hoặc NEEDS_INFO.
3. **Từ chối / cần bổ sung** (`decideProposal`): quản trị viên, kèm lý do (cần bổ sung ghi vào `infoRequest*`, từ chối ghi vào `decision*`).
4. **Duyệt** (`commitApproveProposal`): một giao dịch gồm đọc đề xuất, `treeSnapshots/main`, `persons` → `applyAdd` (cùng mã dùng cho admin thêm trực tiếp; nhật ký có `after.proposalId`) → các lệnh ghi của `applyAdd` (người mới, `memberProfiles`, `personPrivate`, `relations`/`unions`, snapshot, `auditLogs/edit-{n}`) → cập nhật đề xuất thành APPROVED (`decidedBy`, `decidedAt`, `appliedEditVersion = n`, `decisionReason`?, `updatedAt`). Rules chỉ cho APPROVED khi các tài liệu kia nằm **trong cùng lô**.

Hàm thuần (không UI): `src/memberProposal.ts` (`buildProposal`, `proposalToAddOp`, `readProposal`, `canTransition`, `statusLabel`, `cleanReason`, hằng `MAX_PENDING = 5`); nối Firestore: `src/editClient.ts`; `src/auditView.ts` có `proposalIdOf` và dòng "Từ đề xuất #…" ở chi tiết nhật ký PERSON_ADDED/SPOUSE_ADDED.

## Rules (`firestore.rules`, khối "Member proposals")

- **Tạo** (`proposalCreateOk`): thành viên đang bật; khóa đúng danh sách cho phép; `schemaVersion 1`, `status PENDING`, `authorUid == auth.uid`, `createdAt == updatedAt == request.time`, `id == newId` dạng `p-[a-z0-9]{12}`, `anchorId` hợp lệ và khác `newId`, `source` 1–300 ký tự (client bỏ trường khi trống), `resubmitOf` dạng mã đề xuất; `payload` là map với **danh sách khóa cố định** (CHILD: name, sex, birthYear, deathYear, deceased, note, role, otherParentId, adoptive, category, branch; SPOUSE: name, sex, birthYear, deathYear, deceased, note, category, order); tên 1–120 ký tự không ký tự điều khiển (kể cả C1 U+0080–009F và ký tự ẩn/định hướng U+200B–200F, U+202A–202E, U+2066–2069); năm 1000–2200 hoặc null; ghi chú ≤ 2000 và nguồn ≤ 300, không ký tự điều khiển hay ký tự ẩn nói trên (trừ `\n` `\t`); họ ngoại (EXTERNAL) không có chi; `otherParentId` khác `anchorId`.
- **Rút** (`proposalWithdrawOk`): tác giả; chỉ đổi `status`/`updatedAt`/`withdrawnAt`.
- **Yêu cầu bổ sung** (`proposalInfoOk`): `ledgerAdmin()`, khác tác giả, chỉ từ PENDING; chỉ ghi `status`, `infoRequested*`, `infoRequestReason` (1–500), `updatedAt`.
- **Quyết định cuối** (`proposalDecideOk`): `ledgerAdmin()`, người duyệt khác tác giả, trạng thái hiện tại PENDING/NEEDS_INFO, `decidedBy == auth.uid`, thời gian = `request.time`, không đổi `infoRequest*`. REJECTED cần lý do 1–500; APPROVED cần `proposalApprovedInBatch`: `appliedEditVersion == nextEditVersion()`, snapshot sau lô có đúng phiên bản đó, nhật ký `edit-{n}` do chính người duyệt tạo với `createdPersonIds == [newId]` và `after.proposalId == newId`, `persons/{newId}` chưa có và sẽ có sau lô; CHILD: sự kiện `PERSON_ADDED`, `personId == newId`, tồn tại `relations/r-{anchorId}-{newId}`; SPOUSE: sự kiện `SPOUSE_ADDED`, `personId == anchorId`, `unionId` đúng dạng `u-{hai mã sắp xếp}` và union tồn tại. Phần còn lại của lô (tên, quan hệ, snapshot...) do các rule thêm người sẵn có (`createGate`, `relationCreateOk`, `unionCreateOk`, `snapshotUpdateOk`, `auditCreateOk`) kiểm như admin thêm trực tiếp.
- **Đọc:** `get` — tác giả hoặc `ledgerAdmin()`; `list` — `ledgerAdmin()` hoặc tác giả (truy vấn phải lọc `authorUid == uid`). Thành viên khác không đọc/liệt kê được. **Không delete.**
- **`proposalThrottle/{uid}`** (chống spam): chỉ chủ tài khoản tạo/sửa; khóa `lastAt`, `lastProposalId`, `schemaVersion`; `lastAt == request.time`; sửa phải cách lần trước **> 60 giây**. Rules tạo đề xuất đòi `getAfter(throttle).lastAt == request.time` **và `lastProposalId == id`** — nên một lần ghi throttle chỉ "mở khóa" đúng một đề xuất (nếu không, một lô có thể chứa hàng trăm đề xuất cùng một lần ghi throttle). Giới hạn 5 đề xuất chờ (`MAX_PENDING`) chỉ do giao diện (PR2) thực thi; rules không đếm được.

## Bảng đếm truy cập tài liệu (giới hạn 10 mỗi thao tác)

Ước lượng bảo thủ (mỗi tài liệu phân biệt tính một lần cho `get`/`exists`, `getAfter`/`existsAfter` tính riêng; Firestore có thể gộp nên số thật có thể thấp hơn).

| Thao tác                      | Tài liệu                                                                                                                             | Số |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -- |
| Tạo đề xuất                   | `users/{uid}` (member), `getAfter(proposalThrottle/{uid})`                                                                           | 2  |
| Ghi `proposalThrottle`        | `users/{uid}`, (update) chính tài liệu throttle                                                                                      | 1–2 |
| Rút                           | `users/{uid}`                                                                                                                        | 1  |
| Từ chối / cần bổ sung         | `users/{uid}`, `accessControl/admins`                                                                                                | 2  |
| Duyệt (APPROVED)              | `users/{uid}`, `accessControl/admins`, `treeSnapshots/main` (get), `getAfter(treeSnapshots/main)`, `getAfter(auditLogs/edit-n)`, `persons/{newId}` (exists), `existsAfter(persons/{newId})`, `existsAfter(relations/r-… hoặc unions/u-…)` | 8  |
| Đọc / liệt kê (tác giả)       | `users/{uid}`                                                                                                                        | 1  |
| Đọc / liệt kê (admin)         | `users/{uid}`, `accessControl/admins`                                                                                                | 2  |

Các lệnh ghi khác trong lô duyệt (persons, relations, snapshot, nhật ký...) được đánh giá riêng như khi admin thêm người trực tiếp (không đổi). Test emulator (`tests/memberProposalRules.test.ts`) chứng minh lô duyệt chạy được dưới giới hạn.

## Quyền riêng tư và bảo mật

- Đề xuất chứa dữ liệu cá nhân nên chỉ tác giả và quản trị viên trong sổ đọc được; không có trong ảnh chụp cây, bundle công khai, nhật ký chung hay analytics. Không `console.log` dữ liệu đề xuất.
- Tác giả đã thấy ghi chú/nguồn của chính họ; ghi chú chỉ vào `personPrivate` khi duyệt (quản trị viên đọc), như thêm người trực tiếp.
- Rules không đọc được nội dung ảnh chụp cây (JSON) — như mọi chỉnh sửa của admin, việc đổi JSON đúng là trách nhiệm của client tin cậy (`applyAdd`) và được giới hạn bởi quyền quản trị viên. Duyệt do **client quản trị viên** thực hiện (ngoại lệ có chủ ý của `SECURITY_RULES.md` mục 5); rules kiểm cả lô nên ngang mức quản trị viên thêm trực tiếp, không cao hơn.
- Không suy dòng cha từ họ/giới tính: vai trò FATHER/MOTHER do người đề xuất chọn rõ; quy tắc dòng họ (cha thuộc dòng họ và đã có đời) vẫn do `applyAdd` kiểm khi duyệt.

## Phương án hai bước dự phòng (CHƯA bật)

Hiện chỉ có cách duyệt cùng lô (không còn công tắc `APPROVE_MODE`: nhánh hai bước đã bị xóa vì là mã chết và không kiểm lại trạng thái). Nếu sau này cùng lô gặp trở ngại (ví dụ vượt giới hạn truy cập khi thêm nhiều quan hệ), có thể làm PR riêng cho phương án hai bước: ghi người trước (như admin thêm trực tiếp, nhật ký có `after.proposalId`), rồi đánh dấu APPROVED sau. **Rules hiện hành sẽ từ chối bước hai** (đòi cùng lô). Muốn dùng phải làm PR riêng thêm rule "đánh dấu sau" (kiểm `auditLogs/edit-{appliedEditVersion}` đã tồn tại, do chính người duyệt, `after.proposalId == id`, `persons/{newId}` đã tồn tại) và test; PR này cố ý không thêm rule chưa kiểm chứng. Rủi ro của hai bước: bước hai hỏng thì người đã vào cây nhưng đề xuất vẫn "chờ" — phải đối chiếu qua `after.proposalId` trong nhật ký.

## Giới hạn đã biết

- Không có thông báo cho tác giả; giao diện (PR2) tự đọc `memberProposals` của mình.
- Chống spam chỉ theo tần suất; không có hạn mức tổng. Quản trị viên có thể từ chối hàng loạt nếu bị làm phiền; vô hiệu hóa tài khoản qua quản lý tài khoản.
- `deathYear >= birthYear` được kiểm ở client (`buildProposal` và `applyAdd`), rules chỉ kiểm khoảng năm.
- **Việc cho PR3 (giao diện quản trị viên) và sau:**
  - Throttle chỉ giới hạn tần suất 60 giây, chưa có trần theo ngày: một tài khoản bị chiếm có thể tạo ~1.440 đề xuất/ngày (~2.880 lượt ghi kể cả throttle), đủ làm cạn hạn mức ghi Spark. Cân nhắc trần theo ngày (ví dụ đếm trong `proposalThrottle`) và tắt tài khoản khi bị lạm dụng.
  - Nhật ký `edit-{n}` có thể mang `after.proposalId` khi đề xuất chưa APPROVED (admin thêm người trực tiếp với mã trùng): giao diện chỉ hiện liên kết "Từ đề xuất" khi đề xuất ở trạng thái APPROVED và `appliedEditVersion == editVersion` của nhật ký.
  - `resubmitOf` không được rules kiểm chủ sở hữu/trạng thái: giao diện chỉ coi là "gửi lại" khi đề xuất cũ cùng `authorUid` và đã WITHDRAWN.
- Một người mới chỉ gắn một neo (`anchorId`); cha/mẹ còn lại (`otherParentId`) là tùy chọn khi thêm con, do quản trị viên đối chiếu khi duyệt.

## Rollback, migration

- Không migration: collection mới, không đụng dữ liệu cũ; schemaVersion 1.
- Rollback = deploy lại `firestore.rules` bản trước. Đề xuất đã tạo vẫn nằm trong DB (đóng, không ai đọc được khi rules cũ chạy) và dùng lại được khi deploy rules mới. Người đã được duyệt là chỉnh sửa bình thường có nhật ký (hoàn tác bằng chức năng ẩn/khôi phục).
- Deploy rules lên production: người dùng tự làm sau khi PR1 merge (không nằm trong PR này).

## Kiểm thử

- `tests/memberProposal.test.ts` (unit), `tests/memberProposalRules.test.ts` (emulator, thêm vào `npm run test:rules`), `tests/editAdd.test.ts` (proposalId), `tests/auditView.test.ts`.
