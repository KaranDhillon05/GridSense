import type { ReactNode, CSSProperties } from "react";

export function GlassPanel({
  children,
  className = "",
  style,
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padding?: boolean;
}) {
  return (
    <div
      className={`glass-panel ${padding ? "p-6" : ""} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
