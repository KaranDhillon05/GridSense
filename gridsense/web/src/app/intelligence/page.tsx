"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buildBestResponses, type BestResponse } from "@/lib/ops/opsIntelligence";
import type { MemoryEntry } from "@/lib/playbookMemory";
import { prettyCause, fmtDuration } from "@/lib/ui";

function ResponseCard({ r }: { r: BestResponse }) {
  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[#1d1d1f]">{r.label}</div>
          <div className="text-[11px] text-[#6e6e73] mt-0.5">{r.n} proven cases · top corridor {r.topCorridor}</div>
        </div>
        <span className="text-[10px] font-semibold bg-[#ecfdf5] text-[#065f46] px-2 py-1 rounded-full shrink-0">
          {r.bestPlan}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-[#f5f5f7] rounded-lg p-2.5">
          <div className="text-lg font-bold text-[#16a34a] tabular-nums leading-none">{r.avgReductionPct}%</div>
          <div className="text-[10px] text-[#6e6e73] mt-1">avg delay cut</div>
        </div>
        <div className="bg-[#f5f5f7] rounded-lg p-2.5">
          <div className="text-lg font-bold text-[#1d1d1f] tabular-nums leading-none">{r.totalVehHoursSaved}</div>
          <div className="text-[10px] text-[#6e6e73] mt-1">veh-hrs saved</div>
        </div>
        <div className="bg-[#f5f5f7] rounded-lg p-2.5">
          <div className="text-lg font-bold text-[#0071e3] tabular-nums leading-none">{r.avgVsAlternativePct}%</div>
          <div className="text-[10px] text-[#6e6e73] mt-1">vs next-best</div>
        </div>
      </div>
    </div>
  );
}

export default function IntelligencePage() {
  const [data, setData] = useState<{ library: BestResponse[]; recent: MemoryEntry[]; total: number }>({
    library: [],
    recent: [],
    total: 0,
  });

  useEffect(() => {
    const update = () => setData(buildBestResponses());
    const t0 = setTimeout(update, 0); // defer first read out of the effect body
    const iv = setInterval(update, 4000);
    return () => {
      clearTimeout(t0);
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="content-width py-6 px-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">Operations Intelligence</h1>
          <p className="text-sm text-[#6e6e73] mt-1">
            Best-known responses, proven by simulation · {data.total} logged decisions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/learning" className="text-sm text-[#6e6e73] hover:text-[#1d1d1f]">
            Forecast calibration (technical) →
          </Link>
          <Link href="/operations" className="text-sm text-[#0071e3] hover:underline">
            Operations Center →
          </Link>
        </div>
      </div>

      {data.total === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[0.12] bg-white p-8 text-center">
          <div className="text-sm font-semibold text-[#1d1d1f]">No proven decisions yet</div>
          <p className="text-xs text-[#6e6e73] mt-2 max-w-md mx-auto">
            Run the Strategy Wind Tunnel on an incident and deploy a plan, or use Replay-and-Prove —
            each measured outcome is logged here and aggregated into the best-known-response library.
          </p>
          <div className="flex justify-center gap-3 mt-4">
            <Link href="/incidents" className="text-sm text-[#0071e3] hover:underline">
              Go to incidents
            </Link>
            <Link href="/proof" className="text-sm text-[#0071e3] hover:underline">
              Replay-and-Prove
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="mb-7">
            <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-3">
              Best Known Response Library
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.library.map((r) => (
                <ResponseCard key={r.incidentType} r={r} />
              ))}
            </div>
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-wide font-medium text-[#6e6e73] mb-3">
              Recent proven decisions
            </div>
            <div className="rounded-2xl border border-black/[0.08] bg-white divide-y divide-black/[0.05]">
              {data.recent.map((e) => (
                <div key={e.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="font-medium text-[#1d1d1f] truncate flex-1">
                    {prettyCause(e.context.incidentType)} · {e.context.corridor}
                  </span>
                  <span className="text-[11px] text-[#16a34a] font-semibold shrink-0">
                    −{e.outcome.reductionPct}% delay
                  </span>
                  <span className="text-[11px] text-[#6e6e73] shrink-0 w-20 text-right">
                    {e.outcome.clearanceMin != null ? `clear ${fmtDuration(e.outcome.clearanceMin)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
