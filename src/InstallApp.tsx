// Nút "Cài ứng dụng" ở trang đăng nhập: Chrome/Android mở hộp cài đặt; iPhone/iPad hiện hướng dẫn Safari.
import { useState, useSyncExternalStore } from "react";
import {
  hasInstallPrompt,
  installMode,
  isIosDevice,
  isStandalone,
  promptInstall,
  subscribeInstall,
} from "./installPrompt";

export function InstallApp() {
  const hasPrompt = useSyncExternalStore(
    subscribeInstall,
    hasInstallPrompt,
    () => false,
  );
  const [done, setDone] = useState(false);
  const mode = installMode({
    standalone: isStandalone({
      matchMedia: globalThis.matchMedia?.bind(globalThis),
      standalone: (navigator as { standalone?: boolean }).standalone,
    }),
    hasPrompt,
    ios: isIosDevice(navigator),
  });
  if (done || mode === "hidden") return null;
  if (mode === "prompt")
    return (
      <button
        type="button"
        className="install-app"
        onClick={() => void promptInstall().then((ok) => ok && setDone(true))}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
          <path d="M12 8v6m-3-3 3 3 3-3" />
        </svg>
        Cài ứng dụng lên màn hình chính
      </button>
    );
  return (
    <details className="install-app-ios">
      <summary>Thêm vào màn hình chính</summary>
      <p>
        Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên hướng lên) trên thanh Safari,
        chọn <b>Thêm vào Màn hình chính</b>, rồi bấm <b>Thêm</b>.
      </p>
    </details>
  );
}
