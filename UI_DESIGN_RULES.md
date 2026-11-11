# UI_DESIGN_RULES.md

> **Mức độ:** BẮT BUỘC — áp dụng cho mọi công việc tạo mới, chỉnh sửa, tái cấu trúc giao diện web.
>
> **Đối tượng:** Claude Code, Codex, Cursor và mọi AI Coding Agent tham gia dự án.
>
> **Mục tiêu:** Giao diện phải có chủ đích, nhất quán, phù hợp nghiệp vụ và thương hiệu; không rập khuôn theo các mẫu giao diện AI sinh tự động. Không có quy tắc hình thức nào bảo đảm tuyệt đối rằng người xem không nhận ra sản phẩm có dùng AI.

## 1. Thứ tự ưu tiên bắt buộc

1. Yêu cầu nghiệp vụ, khả năng sử dụng, tính đúng đắn và khả năng truy cập.
2. Design system và quy ước đã được duyệt trong dự án.
3. Tính nhất quán với giao diện hiện hữu.
4. Hiệu năng, responsive, khả năng bảo trì và an toàn.
5. Thẩm mỹ có bản sắc, tiết chế và phù hợp ngữ cảnh.

**Không được** áp dụng quy tắc thẩm mỹ trong tài liệu này nếu làm hỏng chức năng, accessibility hoặc yêu cầu thiết kế cụ thể đã được người dùng phê duyệt. Nếu có xung đột, nêu rõ và xin quyết định trước khi thay đổi lớn.

## 2. Quy trình bắt buộc trước khi viết code

- Kiểm tra cấu trúc dự án, framework, layout, CSS tokens, font, icon, component, bảng, form, menu và các trang liên quan.
- Xác định trang đang phục vụ ai, ba tác vụ chính, mật độ dữ liệu, thiết bị sử dụng và trạng thái quan trọng.
- Tái sử dụng component, CSS variables và pattern sẵn có trước khi tạo mới.
- Không tự ý đổi framework, thêm UI library, thay font, đổi bảng màu hay tái thiết kế toàn bộ nếu yêu cầu chỉ là sửa cục bộ.
- Với trang mới hoặc thay đổi lớn, lập kế hoạch ngắn: cấu trúc trang, hệ phân cấp, layout, tokens, trạng thái, responsive và kiểm thử. Nếu chưa có design system, đề xuất một hệ tối thiểu và ghi nhận trong dự án.
- Nếu thiếu thông tin quan trọng ảnh hưởng đến nghiệp vụ hoặc hướng thiết kế, hỏi thay vì tự suy đoán.

## 3. Những dấu hiệu giao diện AI rập khuôn cần tránh

**Mặc định không sử dụng**, trừ khi có lý do thiết kế cụ thể hoặc nằm trong design system đã duyệt:

- Gradient tím–xanh, neon, glassmorphism, hiệu ứng phát sáng và nền blur trang trí.
- Hero quá lớn với slogan chung chung, nhãn pill “AI-powered”, các hình khối trừu tượng không liên quan nội dung.
- Dashboard gồm hàng loạt thẻ KPI cùng kích thước, cùng cấu trúc, cùng màu và không có thứ bậc thông tin.
- Bo góc quá lớn ở mọi thành phần, shadow dày, viền mờ và nhiều lớp card lồng card.
- Icon cho mọi tiêu đề, mọi nhãn, mọi dòng bảng; emoji dùng làm icon giao diện nghiệp vụ.
- Quá nhiều màu nhấn, nút gradient, hiệu ứng hover phóng to và animation chỉ để gây chú ý.
- Khoảng trắng quá mức khiến bảng/form phải cuộn không cần thiết; hoặc mật độ dày đặc làm mất khả năng đọc.
- Nội dung mẫu sáo rỗng như “Unlock your potential”, “Seamless experience”, “Welcome back” khi không phục vụ tác vụ thực tế.
- Mọi trang đều dùng cùng một mẫu sidebar + topbar + bốn KPI + biểu đồ + bảng bất kể nghiệp vụ.

**Lưu ý:** Không cấm tuyệt đối card, gradient, shadow, sidebar hoặc biểu đồ. Chỉ dùng khi chúng thực sự giải quyết nhu cầu phân cấp, điều hướng hoặc trực quan hóa dữ liệu.

## 4. Nguyên tắc tạo bản sắc thiết kế

