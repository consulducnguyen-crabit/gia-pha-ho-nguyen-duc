// Nút cuộn trang nổi (lên đầu / xuống cuối) cho mọi màn hình. Chỉ điều khiển vị trí cuộn, không đụng dữ liệu.
import { useEffect, useState } from "react";

const THRESHOLD = 240;

function scrollToEdge(edge: "top" | "bottom") {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({
    top: edge === "top" ? 0 : document.documentElement.scrollHeight,
    behavior: reduce ? "auto" : "smooth",
  });
}

export function ScrollButtons() {
  const [canUp, setCanUp] = useState(false);
  const [canDown, setCanDown] = useState(false);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setCanUp(window.scrollY > THRESHOLD);
      setCanDown(max - window.scrollY > THRESHOLD);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Nội dung đổi chiều cao (đổi trang, mở biểu mẫu) cũng cần tính lại.
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);
  if (!canUp && !canDown) return null;
  return (
    <div className="scroll-fab" role="group" aria-label="Cuộn trang">
      {canUp && (
        <button
          type="button"
          aria-label="Cuộn lên đầu trang"
          title="Lên đầu trang"
          onClick={() => scrollToEdge("top")}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M5 15l7-7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {canDown && (
        <button
          type="button"
          aria-label="Cuộn xuống cuối trang"
          title="Xuống cuối trang"
          onClick={() => scrollToEdge("bottom")}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M5 9l7 7 7-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
