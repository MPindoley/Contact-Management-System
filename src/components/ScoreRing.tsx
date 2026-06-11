// SVG donut for service scores, color-graded green / yellow / red.

import { scoreColor, type ScoreColor } from "../engine/serviceEngine";

const RING_COLORS: Record<ScoreColor, string> = {
  green: "stroke-pine-500",
  yellow: "stroke-amber-400",
  red: "stroke-clay-500",
};

interface ScoreRingProps {
  value: number | null;
  size?: number;
  strokeWidth?: number;
  caption?: string;
}

export function ScoreRing({ value, size = 120, strokeWidth = 10, caption }: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);
  const colorClass = value === null ? "stroke-stone-300" : RING_COLORS[scoreColor(value)];

  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-stone-200"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${colorClass} transition-[stroke-dashoffset] duration-700 ease-out`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="tnum font-display font-semibold text-ink"
            style={{ fontSize: size * 0.26 }}
          >
            {value === null ? "—" : `${value}%`}
          </span>
        </div>
      </div>
      {caption && <span className="text-xs font-medium text-ink-soft">{caption}</span>}
    </div>
  );
}