- Mỗi màn hình phải có **một trọng tâm chính**: thông tin hoặc hành động quan trọng nhất được ưu tiên thị giác.
- Bố cục xuất phát từ nội dung và quy trình nghiệp vụ, không xuất phát từ template có sẵn.
- Tạo nhịp điệu bằng tỷ lệ cột, typography, đường phân cách, alignment và khoảng trắng có kiểm soát; không dựa vào hiệu ứng trang trí.
- Ưu tiên đường nét gọn, màu trung tính, một màu nhấn có ý nghĩa và chi tiết nhận diện nhất quán.
- Hệ thống quản trị ưu tiên độ rõ ràng, tốc độ thao tác và mật độ thông tin hợp lý hơn hiệu ứng marketing.
- Không sao chép nguyên xi giao diện, hình ảnh hoặc nhận diện thương hiệu của sản phẩm khác.

## 5. Design tokens bắt buộc

Định nghĩa hoặc tái sử dụng tokens tập trung. Không rải giá trị tùy ý trong nhiều file.

```css
:root {
  /* Giá trị minh họa: thay bằng tokens hiện hữu/được duyệt. */
  --color-bg: #f7f8f6;
  --color-surface: #ffffff;
  --color-text: #1e2923;
  --color-text-muted: #5e6b63;
  --color-border: #d9e0da;
  --color-primary: #397653;
  --color-primary-hover: #2b6042;
  --color-focus: #246aaf;
  --color-danger: #b42318;
  --color-warning: #946200;
  --color-success: #26734d;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --border-width: 1px;
  --control-height: 36px;
  --focus-ring: 0 0 0 3px rgb(36 106 175 / 25%);
}
```

- Màu có vai trò rõ ràng: nền, bề mặt, chữ, đường viền, tương tác, thành công, cảnh báo, lỗi.
- Không tự ý chọn màu theo cảm tính cho từng component. Không dùng màu làm phương tiện truyền đạt trạng thái duy nhất.
- Thang spacing và radius phải hữu hạn, nhất quán. Ngoại lệ cần lý do.
- Không hardcode nhiều biến thể của cùng một màu khi đã có token.
- Với Tailwind: ánh xạ tokens vào theme/config hoặc CSS variables; hạn chế arbitrary values tràn lan.
- Với Bootstrap: override qua biến/theme ở một nơi; tránh `!important` và CSS chồng lớp không kiểm soát.

## 6. Typography và tiếng Việt

- Dùng tối đa **hai họ font** nếu không có yêu cầu khác; ưu tiên font đang có của dự án, hỗ trợ đầy đủ dấu tiếng Việt.
- Quy định rõ cấp chữ: tiêu đề trang, tiêu đề nhóm, nội dung, nhãn, chú thích, số liệu.
- Tránh viết HOA toàn bộ cho đoạn dài; tránh quá nhiều độ đậm khác nhau.
- Chiều cao dòng đủ đọc; căn trái nội dung văn bản tiếng Việt; số liệu có thể căn phải và dùng `font-variant-numeric: tabular-nums`.
- Nhãn nút phải là hành động cụ thể: “Lưu thay đổi”, “Xuất Excel”, “Xác nhận điều chuyển”; không lạm dụng “Submit”, “OK”, “Action”.
- Dùng định dạng ngày giờ phù hợp ngữ cảnh Việt Nam, ví dụ `10/11/2026 14:30`; thống nhất dấu phân tách số, đơn vị và tiền tệ.
- Không tự tạo nội dung giả có vẻ là dữ liệu thật. Dữ liệu demo phải được đánh dấu rõ.

## 7. Layout và responsive

- Thiết kế theo nội dung thực tế, bao gồm nhãn dài, bảng nhiều cột, dữ liệu trống và thông báo lỗi.
- Không ép mọi nội dung vào card. Dùng section, toolbar, table, panel, tabs và divider theo chức năng.
- Desktop: ưu tiên vùng làm việc hữu dụng; không cố định chiều rộng hẹp gây lãng phí màn hình.
- Tablet/mobile: xác định thành phần nào xếp lại, thu gọn, cuộn ngang hoặc chuyển sang chế độ xem khác.
- Bảng dữ liệu nhiều cột có thể cuộn ngang trong vùng bảng; không tự ý ẩn các cột quan trọng hoặc biến bảng thành card làm mất khả năng so sánh.
- Không để overflow ngang toàn trang ngoài ý muốn, nút bị che, modal vượt màn hình hay thanh thao tác khó tiếp cận.
- Không cố định breakpoint tùy tiện; kiểm thử ít nhất 360px, 768px, 1280px và chiều rộng thực tế của ứng dụng.

## 8. Bảng dữ liệu và giao diện quản trị

