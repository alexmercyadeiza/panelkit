interface Props {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    label: string;
  };
  bars?: number[];
}

export function MetricCard({ label, value, subtitle, trend, bars }: Props) {
  const maxBar = bars ? Math.max(...bars, 1) : 1;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            {label}
          </span>
          <span className="text-2xl font-semibold text-white font-mono-code leading-none">
            {value}
          </span>
          {subtitle && (
            <span className="text-xs text-zinc-500 mt-0.5">{subtitle}</span>
          )}
        </div>

        {trend && (
          <span
            className={`
              inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-medium font-mono-code shrink-0
              ${
                trend.value > 0
                  ? "bg-emerald-500/10 text-emerald-400"
                  : trend.value < 0
                  ? "bg-red-500/10 text-red-400"
                  : "bg-zinc-800 text-zinc-400"
              }
            `}
          >
            {trend.value > 0 && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            )}
            {trend.value < 0 && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
            {trend.value > 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </span>
        )}
      </div>

      {bars && bars.length > 0 && (
        <div className="flex items-end gap-[3px] h-8 mt-1">
          {bars.map((bar, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-blue-500/30 min-w-0 transition-all duration-300"
              style={{
                height: `${Math.max((bar / maxBar) * 100, 4)}%`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
