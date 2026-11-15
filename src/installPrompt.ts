// Cho phép "Cài ứng dụng / Thêm vào màn hình chính" trên điện thoại, máy tính bảng, máy tính.
// - Chrome/Edge/Android: trình duyệt phát sự kiện beforeinstallprompt; ta giữ lại để mở hộp cài đặt khi người dùng bấm.
// - iOS/iPadOS (Safari): không có sự kiện, chỉ hướng dẫn thao tác thủ công.
// Hàm thuần để kiểm thử; không lưu hay gửi dữ liệu nào.

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallMode = "hidden" | "prompt" | "ios";

/** Đang chạy như ứng dụng đã cài (không còn thanh trình duyệt). */
export function isStandalone(env: {
  matchMedia?: (q: string) => { matches: boolean };
  standalone?: boolean;
}): boolean {
  return (
    env.standalone === true ||
    env.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

/** iPhone, iPad (kể cả iPadOS tự nhận là Mac có cảm ứng), iPod. */
export function isIosDevice(nav: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1)
  );
}

export function installMode(input: {
  standalone: boolean;
  hasPrompt: boolean;
  ios: boolean;
}): InstallMode {
  if (input.standalone) return "hidden";
  if (input.hasPrompt) return "prompt";
  return input.ios ? "ios" : "hidden";
}

// --- Trạng thái dùng chung (bắt sự kiện sớm, trước khi giao diện đăng nhập hiện ra) ---
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let started = false;
const notify = () => listeners.forEach((l) => l());

export function startInstallCapture(win: Window = globalThis.window): void {
  if (started || !win) return;
  started = true;
  win.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // tự hiển thị nút của ta thay vì thanh mặc định
    deferred = e as InstallPromptEvent;
    notify();
  });
  win.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const hasInstallPrompt = () => deferred !== null;

/** Mở hộp cài đặt của trình duyệt; trả về true nếu người dùng đồng ý. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null; // mỗi sự kiện chỉ dùng được một lần
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}
