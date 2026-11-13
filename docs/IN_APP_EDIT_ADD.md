# Thêm con và thêm vợ/chồng trong app (PR C1)

Chỉ **thêm**, không ghi đè quan hệ đã có (đổi cha mẹ, con nuôi, xóa mềm thuộc PR C2).
Trang hồ sơ của quản trị viên có hai nút: **Thêm con** và **Thêm vợ/chồng**.

## Quy tắc nghiệp vụ (src/editAdd.ts, hàm thuần `applyAdd`)

- Mã người mới do app sinh ngẫu nhiên (`p-` + 12 ký tự), phải chưa tồn tại.
- Thêm con: cần ít nhất cha hoặc mẹ; vai trò cha/mẹ do người dùng chọn rõ, KHÔNG suy từ giới tính.
  Từ chối nếu người làm cha đang ghi giới tính nữ hoặc người làm mẹ ghi nam.
- Chỉ người có **cha thuộc dòng họ và đã nối tới thủy tổ (có đời)** mới được ghi "Thuộc dòng họ" (một thủy tổ duy nhất, không tạo gốc mới).
  Con của mẹ (cha ngoài dòng họ) là "Họ ngoại": không truyền dòng, không có đời.
- `lineageTransmission` = quan hệ với cha và con thuộc dòng họ (kể cả con nuôi). Đời = đời cha + 1 (suy ra,
  ghi trong snapshot; `persons.generation` chỉ là giá trị lịch sử).
- Thêm vợ/chồng: người mới (Kết hôn vào / Họ ngoại) hoặc nối với người đã có; từ chối tự cưới và trùng quan hệ.
- Ghi chú nằm đầy đủ ở `personPrivate`; ảnh chụp cây giữ bản cắt 300 ký tự cho mọi thành viên (quyết định 2026-11-14); nhật ký chỉ lưu độ dài ghi chú.

## Lô ghi nguyên tử và rules

| Sự kiện        | Tài liệu trong cùng lô                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `PERSON_ADDED` | persons, memberProfiles (+ personPrivate), 1–2 relations, treeSnapshots/main, auditLogs/edit-{n}      |
| `SPOUSE_ADDED` | unions (+ persons/memberProfiles/personPrivate của người mới), treeSnapshots/main, auditLogs/edit-{n} |

Nhật ký liệt kê `createdPersonIds`, `relationIds`, `unionId`; rules chỉ cho tạo đúng các tài liệu đó (người mới
phải chưa tồn tại, mã chỉ gồm chữ/số/_/-, loại và kiểu dữ liệu đúng, `lineageTransmission` đúng chính sách,
union đúng id chuẩn `u-{a}-{b}` và hai người tồn tại), đúng trường (allowlist), `createdAt == request.time`, `sourceRefs` trỏ nhật ký. Snapshot chỉ cập nhật được khi người
mới/quan hệ đầu tiên/union được tạo thật trong lô (chặn "thêm" người đã có hoặc quan hệ có sẵn).

## Giới hạn đã biết

- Rules không kiểm hai quan hệ của một lô có hai vai trò khác nhau (cha/mẹ) và chỉ kiểm quan hệ đầu tiên
  là MỚI và trỏ đúng người con; script đối soát (PR D) phải bắt trường hợp thừa/thiếu.

- Rules chỉ kiểm quan hệ đầu tiên (`relationIds[0]`) có trong lô, không kiểm quan hệ thứ hai và không kiểm
  nội dung JSON snapshot (giới hạn số lần truy cập tài liệu của rules); cần script đối soát (PR D).
- Chưa thử giới hạn truy cập tài liệu của rules trên Firestore thật (chỉ emulator); thử trên dev trước khi
  deploy prod.
- Chưa có: đổi cha mẹ, đổi loại con nuôi/ruột, xóa/ẩn người (PR C2); quan hệ cha/mẹ thứ hai cho người đã có.
- `graphState/parentage` (khóa của luồng đề xuất emulator-only) không được tăng bởi sửa trong app.

## Kiểm thử

`tests/editAdd.test.ts`, `tests/addForm.test.ts`, `tests/editRules.test.ts` (nhóm "thêm con / vợ chồng"),
`scripts/edit-browser-check.mjs` (thêm vợ/chồng rồi thêm con, điều hướng, nhật ký, không tràn ngang).