- Ưu tiên bảng rõ ràng, header dễ phân biệt, căn lề nhất quán, chiều cao dòng hợp lý, đường phân cách tiết chế.
- Văn bản căn trái; số, tiền và đại lượng căn phải; trạng thái có cả nhãn chữ.
- Hỗ trợ sort/filter/search/pagination khi nghiệp vụ cần; phân biệt thao tác trên toàn bộ dữ liệu với dữ liệu đang lọc.
- Không tự đổi STT nghiệp vụ khi sắp xếp hoặc lọc nếu STT là mã thứ tự cố định.
- Hành động hàng phải dễ tìm nhưng không lấn át dữ liệu. Thao tác xóa, ghi đè, chốt hoặc chuyển trạng thái quan trọng phải có xác nhận phù hợp.
- Có trạng thái loading, empty, no-results, error, success và permission-denied khi áp dụng.
- Tránh nhồi các badge nhiều màu vào mọi ô. Chỉ dùng màu để giúp nhận biết trạng thái thật sự.

## 9. Biểu mẫu và thao tác

- Nhãn trường luôn rõ nghĩa; trường bắt buộc được đánh dấu nhất quán.
- Nhóm trường theo logic nghiệp vụ; dùng độ rộng tương xứng với dữ liệu nhập, không mặc định mọi input full-width.
- Hiển thị lỗi gần trường liên quan, mô tả cách sửa; giữ dữ liệu đã nhập khi validation thất bại.
- Phân biệt primary/secondary/destructive actions. Mỗi vùng thao tác chỉ nên có một hành động chính rõ ràng.
- Không đặt nút nguy hiểm cạnh nút chính mà không có khoảng cách hoặc phân biệt phù hợp.
- Modal chỉ dùng khi cần quyết định, xác nhận hoặc tác vụ ngắn; không biến mọi biểu mẫu dài thành modal.
- Với tác vụ kéo-thả, phải có phương án thao tác thay thế qua bàn phím hoặc menu/nút.

## 10. Accessibility là điều kiện nghiệm thu

- Mục tiêu tối thiểu WCAG 2.2 AA cho các phần được tạo/sửa trong phạm vi khả thi.
- Tương phản chữ thường tối thiểu 4.5:1, chữ lớn tối thiểu 3:1; thành phần UI và trạng thái focus cần tương phản phù hợp.
- Hỗ trợ bàn phím, thứ tự focus hợp lý, focus nhìn thấy rõ, nhãn form liên kết đúng, tên truy cập cho icon-only buttons.
- Dùng HTML semantic (`button`, `label`, `table`, `nav`, `main`, heading...) trước khi thêm ARIA.
- Không dùng `div` có `onClick` thay nút khi có thể dùng `button`.
- Animation phải tôn trọng `prefers-reduced-motion`; không nhấp nháy gây khó chịu.
- Thông báo lỗi/trạng thái quan trọng phải được công bố phù hợp cho công nghệ hỗ trợ.

## 11. Motion, icon, hình ảnh

- Animation chỉ dùng để phản hồi tương tác, thể hiện chuyển trạng thái hoặc định hướng chú ý; thời lượng ngắn, nhất quán.
- Không dùng hiệu ứng bay vào hàng loạt, parallax hoặc chuyển động liên tục trong giao diện quản trị nếu không có yêu cầu.
- Dùng một bộ icon thống nhất; ưu tiên icon có ý nghĩa thao tác. Icon không thay thế nhãn khi có nguy cơ khó hiểu.
- Không chèn hình minh họa stock/AI chỉ để lấp khoảng trống. Hình ảnh phải mang thông tin hoặc giá trị nhận diện cụ thể.

## 12. Quy tắc code và tích hợp

- Không sửa logic nghiệp vụ, API contract, phân quyền, dữ liệu hoặc cấu trúc DB chỉ để đạt mục tiêu thẩm mỹ.
- Component phải có trách nhiệm rõ, tránh lặp markup/CSS; tên class, biến và component phản ánh chức năng.
- Không tạo thêm thư viện UI hoặc dependency nếu có thể giải quyết bằng stack hiện hữu một cách hợp lý.
- Không dùng inline styles hàng loạt; không dùng `!important` như giải pháp mặc định; không lạm dụng selector specificity.
- Không xóa hoặc ghi đè CSS global mà chưa kiểm tra các trang sử dụng chung.
- Với Flask/Jinja2: giữ nguyên luồng template inheritance, route, `url_for`, CSRF và escaping; không nhúng dữ liệu không tin cậy trực tiếp vào HTML/JS.
- Với JavaScript/TypeScript: quản lý trạng thái và event rõ ràng; tránh handler trùng, thao tác DOM mong manh, lỗi race condition.
- Với Tailwind/Bootstrap: tuân theo cách tổ chức hiện hữu; không trộn nhiều hệ thống component một cách tùy tiện.
- Không thay đổi hàng loạt file không liên quan. Mọi thay đổi lớn cần nêu phạm vi và lý do.

