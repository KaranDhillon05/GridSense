"use client";

export function Legend() {
  return (
    <div className="rounded-xl border border-white/10 bg-[#11151d]/90 p-3 text-white/70 text-[10px]">
      <div className="font-semibold text-white/80 text-xs mb-2">Legend</div>
      <div className="grid grid-cols-2 gap-y-1 gap-x-3">
        <Row color="#22c55e" label="Free flow" line />
        <Row color="#eab308" label="Building" line />
        <Row color="#f97316" label="Heavy" line />
        <Row color="#ef4444" label="Congested" line />
        <Row color="#7f1d1d" label="Blocked / closed" line />
        <Row color="#22d3ee" label="Diversion route" line />
        <Row color="#9ca3af" label="Car" />
        <Row color="#fbbf24" label="Auto" />
        <Row color="#38bdf8" label="Bus" />
        <Row color="#a78bfa" label="Truck" />
        <Row color="#ffffff" label="Ambulance" />
        <Row color="#f97316" label="Tow / recovery" />
      </div>
    </div>
  );
}

function Row({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {line ? (
        <span className="inline-block w-4 h-1 rounded" style={{ background: color }} />
      ) : (
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      )}
      <span>{label}</span>
    </div>
  );
}
