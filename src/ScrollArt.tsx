// Hình cuốn thư cuộn mở ở cuối panel trái trang đăng nhập: câu "Uống nước nhớ nguồn", các dòng đời và ấn son họ Nguyễn.
// Chỉ trang trí (aria-hidden). Các dòng đời là minh họa chung, không phải dữ liệu gia phả. Ấn dùng nét chữ 阮 sẵn có
// trong logo (Ma Shan Zheng, SIL OFL 1.1; xem docs/FONT_LICENSES.md).
import { GLYPH_NGUYEN } from "./BrandMark";

const GENERATIONS = ["Đời 1", "Đời 2", "Đời 3", "Đời 4", "Đời 5"];
// Độ dài thanh minh họa cho từng dòng đời.
const BAR_WIDTHS = [150, 190, 120, 170, 100];

export function ScrollArt() {
  return (
    <svg
      className="gate-art"
      viewBox="0 0 480 330"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="scroll-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8efd6" />
          <stop offset="1" stopColor="#ecdcb4" />
        </linearGradient>
        <linearGradient id="scroll-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a6238" />
          <stop offset="0.55" stopColor="#6b4a2b" />
          <stop offset="1" stopColor="#4d341d" />
        </linearGradient>
      </defs>
      <ellipse
        cx="240"
        cy="322"
        rx="200"
        ry="7"
        fill="#3a2b1d"
        opacity="0.16"
      />
      {/* giấy */}
      <rect
        x="56"
        y="30"
        width="368"
        height="266"
        fill="url(#scroll-paper)"
        stroke="#b8a06a"
        strokeWidth="1.5"
      />
      <rect
        x="68"
        y="42"
        width="344"
        height="242"
        fill="none"
        stroke="#b8a06a"
        strokeWidth="1"
      />
      {/* trục trên và dưới */}
      {[18, 292].map((y) => (
        <g key={y}>
          <rect
            x="30"
            y={y}
            width="420"
            height="16"
            rx="8"
            fill="url(#scroll-wood)"
          />
          {[26, 454].map((cx) => (
            <circle
              key={cx}
              cx={cx}
              cy={y + 8}
              r="13"
              fill="#6b4a2b"
              stroke="#c9a85c"
              strokeWidth="3"
            />
          ))}
        </g>
      ))}
      {/* câu chữ */}
      <text className="gate-art-title" x="240" y="92" textAnchor="middle">
        Uống nước nhớ nguồn
      </text>
      <path
        d="M150 106 H225 M255 106 H330"
        stroke="#8f3a2b"
        strokeWidth="1.5"
      />
      <path d="M240 100 l6 6 -6 6 -6 -6 z" fill="#8f3a2b" />
      {/* các dòng đời (minh họa) */}
      {GENERATIONS.map((label, i) => (
        <g key={label}>
          <text className="gate-art-gen" x="92" y={146 + i * 26}>
            {label}
          </text>
          <rect
            x="140"
            y={140 + i * 26}
            width={BAR_WIDTHS[i]}
            height="5"
            rx="2"
            fill="#3a2b1d"
            opacity="0.38"
          />
        </g>
      ))}
      {/* ấn son họ Nguyễn */}
      <g transform="translate(350,206)">
        <rect width="52" height="52" rx="3" fill="#8f3a2b" />
        <rect
          x="4"
          y="4"
          width="44"
          height="44"
          rx="2"
          fill="none"
          stroke="#f6ecd0"
          strokeWidth="1.2"
          opacity="0.7"
        />
        <svg x="8" y="8" width="36" height="36" viewBox="20 -820 940 930">
          <path transform="scale(1,-1)" d={GLYPH_NGUYEN} fill="#f6ecd0" />
        </svg>
      </g>
    </svg>
  );
}
