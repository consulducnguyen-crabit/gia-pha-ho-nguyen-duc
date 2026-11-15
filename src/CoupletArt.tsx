// Câu đối đôi thư pháp "木有本 · 水有源" (Mộc hữu bản, thủy hữu nguyên: cây có gốc, nước có nguồn) trong vòng mực,
// kèm lời dịch và phiên âm Hán-Việt, ở cuối panel trái trang đăng nhập. Chỉ trang trí (aria-hidden).
// Nét chữ trích từ phông Ma Shan Zheng (SIL OFL 1.1), xem src/coupletGlyphs.ts và docs/FONT_LICENSES.md.
import { GLYPH_NGUYEN } from "./BrandMark";
import {
  GLYPH_BON,
  GLYPH_HUU,
  GLYPH_MOC,
  GLYPH_NGUON,
  GLYPH_THUY,
} from "./coupletGlyphs";

const SIZE = 104; // cạnh ô vuông của mỗi chữ
// Hai cột đối xứng quanh x = 240; lệch và nghiêng nhẹ từng chữ để giữ nét tay.
const CHARS = [
  { d: GLYPH_MOC, x: 112, y: 78, rot: -2 },
  { d: GLYPH_HUU, x: 116, y: 184, rot: 1.5 },
  { d: GLYPH_BON, x: 112, y: 290, rot: -1.5 },
  { d: GLYPH_THUY, x: 264, y: 78, rot: 2 },
  { d: GLYPH_HUU, x: 260, y: 184, rot: -1.5 },
  { d: GLYPH_NGUON, x: 264, y: 290, rot: 1.5 },
];

export function CoupletArt() {
  return (
    <>
      <svg
        className="gate-art"
        viewBox="0 0 480 490"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* Mép chữ và vòng mực hơi nhòe như nét cọ */}
          <filter id="couplet-brush" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.03"
              numOctaves="2"
              seed="4"
              result="noise"
            />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="4.5" />
          </filter>
          <radialGradient id="couplet-wash" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#3a2b1d" stopOpacity="0.16" />
            <stop offset="1" stopColor="#3a2b1d" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* vệt mực loang và vòng mực (ensō) */}
        <circle cx="240" cy="246" r="226" fill="url(#couplet-wash)" />
        <g
          filter="url(#couplet-brush)"
          fill="none"
          strokeLinecap="round"
          className="couplet-ink-stroke"
        >
          <circle
            cx="240"
            cy="246"
            r="206"
            strokeWidth="13"
            strokeDasharray="1204 1294"
            transform="rotate(-62 240 246)"
            opacity="0.78"
          />
          <circle
            cx="240"
            cy="246"
            r="203"
            strokeWidth="4.5"
            strokeDasharray="701 1276"
            transform="rotate(-80 240 246)"
            opacity="0.47"
          />
        </g>
        {/* hai cột chữ */}
        <g filter="url(#couplet-brush)" className="couplet-ink-fill">
          {CHARS.map((c, i) => (
            <g
              key={i}
              transform={`translate(${c.x},${c.y}) rotate(${c.rot} ${SIZE / 2} ${SIZE / 2})`}
            >
              <path
                transform={`translate(0,${0.82 * SIZE}) scale(${SIZE / 1000},${-SIZE / 1000})`}
                d={c.d}
              />
            </g>
          ))}
        </g>
        {/* ấn son họ Nguyễn, đặt ngoài vòng mực */}
        <g transform="translate(386,424)">
          <rect width="42" height="42" rx="3" className="couplet-seal" />
          <rect
            x="3"
            y="3"
            width="36"
            height="36"
            rx="2"
            fill="none"
            stroke="#f3e6c8"
            strokeWidth="1"
            opacity="0.65"
          />
          <svg x="6" y="6" width="30" height="30" viewBox="20 -820 940 930">
            <path transform="scale(1,-1)" d={GLYPH_NGUYEN} fill="#f3e6c8" />
          </svg>
        </g>
      </svg>
      {/* Lời dịch và phiên âm: chữ HTML cỡ cố định (không co theo hình) để dễ đọc ở mọi màn hình. */}
      <div className="gate-art-captions">
        <p className="gate-art-caption">Cây có gốc, nước có nguồn</p>
        <p className="gate-art-reading">MỘC HỮU BẢN · THỦY HỮU NGUYÊN</p>
      </div>
    </>
  );
}
