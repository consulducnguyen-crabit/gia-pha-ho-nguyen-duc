// Liên kết họ tên tới hồ sơ; người có ghi chú thì hiện ghi chú (đã cắt, chữ thuần) dạng tooltip:
// rê chuột hoặc focus bàn phím vào họ tên; trên cảm ứng thì giữ ngón tay ~0,5 giây (bấm nhanh vẫn mở hồ sơ).
// Tooltip tắt bằng Esc, rời chuột/focus, chạm ra ngoài hoặc cuộn (WCAG 1.4.13); nội dung luôn nằm trong DOM
// và gắn aria-describedby để trình đọc màn hình đọc được mà không cần rê chuột.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { SnapPerson } from "./treeModel";

export const LONG_PRESS_MS = 500;
const TIP_MAX_WIDTH = 320;
const EDGE = 8;

export function PersonNameLink({ p }: { p: SnapPerson }) {
  const note = p.note ?? null;
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const touching = useRef(false);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});

  const show = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(TIP_MAX_WIDTH, window.innerWidth - 2 * EDGE);
    const left = Math.max(
      EDGE,
      Math.min(r.left, window.innerWidth - width - EDGE),
    );
    // Đủ chỗ phía dưới thì đặt dưới tên, không thì đặt phía trên.
    const below = window.innerHeight - r.bottom > 180 || r.top < 180;
    setStyle(
      below
        ? { left, width, top: r.bottom + 4 }
        : { left, width, bottom: window.innerHeight - r.top + 4 },
    );
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!note)
    return (
      <Link to={`/person/${p.id}`} className="tree-name">
        {p.name}
      </Link>
    );
  return (
    <span
      className="note-wrap"
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      <Link
        to={`/person/${p.id}`}
        className="tree-name has-note"
        aria-describedby={tipId}
        onTouchStart={() => {
          touching.current = true;
          longPressed.current = false;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            longPressed.current = true;
            show();
          }, LONG_PRESS_MS);
        }}
        onTouchMove={() => {
          if (timer.current) clearTimeout(timer.current);
        }}
        onTouchEnd={(e) => {
          touching.current = false;
          if (timer.current) clearTimeout(timer.current);
          // Đã giữ đủ lâu thì chỉ hiện ghi chú, không mở hồ sơ.
          if (longPressed.current) e.preventDefault();
        }}
        onTouchCancel={() => {
          touching.current = false;
          if (timer.current) clearTimeout(timer.current);
        }}
        onClick={(e) => {
          if (longPressed.current) {
            e.preventDefault();
            longPressed.current = false;
          }
        }}
        // Giữ ngón tay trên điện thoại sinh menu ngữ cảnh của liên kết; chuột phải trên máy tính vẫn dùng được.
        onContextMenu={(e) => {
          if (touching.current) e.preventDefault();
        }}
      >
        {p.name}
      </Link>
      <span
        role="tooltip"
        id={tipId}
        className="note-tip"
        hidden={!open}
        style={style}
      >
        {note}
      </span>
    </span>
  );
}
