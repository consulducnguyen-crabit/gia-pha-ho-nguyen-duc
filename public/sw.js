// Service worker tối giản, chỉ để trình duyệt cho phép "Cài đặt ứng dụng / Thêm vào màn hình chính".
// CỐ Ý không dùng bộ nhớ đệm (cache) và không chặn mạng: mọi yêu cầu đi thẳng ra mạng như bình thường,
// nên không bao giờ lưu dữ liệu gia phả hay thông tin đăng nhập trên thiết bị ngoài cơ chế riêng của Firebase.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
// Không gọi respondWith: yêu cầu được xử lý mặc định (qua mạng).
self.addEventListener("fetch", () => {});
