"use client";

import { PillButton } from "@/components/ui/PillButton";
import { Section } from "@/components/ui/Section";
import { FadeIn, ScrollReveal, StaggerChildren, StaggerItem } from "@/components/ui/motion";
import { GlassPanel } from "@/components/ui/GlassPanel";

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative min-h-[calc(100vh-var(--nav-height))] flex items-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#f5f5f7] via-white to-[#e8f4fd]" />
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 50%, rgba(0,113,227,0.08) 0%, transparent 50%),
              radial-gradient(circle at 80% 20%, rgba(0,113,227,0.06) 0%, transparent 40%),
              linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)
            `,
            backgroundSize: "100% 100%, 100% 100%, 48px 48px, 48px 48px",
          }}
        />
        <div className="content-width relative z-10 py-24 md:py-32">
          <FadeIn>
            <p className="text-caption text-[#0071e3] uppercase tracking-widest mb-4">
              ASTraM · Bengaluru Traffic Police
            </p>
            <h1 className="text-hero text-[#1d1d1f] max-w-4xl">
              Event-driven congestion intelligence.
            </h1>
            <p className="text-body text-[#6e6e73] mt-6 max-w-2xl">
              Forecast traffic impact before events happen. Deploy resources with
              precision. Learn from every outcome — a self-correcting intelligence
              platform built for city-scale operations.
            </p>
            <div className="flex flex-wrap gap-4 mt-10">
              <PillButton href="/command">Open Command Center</PillButton>
              <PillButton href="/plan" variant="secondary">
                Plan an Event
              </PillButton>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Feature 1: Command Center */}
      <Section
        title="Live intelligence hub"
        subtitle="See every active event across Bengaluru. Ranked by impact, mapped in real time."
      >
        <ScrollReveal>
          <GlassPanel className="overflow-hidden">
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <h3 className="text-title-2 text-[#1d1d1f] mb-4">
                  Command Center
                </h3>
                <p className="text-body text-[#6e6e73] mb-6">
                  Floating KPIs, edge-to-edge interactive maps, and deployment
                  recommendations — all in one cinematic view. No dashboard clutter.
                </p>
                <PillButton href="/command" variant="ghost">
                  Explore Command Center →
                </PillButton>
              </div>
              <div className="relative h-64 md:h-80 rounded-2xl bg-gradient-to-br from-[#e8f4fd] to-[#f5f5f7] flex items-center justify-center">
                <div className="absolute inset-4 rounded-xl border border-black/[0.04] bg-white/60 backdrop-blur-sm flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl mb-2">🗺</div>
                    <p className="text-caption text-[#6e6e73]">Interactive city map</p>
                  </div>
                </div>
            </div>
            </div>
          </GlassPanel>
        </ScrollReveal>
      </Section>

      {/* Feature 2: Event Planning */}
      <Section
        className="bg-[#f5f5f7]"
        title="AI-powered event planning"
        subtitle="Step-by-step guidance. One decision at a time. Full operational playbook on completion."
      >
        <ScrollReveal>
          <GlassPanel>
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div className="order-2 md:order-1 relative h-64 md:h-80 rounded-2xl bg-gradient-to-br from-[#f5f5f7] to-[#e8e8ed] flex items-center justify-center">
                <StaggerChildren className="flex flex-col gap-3 w-48">
                  {["Scenario", "Venue", "Scale", "Review"].map((step, i) => (
                    <StaggerItem key={step}>
                      <div
                        className={`glass-panel px-4 py-3 text-sm font-medium ${
                          i === 0 ? "ring-2 ring-[#0071e3]" : "opacity-60"
                        }`}
                      >
                        {i + 1}. {step}
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerChildren>
              </div>
              <div className="order-1 md:order-2">
                <h3 className="text-title-2 text-[#1d1d1f] mb-4">
                  Event Planning Console
                </h3>
                <p className="text-body text-[#6e6e73] mb-6">
                  Describe your event. GridSense forecasts impact, recommends
                  strategies, plans diversions, and generates a field-ready
                  technical report.
                </p>
                <PillButton href="/plan" variant="ghost">
                  Start planning →
                </PillButton>
              </div>
            </div>
          </GlassPanel>
        </ScrollReveal>
      </Section>

      {/* Feature 3: Learning */}
      <Section
        title="Self-correcting forecasts"
        subtitle="Every closed event makes the next prediction smarter. Validated out-of-sample."
      >
        <ScrollReveal>
          <GlassPanel>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  stat: "+12%",
                  label: "Tier accuracy",
                  desc: "Impact classification improves after calibration",
                },
                {
                  stat: "80%",
                  label: "Within error band",
                  desc: "Honest uncertainty ranges, not false precision",
                },
                {
                  stat: "30%",
                  label: "Holdout validation",
                  desc: "Proven on unseen events, not curve-fitted",
                },
              ].map((item) => (
                <div key={item.label} className="text-center p-4">
                  <div className="text-4xl font-bold text-[#0071e3] tracking-tight">
                    {item.stat}
                  </div>
                  <div className="font-semibold text-[#1d1d1f] mt-2">
                    {item.label}
                  </div>
                  <p className="text-caption text-[#6e6e73] mt-1">{item.desc}</p>
                </div>
              ))}
            </div>
            <div className="text-center mt-8">
              <PillButton href="/learning" variant="secondary">
                View learning insights
              </PillButton>
            </div>
          </GlassPanel>
        </ScrollReveal>
      </Section>

      {/* Footer CTA */}
      <section className="section-spacing bg-[#1d1d1f] text-white">
        <div className="content-width text-center">
          <ScrollReveal>
            <h2 className="text-title-1 text-white mb-4">
              Ready to see it in action?
            </h2>
            <p className="text-body text-[#a1a1a6] mb-8 max-w-xl mx-auto">
              GridSense demo · MapmyIndia + ASTraM mock feeds · Bengaluru Traffic Police
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <PillButton
                href="/command"
                className="!bg-white !text-[#1d1d1f] hover:!bg-[#f5f5f7]"
              >
                Open Command Center
              </PillButton>
              <PillButton
                href="/plan"
                variant="ghost"
                className="!text-white hover:!bg-white/10"
              >
                Plan an event
              </PillButton>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}
