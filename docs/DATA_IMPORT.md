# Chuyển dữ liệu gia phả từ file Word sang Excel (bản nháp rà soát)

Dữ liệu gia phả thật **không bao giờ** nằm trong repo. Mọi file dữ liệu ở `private-data/` (đã bị `.gitignore` chặn, kể cả `*.doc*`, `*.xls*`). Repo chỉ chứa script và test dùng dữ liệu giả.

## Quy trình
1. Đọc file Word và ghi vào file trung gian `private-data/gia-pha.txt` (định dạng bên dưới), từng chi một.
2. Chạy `npm run gia-pha:excel` (Node ≥ 24). Script kiểm tra dữ liệu rồi xuất `private-data/gia-pha-ban-nhap.xlsx` với các sheet `HUONG_DAN`, `PERSONS`, `RELATIONS`, `UNIONS`, `BRANCHES`, `ISSUES`.
3. Tài khoản quản trị rà soát sheet `ISSUES` trước (ERROR phải sửa, WARN cần xác nhận), rồi đối chiếu từng sheet với văn bản gốc.
4. Sau khi rà soát: nạp bằng `npm run gia-pha:import` (xem mục "Nạp vào Firestore"), thử trên emulator trước, rồi project `dev`; chỉ nạp `prod` sau khi có sao lưu đã kiểm chứng và được duyệt riêng.

Script từ chối đọc hoặc ghi ngoài `private-data/`. Exit code khác 0 khi còn ERROR.

## Định dạng file trung gian
Mỗi dòng một bản ghi, ngăn bởi `|`; dòng bắt đầu bằng `#` là chú thích.

| Dòng | Trường |
|---|---|
| `P` | `id|họ tên|sx|loại|đời|chi|thuộc tính|ghi chú` (từ "đời" trở đi có thể bỏ) |
| `K` | `idCha|idMẹ|idCon1[:A],idCon2,…` — `-` nếu không rõ, `:A` là con nuôi |
| `U` | `id1|id2|thứ tự|tình trạng|ghi chú` — vợ chồng không có con |
| `B` | `mã chi|tên chi|người khai chi|hợp nhất từ|ghi chú` |

- `sx`: `M`/`F` khi văn bản nêu rõ hoặc tên có dấu hiệu chắc chắn ("Thị" → F, "Văn"/"Đức" → M); `m`/`f` khi suy từ tên kém chắc chắn (bị cảnh báo `SEX_FROM_NAME`); `?` chưa rõ (tên trung tính).
- `loại`: `CLAN` (huyết thống dòng họ), `SPOUSE` (kết hôn vào), `EXTERNAL` (con của con gái, không thuộc dòng, ghi cơ bản).
- Thuộc tính: `b=sinh;d=mất;ky=kỵ nhật âm lịch;fl=MÃ+MÃ` (đều tùy chọn, giữ nguyên văn bản gốc, không tự đổi lịch). `fl` là cờ cần kiểm tra thủ công (hiện dùng `VERIFY`).
- `id` là mã ổn định (`external_ref`), chỉ gồm chữ, số, `_`, `-`; không đổi khi sửa tên.

## Quy tắc áp dụng khi dựng quan hệ
Theo `docs/APPROVED_DECISIONS.md` và `docs/BUSINESS_RULES.md`:
- Truyền dòng chỉ khi **cha thuộc dòng họ** và **con thuộc dòng họ** (kể cả con gái và con nuôi). Mẹ không truyền dòng.
- Con của con gái (cha là người ngoài dòng) không truyền dòng và là `EXTERNAL`.
- Đúng một thủy tổ: nhiều gốc truyền dòng chưa nối là ERROR (`MULTI_ROOT`).
- Đời được tính tự động từ thủy tổ; đời ghi trong văn bản chỉ để đối chiếu (`GEN_MISMATCH`).
- Không tự gộp người trùng tên: chỉ cảnh báo `DUP_NAME` khi trùng họ tên đúng dấu và cùng đời đã biết (không báo "Tuấn"/"Tuân", không báo người chưa có đời như người kết hôn vào).
- Kiểm tra thêm: chu trình, nhiều cha cùng loại, trùng quan hệ, mã chưa khai báo, người chưa nối.

