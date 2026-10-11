"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { clockLabel } from "@/lib/opportunities/platform-style";

const ZONES = [
  { label: "New York", zone: "America/New_York" },
  { label: "Paris", zone: "Europe/Paris" },
] as const;

/** Upwork : heure à New York et à Paris, pour viser les matinées américaines. Rendue après montage (pas d'écart d'hydratation). */
export function WorldClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-3 font-data text-[12px]" aria-label="Heure à New York et à Paris">
      <Clock className="pf-ink h-3.5 w-3.5" aria-hidden />
      {ZONES.map(({ label, zone }) => (
        <span key={zone} className="text-muted">
          {label} <span className="pf-ink">{now ? clockLabel(zone, now) : "--:--"}</span>
        </span>
      ))}
    </div>
  );
}
