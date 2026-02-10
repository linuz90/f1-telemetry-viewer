import { type ReactNode, useState, useRef, useCallback } from "react";

interface TooltipProps {
  text: string;
  children: ReactNode;
  className?: string;
}

/**
 * Lightweight tooltip using fixed positioning so it works inside
 * overflow-hidden/auto containers (tables, scroll areas, etc.).
 */
export function Tooltip({ text, children, className = "" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        setPos({ x: rect.left + rect.width / 2, y: rect.top });
      }
      setVisible(true);
    }, 150);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <span
      ref={ref}
      className={`inline-flex items-center ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="
            fixed z-50 pointer-events-none
            px-2.5 py-1.5 rounded-md
            bg-zinc-800 border border-zinc-700 shadow-lg
            text-[11px] leading-snug font-normal text-zinc-300 whitespace-normal text-left
            w-max max-w-60
            animate-in fade-in duration-100
          "
          style={{
            left: pos.x,
            top: pos.y,
            transform: "translate(-50%, -100%) translateY(-6px)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
