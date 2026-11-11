# Chuyển dữ liệu gia phả từ file Word sang Excel (bản nháp rà soát)

Dữ liệu gia phả thật **không bao giờ** nằm trong repo. Mọi file dữ liệu ở `private-data/` (đã bị `.gitignore` chặn, kể cả `*.doc*`, `*.xls*`). Repo chỉ chứa script và test dùng dữ liệu giả.

## Quy trình
1. Đọc file Word và ghi vào file trung gian `private-data/gia-pha.txt` (định dạng bên dưới), từng chi một.
2. Chạy `npm run gia-pha:excel` (Node ≥ 24). Script kiểm tra dữ liệu rồi xuất `private-data/gia-pha-ban-nhap.xlsx` với các sheet `HUONG_DAN`, `PERSONS`, `RELATIONS`, `UNIONS`, `BRANCHES`, `ISSUES`.
3. Tài khoản quản trị rà soát sheet `ISSUES` trước (ERROR phải sửa, WARN cần xác nhận), rồi đối chiếu từng sheet với văn bản gốc.
4. Sau khi rà soát: nạp vào Firebase `dev` bằng script nạp (chạy thử `--dry-run` trước), kiểm tra, rồi mới nạp `prod` sau khi có sao lưu. (Script nạp là bước sau, chưa có.)

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
- Thuộc tính: `b=sinh;d=mất;ky=kỵ nhật âm lịch` (đều tùy chọn, giữ nguyên văn bản gốc, không tự đổi lịch).
- `id` là mã ổn định (`external_ref`), chỉ gồm chữ, số, `_`, `-`; không đổi khi sửa tên.

## Quy tắc áp dụng khi dựng quan hệ
Theo `docs/APPROVED_DECISIONS.md` và `docs/BUSINESS_RULES.md`:
- Truyền dòng chỉ khi **cha thuộc dòng họ** và **con thuộc dòng họ** (kể cả con gái và con nuôi). Mẹ không truyền dòng.
- Con của con gái (cha là người ngoài dòng) không truyền dòng và là `EXTERNAL`.
- Đúng một thủy tổ: nhiều gốc truyền dòng chưa nối là ERROR (`MULTI_ROOT`).
- Đời được tính tự động từ thủy tổ; đời ghi trong văn bản chỉ để đối chiếu (`GEN_MISMATCH`).
- Không tự gộp người trùng tên: chỉ cảnh báo `DUP_NAME` khi trùng họ tên đúng dấu và cùng đời đã biết (không báo "Tuấn"/"Tuân", không báo người chưa có đời như người kết hôn vào).
- Kiểm tra thêm: chu trình, nhiều cha cùng loại, trùng quan hệ, mã chưa khai báo, người chưa nối.
