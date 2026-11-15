import { describe, expect, it } from "vitest";
import {
  hasInstallPrompt,
  installMode,
  isIosDevice,
  isStandalone,
  promptInstall,
  startInstallCapture,
  subscribeInstall,
} from "../src/installPrompt";

describe("isStandalone", () => {
  it("nhận ra ứng dụng đã cài (display-mode hoặc navigator.standalone)", () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandalone({ standalone: true })).toBe(true);
    expect(
      isStandalone({
        matchMedia: () => ({ matches: false }),
        standalone: false,
      }),
    ).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
});

describe("isIosDevice", () => {
  it("iPhone, iPad, iPod và iPadOS giả Mac có cảm ứng", () => {
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      }),
    ).toBe(true);
    expect(isIosDevice({ userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0)" })).toBe(
      true,
    );
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });
  it("Mac thật (không cảm ứng), Android, Windows không phải iOS", () => {
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
    expect(isIosDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14)" })).toBe(
      false,
    );
    expect(isIosDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe(
      false,
    );
  });
});

describe("installMode", () => {
  it("đã cài thì ẩn; có sự kiện cài thì hiện nút; iOS thì hướng dẫn; còn lại ẩn", () => {
    expect(installMode({ standalone: true, hasPrompt: true, ios: true })).toBe(
      "hidden",
    );
    expect(
      installMode({ standalone: false, hasPrompt: true, ios: false }),
    ).toBe("prompt");
    expect(
      installMode({ standalone: false, hasPrompt: false, ios: true }),
    ).toBe("ios");
    expect(
      installMode({ standalone: false, hasPrompt: false, ios: false }),
    ).toBe("hidden");
  });
});

describe("bắt sự kiện cài đặt", () => {
  it("giữ sự kiện beforeinstallprompt, mở hộp cài đặt đúng một lần, xóa khi đã cài", async () => {
    const win = new EventTarget() as unknown as Window;
    startInstallCapture(win);
    let notified = 0;
    const off = subscribeInstall(() => notified++);
    expect(hasInstallPrompt()).toBe(false);
    expect(await promptInstall()).toBe(false);

    let prompted = 0;
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt: async () => {
          prompted++;
        },
        userChoice: Promise.resolve({ outcome: "accepted" as const }),
      },
    );
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); // không để trình duyệt tự hiện thanh cài đặt
    expect(hasInstallPrompt()).toBe(true);
    expect(await promptInstall()).toBe(true);
    expect(prompted).toBe(1);
    expect(hasInstallPrompt()).toBe(false); // mỗi sự kiện chỉ dùng một lần
    expect(await promptInstall()).toBe(false);

    // người dùng từ chối: trả false
    win.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => undefined,
        userChoice: Promise.resolve({ outcome: "dismissed" as const }),
      }),
    );
    expect(await promptInstall()).toBe(false);

    // đã cài xong: bỏ sự kiện đang giữ
    win.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => undefined,
        userChoice: Promise.resolve({ outcome: "dismissed" as const }),
      }),
    );
    win.dispatchEvent(new Event("appinstalled"));
    expect(hasInstallPrompt()).toBe(false);
    expect(notified).toBeGreaterThan(0);
    off();
  });
});
