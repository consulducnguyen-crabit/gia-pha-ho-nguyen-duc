# GitHub Pages preview

Người dùng cho phép commit/push và chọn deploy frontend GitHub Pages chưa kết nối
dữ liệu. Workflow pages.yml chỉ build/upload dist; không chạy seed, deploy rules,
Functions hoặc Storage. Tất cả VITE_FIREBASE_* để trống, emulatorfalse, nên trang
hiển thị Sẵn sàng kết nối. Không phải bản nghiệm thu ứng dụng production đầy đủ.

GitHub: consulducnguyen-crabit/gia-pha-ho-nguyen-duc, nhánh main. Vite base tương
đối và HashRouter hỗ trợ repository Pages path. Trong Settings → Pages chọn
Source GitHub Actions; workflow pushmain hoặc workflow_dispatch sẽ phát hành.
Repository private có thể cần GitHub plan hỗ trợ Pages; không tự đổi visibility
repo hay mua gói có phí. Các frontend assets được xuất bản có thể truy cập công khai.

CI riêng chạy emulator tests. Pages deploy không triển khai backend đang cố ý
fail closed ngoài emulator. Region/billing/production Auth/provisioning vẫn cần
cấu hình riêng trước khi phát hành ứng dụng có dữ liệu thật.

Rollback frontend bằng commit đã kiểm chứng trước đó và chạy lại Pages workflow;
không force-push, mở rules hoặc đưa credentials vào bundle để chữa lỗi.
