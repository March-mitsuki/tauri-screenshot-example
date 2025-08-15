import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TooltipProps = {
  children: React.ReactNode;
  content: React.ReactNode;
  visible: boolean;
};
export function Tooltip({ children, content, visible }: TooltipProps) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return;
    const update = () => {
      const anchorRect = anchorRef.current!.getBoundingClientRect();
      const tooltipRect = tooltipRef.current!.getBoundingClientRect();

      // 上方留 8px
      let top = anchorRect.top - tooltipRect.height - 8;
      // 水平居中
      let left = anchorRect.left - tooltipRect.width / 2 + anchorRect.width / 2;
      if (top < 0) {
        top = 0;
      }
      if (left < 0) {
        left = 0;
      }
      if (top + tooltipRect.height > window.innerHeight) {
        top = window.innerHeight - tooltipRect.height;
      }
      if (left + tooltipRect.width > window.innerWidth) {
        left = window.innerWidth - tooltipRect.width;
      }
      setPos({
        top,
        left,
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [visible]);

  return (
    <>
      <span ref={anchorRef} style={{ display: "inline-block" }}>
        {children}
      </span>

      {createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: "fixed",
            opacity: visible ? 1 : 0,
            top: pos.top,
            left: pos.left,
            // transform: "translate(-50%, -100%)",
            background: "var(--toolbar-tooltip-bg)",
            color: "var(--toolbar-tooltip-color-text)",
            padding: "4px 8px",
            borderRadius: 4,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            fontSize: 12,
            transition: "opacity 300ms cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        >
          {content}
        </div>,
        document.getElementById("portal")!
      )}
    </>
  );
}