## Nạp vào Firestore
`npm run gia-pha:import -- [--apply] [--replace] [--project <id>] [--confirm <id>]`
- Mặc định là chạy thử (không kết nối, không ghi), chỉ in số lượng tài liệu. Thêm `--apply` để ghi.
- Đích chỉ là **emulator loopback** (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`) hoặc project kết thúc bằng `-dev` (cần `GOOGLE_APPLICATION_CREDENTIALS` trỏ tới khóa service account **để ngoài repo** và `--confirm <project>`). Production bị từ chối.
- Idempotent: mã tài liệu xác định (mã trong file trung gian) và lô `importBatches/import-<sha256>`; chạy lại cùng dữ liệu thì không làm gì. Collection đã có dữ liệu khác thì dừng; `--replace` (emulator/dev) xóa các collection nạp rồi nạp lại.
- Từ chối khi dữ liệu còn ERROR.
- Phân tách riêng tư (quyết định 2026-11-11): `memberProfiles` chỉ có tên và năm sinh/mất; `persons` giữ giới tính, loại, chi, đời, ngày gốc, kỵ nhật; `personPrivate` giữ ghi chú. Rules hiện chỉ cho thành viên đọc `memberProfiles`. Ngày mâu thuẫn trong văn bản (ví dụ "1954/1955") giữ nguyên bản gốc, không tự chọn năm.
- Quan hệ dùng đúng mô hình của backend đề xuất (`relations`, `graphState/parentage`).
- `treeSnapshots/main`: một tài liệu (một lượt đọc) cho màn hình cây, chỉ chứa tên, năm sinh/mất, đời, chi và quan hệ (`data` là chuỗi JSON). Rules cho thành viên `get` đúng tài liệu này (không `list`, không ghi). Mỗi lần nạp lại phải dựng lại ảnh chụp; sau này backend phải cập nhật khi duyệt thay đổi.

### Việc còn lại sau bước này
- Luồng đề xuất (`PERSON_BASIC`) hiện ghi đè `memberProfiles` bằng projection 4 trường nên sẽ làm mất `birthYear`/`deathYear`; cần đổi sang merge trước khi dùng.
- Giới hạn 200 quan hệ trong luồng đề xuất (`assertGraphCanAdd`) nhỏ hơn dữ liệu đã nạp (~620); cần nâng và đo chi phí đọc trước khi mở luồng đề xuất.

## Cờ "Cần kiểm tra"
Dữ liệu thật vẫn được nạp đầy đủ; người chưa chắc chắn **vẫn nằm trong cây** và được gắn cờ (không bị ẩn). Cờ tính trong `scripts/gia-pha/flags.ts`:

| Mã | Nguồn | Ý nghĩa |
|---|---|---|
| `BIRTH_CONFLICT` | tự động (năm sinh/mất dạng `a/b`) | Tài liệu gốc ghi hai năm mâu thuẫn |
| `UNCONNECTED` | tự động (người dòng họ không nối được tới thủy tổ) | Chưa xác định vị trí trong cây |
| `DUP_NAME` | tự động (trùng họ tên đúng dấu, cùng đời) | Cần phân biệt |
| `NAME_UNKNOWN` | tự động (tên có "chưa rõ") | Chưa rõ tên |
| `VERIFY` | ghi chú chứa "CẦN XÁC MINH" hoặc `fl=VERIFY` | Tài liệu gốc chưa rõ |

Cờ nằm ở `persons.reviewFlags` và trong ảnh chụp cây (phần tử thứ 7 của mỗi người; bản cũ 6 phần tử vẫn đọc được). Giao diện: nhãn "Cần kiểm tra" trong cây/hồ sơ, hộp lý do ở hồ sơ và trang `Cần kiểm tra` gom theo lý do (không lộ ghi chú riêng). Excel nháp có cột `can_kiem_tra`. Làm sạch: sửa file nguồn (bỏ cờ/ghi chú) rồi nạp lại có sao lưu.

