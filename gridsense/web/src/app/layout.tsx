import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { FloatingNav } from "@/components/FloatingNav";
import { CopilotDock } from "@/components/copilot/CopilotDock";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GridSense — Event-Driven Congestion Intelligence",
  description:
    "Forecast event-related traffic impact and recommend manpower, barricading, and diversion plans for Bengaluru Traffic Police (ASTraM).",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="min-h-full flex flex-col font-sans bg-white text-[#1d1d1f]">
        <FloatingNav />
        <main className="flex-1 min-h-0 pt-[var(--nav-height)]">{children}</main>
        <CopilotDock />
      </body>
    </html>
  );
}
