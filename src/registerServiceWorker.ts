// Đăng ký service worker tối giản (public/sw.js, không cache) để trình duyệt cho phép cài đặt ứng dụng.
// Chỉ chạy trên bản phát hành (không chạy ở dev/emulator) và khi trình duyệt hỗ trợ.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || import.meta.env.VITE_USE_EMULATORS === "true")
    return;
  if (!("serviceWorker" in navigator)) return;
  globalThis.addEventListener("load", () => {
    // Đường dẫn tương đối: đúng cả khi trang nằm trong thư mục con của GitHub Pages.
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
