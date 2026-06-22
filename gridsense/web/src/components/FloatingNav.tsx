"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useScroll, useMotionValueEvent, useReducedMotion } from "framer-motion";

type NavLink = { href: string; label: string; short: string };
type NavCategory = { id: string; label: string; short: string; links: NavLink[] };

// Standalone home link (logo also points here).
const HOME: NavLink = { href: "/", label: "Home", short: "Home" };

// Pages grouped into 5 categories along the operational workflow:
// sense → respond → simulate → plan → prove.
const CATEGORIES: NavCategory[] = [
  {
    id: "command",
    label: "Command Center",
    short: "Command",
    links: [
      { href: "/operations", label: "Operations", short: "Ops" },
      { href: "/command", label: "Command", short: "Cmd" },
      { href: "/intelligence", label: "Intelligence", short: "Intel" },
    ],
  },
  {
    id: "response",
    label: "Incident Response",
    short: "Response",
    links: [
      { href: "/incidents", label: "Incidents", short: "Inc" },
      { href: "/workflows", label: "Workflows", short: "Flow" },
      { href: "/resources", label: "Resources", short: "Units" },
      { href: "/events", label: "Events", short: "Events" },
    ],
  },
  {
    id: "simulation",
    label: "Simulation & Twin",
    short: "Sim",
    links: [
      { href: "/digital-twin", label: "Digital Twin", short: "Twin" },
      { href: "/simulation", label: "Simulation", short: "Sim" },
      { href: "/map-sim", label: "Real Map Sim", short: "Map" },
    ],
  },
  {
    id: "planning",
    label: "Planning & Readiness",
    short: "Planning",
    links: [
      { href: "/plan", label: "Plan", short: "Plan" },
      { href: "/preparedness", label: "Night Watch", short: "Watch" },
    ],
  },
  {
    id: "insights",
    label: "Insights & Proof",
    short: "Insights",
    links: [
      { href: "/learning", label: "Learning", short: "Learn" },
      { href: "/proof", label: "Proof", short: "Proof" },
    ],
  },
];

function isActive(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

export function FloatingNav() {
  const path = usePathname();
  const { scrollY } = useScroll();
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 20));

  // Small grace delay so moving the cursor from trigger to panel doesn't close it.
  const open = useCallback((id: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenId(id);
  }, []);
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenId(null), 120);
  }, []);

  if (path === "/plan/report") return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-[1100] flex justify-center px-3 sm:px-4 pt-3 sm:pt-4 pointer-events-none">
      <motion.nav
        className="glass-nav pointer-events-auto flex items-center gap-1 rounded-full px-2 py-1.5 sm:px-3 sm:py-2 w-full max-w-[1100px]"
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

        <div className="flex-1 flex items-center justify-end sm:justify-center gap-0.5 flex-wrap sm:flex-nowrap">
          {/* Standalone Home */}
          <Link
            href={HOME.href}
            className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
              isActive(path, HOME.href)
                ? "bg-[#1d1d1f] text-white"
                : "text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]"
            }`}
          >
            <span className="sm:hidden">{HOME.short}</span>
            <span className="hidden sm:inline">{HOME.label}</span>
          </Link>

          {CATEGORIES.map((cat) => {
            const catActive = cat.links.some((l) => isActive(path, l.href));
            const isOpen = openId === cat.id;
            return (
              <div
                key={cat.id}
                className="relative"
                onMouseEnter={() => open(cat.id)}
                onMouseLeave={scheduleClose}
              >
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={isOpen}
                  onFocus={() => open(cat.id)}
                  onClick={() => (isOpen ? setOpenId(null) : open(cat.id))}
                  className={`flex items-center gap-1 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                    catActive || isOpen
                      ? "bg-[#1d1d1f] text-white"
                      : "text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]"
                  }`}
                >
                  <span className="sm:hidden">{cat.short}</span>
                  <span className="hidden sm:inline">{cat.label}</span>
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 10 10"
                    className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      role="menu"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-1/2 top-full -translate-x-1/2 mt-2 min-w-[180px] glass-nav rounded-2xl p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
                      onMouseEnter={() => open(cat.id)}
                      onMouseLeave={scheduleClose}
                    >
                      {cat.links.map((l) => {
                        const active = isActive(path, l.href);
                        return (
                          <Link
                            key={l.href}
                            href={l.href}
                            role="menuitem"
                            onClick={() => setOpenId(null)}
                            className={`block px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                              active
                                ? "bg-[#1d1d1f] text-white"
                                : "text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]"
                            }`}
                          >
                            {l.label}
                          </Link>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </motion.nav>
    </header>
  );
}
