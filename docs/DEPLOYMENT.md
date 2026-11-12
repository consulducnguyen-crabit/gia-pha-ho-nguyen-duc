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

## Cập nhật 2026-11-11

Pages đã đổi nguồn sang **GitHub Actions** (trước đó là "Deploy from a branch: main /", nên trang phục vụ `index.html` gốc của mã nguồn và ứng dụng không chạy). Workflow `pages.yml` đã chạy thành công và trang phục vụ bản build. Quy trình đưa lên Firebase dev: xem DEPLOY_DEV.md.

## Pages chờ CI — 2026-11-12

`pages.yml` không còn chạy trực tiếp khi push main. Trigger là `workflow_run` của workflow **"CI"** (`ci.yml`, chạy trên `pull_request` và `push` main) với `types: [completed]`, `branches: [main]`; vẫn giữ `workflow_dispatch` để chạy tay.
Job `build` chỉ chạy khi chạy tay, hoặc khi CI kết luận `success` và sự kiện gốc là `push` (loại PR/fork/CI hỏng/bị hủy). Checkout ghim `ref` = `workflow_run.head_sha` (đúng commit đã qua CI; chạy tay dùng `github.sha`). `deploy` chỉ chạy khi `build` thành công (job bị bỏ qua thì deploy cũng bị bỏ qua).
Quyền không đổi: `contents: read`; deploy có thêm `pages: write`, `id-token: write`; concurrency group `pages`; không thêm secrets.
Lưu ý: Pages vẫn nối biến `VITE_FIREBASE_PROJECT_ID` (đang trỏ PROD) và các biến VITE_* khác; PR này không đổi biến. Frontend Pages vẫn là tài sản công khai.
Chưa kiểm chứng trên GitHub: workflow_run chỉ chạy được sau khi file nằm trên nhánh mặc định, nên lần merge đầu tiên cần theo dõi tab Actions (CI xong rồi Pages mới chạy). Chỉ rà YAML thủ công/actionlint cục bộ.

## Tách vendor khi build — 2026-11-12

`vite.config.ts` dùng `build.rollupOptions.output.manualChunks` tách `react` và `firebase` khỏi chunk ứng dụng (958.72 kB một chunk, nay 136.36 kB + 260.05 + 559.06 kB). Không tách riêng `@firebase/firestore`: bản build bị lỗi chạy do phụ thuộc vòng giữa chunk. Vì vậy `chunkSizeWarningLimit` = 600. Sau mỗi thay đổi `manualChunks` phải mở bản build (`npm run build && npx vite preview`) và xác nhận trang tải được, vì browser check chạy bằng Vite dev nên không bắt lỗi này. Tên file có hash nội dung; Pages (đường dẫn tương đối) không cần cấu hình thêm.
