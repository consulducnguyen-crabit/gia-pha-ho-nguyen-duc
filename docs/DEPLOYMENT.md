# GitHub Pages preview

Người dùng cho phép commit/push và chọn deploy frontend GitHub Pages chưa kết nối
dữ liệu. Workflow pages.yml chỉ build/upload dist; không chạy seed, deploy rules,
Functions hoặc Storage. Tất cả VITE_FIREBASE_* để trống, emulator=false, nên trang
hiển thị Sẵn sàng kết nối. Không phải bản nghiệm thu ứng dụng production đầy đủ.

GitHub: consulducnguyen-crabit/gia-pha-ho-nguyen-duc, nhánh main. Vite base tương
đối và HashRouter hỗ trợ repository Pages path. Trong Settings → Pages chọn
Source GitHub Actions; workflow push main hoặc workflow_dispatch sẽ phát hành.
Repository private có thể cần GitHub plan hỗ trợ Pages; không tự đổi visibility
repo hay mua gói có phí. Các frontend assets được xuất bản có thể truy cập công khai.

CI riêng chạy emulator tests. Pages deploy không triển khai backend đang cố ý
fail closed ngoài emulator. Region/billing/production Auth/provisioning vẫn cần
cấu hình riêng trước khi phát hành ứng dụng có dữ liệu thật.

Rollback frontend bằng commit đã kiểm chứng trước đó và chạy lại Pages workflow;
không force-push, mở rules hoặc đưa credentials vào bundle để chữa lỗi.

## Trạng thái 11/11/2026

Commit 7e50f9c đã push thành công lên main; git ls-remote xác nhận cùng SHA.
Lint/typecheck/6 unit tests/build cục bộ đạt; Chromium trên bản build xác nhận màn
Sẵn sàng kết nối, không request ngoài localhost và không overflow tại 360/768/1280 px.
Agent độc lập đã review workflow và boundary public bundle.

Chưa xác nhận deploy Pages thành công. CLI không gọi được api.github.com và
cloud browser báo Browser runtime unavailable; không tự đổi visibility hoặc gói.
Người dùng đã được hướng dẫn bật Source: GitHub Actions tại Settings → Pages rồi chạy
workflow pages.yml trên main. Cần URL/kết quả deployment thực trước khi đánh dấu đạt.

Các báo cáo UI/proposals cũ ghi trạng thái chưa commit ở thời điểm kiểm thử; trạng
thái commit/push hiện tại theo mục này và lịch sử Git, không suy ra deploy đã đạt.
