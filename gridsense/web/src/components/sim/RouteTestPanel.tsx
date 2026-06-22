"use client";

import { useEffect, useState } from "react";
import type { Engine } from "@/lib/sim/engine";

export interface RouteTestState {
  sourceJid?: number;
  destJid?: number;
  route?: string[];
  isActive: boolean;
}

export function RouteTestPanel({
  engine,
  allJunctions,
  testState,
  onStartTest,
  onCancelTest,
  onConfirmTest,
}: {
  engine: Engine | null;
  allJunctions: Array<{ jid: number; nodeId: string; name?: string }>;
  testState: RouteTestState;
  onStartTest: (srcJid: number, dstJid: number) => void;
  onCancelTest: () => void;
  onConfirmTest: () => void;
}) {
  const [srcJid, setSrcJid] = useState<number | "">("");
  const [dstJid, setDstJid] = useState<number | "">("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (testState.isActive && testState.route) {
      const arrivals = engine?.vehicles.filter(v => v.arrived && !v.isResource).length ?? 0;
      setStatus(`Route active. ${arrivals} vehicles arrived so far.`);
    }
  }, [testState, engine]);

  if (!testState.isActive) {
    return (
      <div className="bg-[#0d1118] border border-white/10 rounded-lg p-4 space-y-3 w-80">
        <div className="text-sm font-semibold text-white">Test Route Between Junctions</div>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-white/60 block mb-1">From Junction</label>
            <select
              value={srcJid}
              onChange={(e) => setSrcJid(e.target.value ? Number(e.target.value) : "")}
              className="w-full px-2 py-1.5 rounded text-sm bg-[#1a1f2e] text-white border border-white/20"
            >
              <option value="">— Select —</option>
              {allJunctions.map((j) => (
                <option key={j.jid} value={j.jid}>
                  J{j.jid} {j.name ? `(${j.name})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-white/60 block mb-1">To Junction</label>
            <select
              value={dstJid}
              onChange={(e) => setDstJid(e.target.value ? Number(e.target.value) : "")}
              className="w-full px-2 py-1.5 rounded text-sm bg-[#1a1f2e] text-white border border-white/20"
            >
              <option value="">— Select —</option>
              {allJunctions.map((j) => (
                <option key={j.jid} value={j.jid}>
                  J{j.jid} {j.name ? `(${j.name})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => {
              if (typeof srcJid === "number" && typeof dstJid === "number" && srcJid !== dstJid) {
                onStartTest(srcJid, dstJid);
                setSrcJid("");
                setDstJid("");
              }
            }}
            disabled={typeof srcJid !== "number" || typeof dstJid !== "number" || srcJid === dstJid}
            className="flex-1 px-3 py-1.5 rounded bg-[#3b82f6] text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
          >
            Start Test
          </button>
          <button
            onClick={onCancelTest}
            className="flex-1 px-3 py-1.5 rounded bg-white/10 text-white text-sm font-medium hover:bg-white/20"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0d1118] border border-[#3b82f6] rounded-lg p-4 space-y-3 w-80">
      <div className="text-sm font-semibold text-white">
        Route Test: J{testState.sourceJid} → J{testState.destJid}
      </div>
      <div className="text-xs text-white/70 bg-[#1a1f2e] rounded p-2">
        {status || "Injecting test vehicles..."}
      </div>
      {testState.route && (
        <div className="text-xs text-white/60">
          <div className="font-medium mb-1">Route:</div>
          <div className="bg-[#1a1f2e] rounded p-2 max-h-20 overflow-y-auto font-mono text-[10px]">
            {testState.route.join(" → ")}
          </div>
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onConfirmTest}
          className="flex-1 px-3 py-1.5 rounded bg-[#22c55e] text-black text-sm font-semibold hover:brightness-110"
        >
          ✓ Route Works
        </button>
        <button
          onClick={onCancelTest}
          className="flex-1 px-3 py-1.5 rounded bg-[#ef4444] text-white text-sm font-medium hover:brightness-110"
        >
          ✗ Failed
        </button>
      </div>
    </div>
  );
}
