import type { ReactNode } from "react";
import { ScrollReveal } from "./motion";

export function Section({
  children,
  title,
  subtitle,
  className = "",
  id,
  reveal = true,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  id?: string;
  reveal?: boolean;
}) {
  const inner = (
    <section id={id} className={`section-spacing ${className}`}>
      <div className="content-width">
        {(title || subtitle) && (
          <div className="mb-12 max-w-2xl">
            {title && <h2 className="text-title-2 text-[#1d1d1f]">{title}</h2>}
            {subtitle && (
              <p className="text-body text-[#6e6e73] mt-3">{subtitle}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );

  return reveal ? <ScrollReveal>{inner}</ScrollReveal> : inner;
}

export function PageContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`content-width py-8 ${className}`}>{children}</div>
  );
}
