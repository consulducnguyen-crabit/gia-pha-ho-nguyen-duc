# Đề xuất thêm thành viên của thành viên thường (chỉ Firestore rules, không Functions)

Trạng thái: PR1 (lõi, rules, test, tài liệu) đã merge. PR2 = giao diện thành viên (mục "Giao diện thành viên" bên dưới). PR3 = giao diện quản trị viên (mục "Giao diện quản trị viên" bên dưới). Rules **chưa deploy production**; người dùng tự deploy sau khi PR1 merge.

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

## Giao diện thành viên (PR2)

**Chỉ merge PR giao diện sau khi rules production đã deploy, nếu không nút hiện nhưng gửi bị permission-denied.**

- **Ai thấy:** chỉ thành viên thường (`canManageMembership == false`). Quản trị viên đã có nút thêm trực tiếp nên không có nút đề xuất và không có mục menu; vào `#/my-proposals` thì chuyển về Tổng quan (tránh đề xuất kẹt vì admin không tự duyệt được).
- **Gửi:** hồ sơ một người (`#/person/:id`) có "Đề xuất thêm con" / "Đề xuất thêm vợ/chồng" (`PersonPropose` trong `src/PersonAdd.tsx`; mở sẵn bằng `?propose=child|spouse`, thêm `&resubmit=<mã>` để điền sẵn khi gửi lại). Dùng lại đúng thân biểu mẫu của quản trị viên (`ChildPanel`/`SpousePanel` với `propose`): cùng nhãn và cảnh báo ghi chú ("mọi thành viên đã đăng nhập đều xem được", vì ghi chú sau khi duyệt hiện cho mọi thành viên), cùng kiểm tra `buildChildOp`/`buildSpouseOp` qua `buildProposal`. Khác: không có "người đã có trong cây" (chỉ người mới), có ô "Nguồn/căn cứ (không bắt buộc, ≤ 300 ký tự; chỉ tác giả và quản trị viên xem)", nút "Gửi đề xuất". Mã người mới do app sinh (`newPersonId`).
- **Giới hạn ở giao diện:** tối đa `MAX_PENDING` = 5 đề xuất CHỜ DUYỆT (đếm bằng truy vấn `authorUid == uid` + `status == PENDING`, không cần index ghép; khi đủ thì khóa nút gửi và nhắc rút bớt). Cách nhau 60 giây: sau lần gửi thành công trong phiên, nút gửi khóa 60 giây với đếm ngược (đồng hồ máy so với chính nó nên không lệch giờ máy chủ); lần gửi từ phiên trước chỉ là nhắc (`proposalThrottle/{uid}.lastAt`), nếu gửi mà rules từ chối thì hiện câu thân thiện ("cách nhau ít nhất 60 giây..."). Rules vẫn là chốt chặn thật cho 60 giây; 5 đề xuất chỉ do giao diện (người dùng kỹ thuật vẫn có thể vượt qua bằng cách gọi trực tiếp; quản trị viên xử lý bằng từ chối hàng loạt).
- **Đề xuất của tôi** (`#/my-proposals`, `src/MyProposals.tsx`, khác với `/changes` của luồng emulator-only): danh sách sắp mới nhất trước ở phía client (truy vấn `limit(50)` không có `orderBy` nên chỉ lấy tối đa 50 đề xuất, thứ tự tải không bảo đảm; truy vấn lấy 51 để biết có hơn 50 hay không; khi có hơn 50 giao diện báo "Chỉ hiển thị 50 đề xuất; các đề xuất cũ hơn có thể không hiện"; không thêm index ghép), loại + tên người đề xuất, người được gắn, trạng thái bằng chữ (CHỜ DUYỆT, ĐÃ DUYỆT, TỪ CHỐI, CẦN BỔ SUNG, ĐÃ RÚT; màu chỉ nhấn thêm), giờ Việt Nam, nguồn, lý do khi CẦN BỔ SUNG (`infoRequestReason`) hoặc TỪ CHỐI (`decisionReason`), số chờ "n/5", lời nhắc chưa có thông báo đẩy. "Rút lại" (PENDING/NEEDS_INFO, có bước xác nhận) và "Gửi lại (điền sẵn)" (NEEDS_INFO/REJECTED). Không hiện tên/uid người duyệt.
- **Gửi lại:** tạo đề xuất MỚI có `resubmitOf`. Từ CẦN BỔ SUNG: cùng lô rút đề xuất cũ (WITHDRAWN) như thiết kế. Từ TỪ CHỐI: đề xuất cũ đã ở trạng thái cuối nên KHÔNG rút được; `submitProposal` có tùy chọn `withdrawPrevious: false` (mặc định giữ hành vi PR1) và đề xuất mới chỉ ghi `resubmitOf`. Giao diện quản trị viên (PR3) nên coi `resubmitOf` là gửi lại khi đề xuất cũ cùng tác giả và ở trạng thái WITHDRAWN **hoặc REJECTED**.
- **Chi phí đọc:** xem hồ sơ KHÔNG truy vấn `memberProposals`; chỉ khi mở biểu mẫu đề xuất (hoặc URL có `?propose=`) mới tải danh sách (tối đa 50 + tối đa 6 + 1 lượt đọc throttle). Kịch bản trình duyệt đếm yêu cầu tới emulator để giữ điều này.
- **Lỗi do quản trị viên xử lý trước:** rút lại bị rules chặn (đề xuất vừa bị từ chối/duyệt) thì báo "đề xuất có thể đã được quản trị viên xử lý" và tải lại danh sách (`withdrawErrorMessage`); gửi lại bị chặn thì báo kiểm tra đề xuất cũ và tải lại dữ liệu mà không đóng biểu mẫu. "Gửi lại" mà không còn đề xuất gốc hợp lệ (đã xử lý hoặc không có trong 50 đề xuất tải được) thì báo rõ, biểu mẫu để trống. Điền sẵn mà cha/mẹ còn lại không còn là vợ/chồng hiện tại thì nhắc chọn lại.
- **Đọc dữ liệu:** `loadMyProposals` (`src/editClient.ts`) đọc từ máy chủ; hàm thuần ở `src/proposalView.ts` (`tests/proposalView.test.ts`). Không `console.log` dữ liệu đề xuất.
- **Kiểm thử trình duyệt:** `npm run test:browser:member-proposal` (`scripts/member-proposal-browser-check.mjs`, dữ liệu giả): quyền hiển thị (thành viên thấy, quản trị viên không), gửi kèm nguồn, đề xuất không ghi vào dữ liệu chính, khóa 60 giây, từ chối của máy chủ hiện câu thân thiện, rút lại có xác nhận, thành viên khác không thấy, đủ 5 chờ duyệt thì khóa, gửi lại từ CẦN BỔ SUNG và TỪ CHỐI, không tràn ngang 360/768/1280.

