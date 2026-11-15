// Sinh favicon và biểu tượng ứng dụng (PWA) từ chữ 阮 (Nguyễn) thư pháp có sẵn trong src/BrandMark.tsx.
// Kiểu "ấn son": nền đỏ son, chữ màu kem, giống ấn họ Nguyễn trên hình câu đối.
// Chạy: CHROMIUM_PATH=... node scripts/make-icons.mjs  (chỉ khi đổi thiết kế; PNG sinh ra được commit).
// Phông Ma Shan Zheng (SIL OFL 1.1), xem docs/FONT_LICENSES.md. Không có dữ liệu gia phả nào ở đây.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const brand = readFileSync(resolve(root, "src", "BrandMark.tsx"), "utf8");
const glyph = /GLYPH_NGUYEN\s*=\s*"([^"]+)"/.exec(brand)?.[1];
if (!glyph) throw Error("Không tìm thấy GLYPH_NGUYEN trong src/BrandMark.tsx");

const SEAL = "#8f3a2b";
const PAPER = "#f3e6c8";

/** SVG vuông cạnh S: nền đỏ (bo góc hoặc tràn viền) và chữ 阮 màu kem cách lề `pad` (tỷ lệ). */
function iconSvg(S, { radius, pad }) {
  const g = S * (1 - 2 * pad);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
    `<rect width="${S}" height="${S}" rx="${radius * S}" fill="${SEAL}"/>` +
    `<svg x="${S * pad}" y="${S * pad}" width="${g}" height="${g}" viewBox="20 -820 940 930">` +
    `<path transform="scale(1,-1)" d="${glyph}" fill="${PAPER}"/></svg></svg>`
  );
}

// Favicon vector (hiển thị sắc nét ở mọi cỡ trên trình duyệt hiện đại).
const pub = resolve(root, "public");
mkdirSync(resolve(pub, "icons"), { recursive: true });
writeFileSync(
  resolve(pub, "favicon.svg"),
  iconSvg(64, { radius: 0.19, pad: 0.1 }),
);

const targets = [
  // [tệp, cạnh, kiểu]
  ["icons/favicon-32.png", 32, { radius: 0.19, pad: 0.08 }],
  ["icons/favicon-48.png", 48, { radius: 0.19, pad: 0.08 }],
  ["icons/icon-192.png", 192, { radius: 0.19, pad: 0.13 }],
  ["icons/icon-512.png", 512, { radius: 0.19, pad: 0.13 }],
  // Maskable: tràn viền, chữ nằm gọn trong vùng an toàn (hệ điều hành tự cắt hình).
  ["icons/icon-maskable-512.png", 512, { radius: 0, pad: 0.22 }],
  // iOS tự bo góc: dùng nền tràn viền, không trong suốt.
  ["icons/apple-touch-icon.png", 180, { radius: 0, pad: 0.17 }],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage();
  for (const [file, size, style] of targets) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${iconSvg(size, style)}`,
    );
    await page.screenshot({
      path: resolve(pub, file),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    console.log("Đã tạo", file);
  }
} finally {
  await browser.close();
}
console.log("Đã tạo public/favicon.svg");
