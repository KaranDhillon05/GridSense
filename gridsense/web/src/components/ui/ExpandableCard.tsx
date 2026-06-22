"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

export function ExpandableCard({
  title,
  subtitle,
  badge,
  children,
  expandedContent,
  selected,
  onSelect,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  expandedContent?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  return (
    <div
      className={`rounded-2xl border transition-shadow bg-white ${
        selected
          ? "border-[#0071e3] shadow-[0_0_0_1px_#0071e3]"
          : "border-black/[0.08] hover:border-black/[0.12]"
      }`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onSelect?.()}
          className="flex-1 text-left p-4 min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3] rounded-l-2xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[#1d1d1f] text-sm leading-snug">{title}</div>
              {subtitle && (
                <div className="text-xs text-[#6e6e73] mt-1">{subtitle}</div>
              )}
              {children}
            </div>
            {badge && <div className="shrink-0">{badge}</div>}
          </div>
        </button>
        {expandedContent && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Collapse details" : "Expand details"}
            onClick={() => setOpen((v) => !v)}
            className="px-3 text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] border-l border-black/[0.06] rounded-r-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3]"
          >
            {open ? "−" : "+"}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && expandedContent && (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 text-sm text-[#424245] border-t border-black/[0.04]">
              {expandedContent}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