## Giao diện quản trị viên (PR3)

- **Menu và route:** mục "Đề xuất chờ duyệt (n)" (`#/member-proposals`, `src/MemberProposalsAdmin.tsx`) chỉ khi `canManageMembership` đã xác nhận từ máy chủ; thành viên thường bị chuyển về Tổng quan. Khác "Hộp duyệt" (`/review`) và "Đề xuất thay đổi" (`/changes`) của luồng emulator-only. Số `n` = số đề xuất CHỜ DUYỆT, lấy bằng một truy vấn đếm (`getCountFromServer`, 1 lượt đọc tính phí/1000 mục) khi admin vào và sau mỗi quyết định; **không** `onSnapshot`. Lỗi (rules chưa deploy, sổ admin lệch, mạng) thì ẩn số, menu vẫn dùng được. Hệ quả cho kiểm thử: người dùng giả có `canManageMembership` mà thiếu `accessControl/admins` gây 403 ở truy vấn đếm; `audit-browser-check` nay seed sổ admin.
- **Danh sách:** "Đang chờ xử lý" (CHỜ DUYỆT + CẦN BỔ SUNG; `status in [...]` limit 100, sắp cũ nhất trước ở client, không index ghép) và "Đã xử lý" (chọn một trạng thái ĐÃ DUYỆT/TỪ CHỐI/ĐÃ RÚT, `status ==` limit 30; chỉ tải khi mở tab; không bảo đảm là 30 mục mới nhất vì không có `orderBy`). Mỗi mục: loại, tên và năm, người được gắn (tra từ ảnh chụp cây), trạng thái bằng chữ, giờ Việt Nam, người gửi (`get users/{uid}`: tên/email, "(đã thu hồi)" khi tắt, "tài khoản đã thu hồi" khi không có hồ sơ), nguồn, lý do. Đề xuất giữ nguyên nội dung gốc nên tên ở danh sách là tên người gửi đề xuất, kể cả khi admin sửa tên lúc duyệt.
- **Chi tiết/duyệt (`src/ProposalReview.tsx`):** biểu mẫu điền sẵn; admin sửa được tên, giới tính, năm, đã mất, ghi chú (nhãn nhắc "mọi thành viên đã đăng nhập đều xem được"), vai trò cha/mẹ, cha/mẹ còn lại, con nuôi, loại, chi/thứ tự; không đổi được người được gắn hay loại đề xuất. Duyệt = `buildProposal` (kiểm như thêm trực tiếp) rồi `commitApproveProposal` với `edits` (một giao dịch, `applyAdd` kiểm lại). Từ chối/Cần bổ sung = `decideProposal`, lý do 1–500 ký tự bắt buộc (lỗi đưa focus vào ô lý do), cảnh báo "người gửi đọc được"; Từ chối có bước xác nhận; Cần bổ sung ẩn khi đã ở CẦN BỔ SUNG. Đề xuất do chính admin gửi: không có nút, có giải thích (rules cấm tự duyệt). Ô lý do chung ghi `decisionReason`/`infoRequestReason`; khi Duyệt là tùy chọn.
- **Cây chưa tải xong:** biểu mẫu duyệt chỉ được khởi tạo khi ĐÃ có ảnh chụp cây (cần danh sách vợ/chồng hiện tại để giữ "cha/mẹ còn lại"); trong lúc chờ chỉ hiện "Đang tải cây gia phả…" (lỗi thì có nút Thử lại), không có nút duyệt/từ chối. Chốt an toàn: đề xuất có cha/mẹ còn lại mà ô đang "Không ghi" thì Duyệt phải qua bước xác nhận "Vẫn duyệt, không ghi cha/mẹ còn lại" (`droppedOtherParent`), không bỏ âm thầm. Hệ quả: khi cây không tải được thì cũng không Từ chối/Cần bổ sung được ở chi tiết (hãy Thử lại).
- **Lỗi:** `decisionErrorMessage` (`src/proposalAdmin.ts`): xung đột phiên bản (tải lại, giữ nội dung đang sửa), đã xử lý, người gốc bị ẩn (Duyệt bị khóa sau khi tải lại cây), mã người mới trùng, cha không còn đủ điều kiện truyền dòng (gợi ý đổi Họ ngoại hoặc Từ chối), quyền, mạng. Mọi lỗi nói rõ chưa ghi gì. Sau quyết định tải lại danh sách, cây và số đếm.
- **Cảnh báo trùng (không chặn):** con (hoặc vợ/chồng) hiện có của người gốc có tên gần giống (bỏ dấu, hoa/thường; trùng hoặc tên ngắn từ 2 từ nằm trọn trong tên dài) và các đề xuất đang mở khác cùng người gốc.
- **Gửi lại:** "Gửi lại của đề xuất #… (ĐÃ RÚT/TỪ CHỐI)" chỉ hiện khi đề xuất cũ (đọc bằng get) cùng `authorUid` và ở WITHDRAWN/REJECTED (rules không kiểm `resubmitOf`). Ghi nhận: PR2 cho gửi lại từ NEEDS_INFO (rút đề xuất cũ) và từ REJECTED (giữ nguyên bản cũ).
- **Nhật ký:** `#/audit` chỉ hiện liên kết "Từ đề xuất #… (đã xác minh)" khi mở chi tiết và `memberProposals/{id}` có `status == APPROVED` và `appliedEditVersion` bằng đúng phiên bản nhật ký (`proposalMatchesAudit`); không khớp thì ghi "chưa xác minh", không liên kết (chống `after.proposalId` giả). Mỗi cặp bản ghi/đề xuất đọc một lần, lười. Liên kết dẫn tới `#/member-proposals?id=…`.
- **Giới hạn:** hàng đợi tối đa 100; lịch sử 30/trạng thái; số đếm ở menu chỉ cập nhật khi vào trang/sau quyết định; đếm CHỜ DUYỆT không gồm CẦN BỔ SUNG; chưa có trần theo ngày (xem mục Giới hạn đã biết).
- **Vận hành cho admin:** mở "Đề xuất chờ duyệt", mở từng đề xuất, đối chiếu cảnh báo trùng và nguồn, sửa nếu cần, rồi Duyệt (người mới vào cây, có nhật ký) hoặc Từ chối/Cần bổ sung kèm lý do (người gửi xem ở "Đề xuất của tôi"). Nghi lạm dụng: từ chối từng đề xuất và vô hiệu hóa tài khoản ở "Quản lý tài khoản". Deploy rules lên production TRƯỚC khi dùng giao diện này.
- **Nợ PR2 đã xử lý:** rút lỗi đưa focus vào thông báo; gửi lại mà đề xuất gốc không còn hợp lệ thì khóa nút gửi (đóng biểu mẫu thì bỏ liên kết gửi lại); `limit(51)` rồi cắt 50.
- **Kiểm thử:** `tests/proposalAdmin.test.ts`; `npm run test:browser:member-proposal-admin` (`scripts/member-proposal-admin-browser-check.mjs`, hai vai).

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
