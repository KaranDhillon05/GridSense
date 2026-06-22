"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useScroll, useMotionValueEvent, useReducedMotion } from "framer-motion";

const LINKS = [
  { href: "/", label: "Home", short: "Home" },
  { href: "/operations", label: "Operations", short: "Ops" },
  { href: "/incidents", label: "Incidents", short: "Inc" },
  { href: "/workflows", label: "Workflows", short: "Flow" },
  { href: "/events", label: "Events", short: "Events" },
  { href: "/resources", label: "Resources", short: "Units" },
  { href: "/digital-twin", label: "Digital Twin", short: "Twin" },
  { href: "/preparedness", label: "Night Watch", short: "Watch" },
  { href: "/intelligence", label: "Intelligence", short: "Intel" },
  { href: "/command", label: "Command", short: "Cmd" },
  { href: "/plan", label: "Plan", short: "Plan" },
  { href: "/simulation", label: "Simulation", short: "Sim" },
  { href: "/map-sim", label: "Real Map Sim", short: "Map" },
  { href: "/proof", label: "Proof", short: "Proof" },
  { href: "/learning", label: "Learning", short: "Learn" },
];

export function FloatingNav() {
  const path = usePathname();
  const { scrollY } = useScroll();
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 20));

  if (path === "/plan/report") return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-[1100] flex justify-center px-3 sm:px-4 pt-3 sm:pt-4 pointer-events-none">
      <motion.nav
        className="glass-nav pointer-events-auto flex items-center gap-1 rounded-full px-2 py-1.5 sm:px-3 sm:py-2 w-full max-w-[1500px]"
        animate={
          reduced
            ? {}
            : {
                boxShadow: scrolled
                  ? "0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)"
                  : "0 4px 24px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)",
              }
        }
        transition={{ duration: 0.2 }}
      >
        <Link href="/" className="flex items-center gap-2 pl-1.5 pr-2 shrink-0 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#1d1d1f] flex items-center justify-center text-sm font-bold text-white shrink-0">
            G
          </div>
          <span className="font-semibold text-sm tracking-tight text-[#1d1d1f] hidden sm:inline truncate">
            GridSense
          </span>
        </Link>

        <div className="flex-1 flex items-center justify-end sm:justify-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none">
          {LINKS.map((l) => {
            const active =
              l.href === "/"
                ? path === "/"
                : path === l.href || path.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                  active
                    ? "bg-[#1d1d1f] text-white"
                    : "text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]"
                }`}
              >
                <span className="sm:hidden">{l.short}</span>
                <span className="hidden sm:inline">{l.label}</span>
              </Link>
            );
          })}
        </div>
      </motion.nav>
    </header>
  );
}