## 13. Chống “thiết kế theo thói quen AI”

Trước khi chốt giao diện, Agent phải tự trả lời:

1. Bố cục này có xuất phát từ nhu cầu người dùng hay chỉ là template quen thuộc?
2. Nếu bỏ gradient, shadow và icon trang trí, phân cấp thông tin còn rõ không?
3. Có quá nhiều card, badge, pill, khoảng trắng hoặc tiêu đề chung chung không?
4. Màu sắc, font, radius, spacing có nhất quán với hệ thống hiện hữu không?
5. Người dùng có thể hoàn thành tác vụ chính nhanh hơn so với trước không?
6. Bảng và biểu mẫu có hiển thị tốt với dữ liệu thực tế dài/phức tạp không?
7. Giao diện có hoạt động tốt bằng bàn phím và trên màn hình nhỏ không?
8. Có thay đổi nào chỉ để “trông hiện đại” nhưng không có giá trị sử dụng không?

Nếu có vấn đề, sửa trước khi bàn giao.

## 14. Kiểm thử và nghiệm thu bắt buộc

**Không được tuyên bố đã kiểm thử nếu chưa thực sự chạy kiểm thử.**

- Kiểm tra build/lint/typecheck/test hiện có nếu môi trường cho phép.
- Kiểm tra trực quan trên các kích thước màn hình mục tiêu; nếu có browser automation/screenshot, đối chiếu trước–sau.
- Kiểm tra trạng thái: bình thường, loading, trống, lỗi, không có kết quả, disabled, hover, focus, validation.
- Kiểm tra dữ liệu dài, tiếng Việt có dấu, số lớn, bảng nhiều dòng/cột và thao tác bằng bàn phím.
- Kiểm tra không làm hỏng các trang/component dùng chung.
- Kiểm tra console errors, overflow, mất focus, contrast và responsive.
- Khi không thể chạy trình duyệt hoặc test, ghi rõ **“Chưa kiểm chứng trực quan”** và liệt kê các bước cần người dùng kiểm tra; không tự đánh dấu đạt.

### Checklist hoàn thành

- [ ] Đã đọc và tái sử dụng design system/component hiện hữu.
- [ ] Bố cục phù hợp tác vụ, không rập khuôn template AI.
- [ ] Typography, màu, spacing, radius và icon nhất quán.
- [ ] Bảng/form tối ưu cho nghiệp vụ và tiếng Việt.
- [ ] Responsive không làm mất chức năng.
- [ ] Đã kiểm tra keyboard/focus/contrast/semantic HTML.
- [ ] Có trạng thái loading/empty/error khi cần.
- [ ] Không phát sinh dependency hoặc thay đổi logic ngoài phạm vi mà không được duyệt.
- [ ] Đã chạy các kiểm thử khả dụng và báo cáo kết quả trung thực.

## 15. Định dạng báo cáo của Coding Agent sau mỗi tác vụ UI

Báo cáo ngắn gọn theo cấu trúc:

1. **Phạm vi:** trang/component đã thay đổi.
2. **Lý do thiết kế:** vì sao chọn bố cục và phân cấp này; cách tránh mẫu AI rập khuôn.
3. **Tái sử dụng:** tokens/component hiện hữu đã dùng.
4. **Kiểm thử:** lệnh đã chạy, viewport/trạng thái đã kiểm tra, kết quả.
5. **Giới hạn:** điều chưa kiểm chứng, rủi ro hoặc quyết định cần người dùng duyệt.

## 16. Quy tắc thực thi cho Agent

- **MUST / BẮT BUỘC:** tuân thủ các yêu cầu về nghiệp vụ, consistency, accessibility, an toàn và kiểm thử.
- **MUST NOT / CẤM:** tự ý thay framework, phá vỡ giao diện đã duyệt, thay logic nghiệp vụ vì thẩm mỹ, báo cáo kiểm thử giả.
- **SHOULD / NÊN:** dùng layout tiết chế, tránh các dấu hiệu template AI, tận dụng thiết kế hiện hữu.
- **MAY / CÓ THỂ:** dùng gradient, card, shadow, animation hoặc layout khác thường khi có lý do rõ và được thiết kế nhất quán.

**Quy tắc cuối:** Không tối ưu giao diện để “trông như do con người viết” bằng những chi tiết tùy tiện. Hãy tối ưu để sản phẩm có tính chuyên nghiệp, có chủ đích, nhất quán, dễ dùng và phù hợp với công việc thực tế.
