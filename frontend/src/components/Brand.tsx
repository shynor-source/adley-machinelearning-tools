export function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-mint-400/20 via-ink-800 to-sky-500/10 ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" className="h-2/3 w-2/3">
        <defs>
          <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6ee7b7" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <path
          d="M8 24 14.4 8h3.2L24 24h-4l-1.3-3.7h-5.4L12 24H8Zm6.8-7.1h2.4L16 12.8l-1.2 4.1Z"
          fill="url(#brand-gradient)"
        />
        <circle cx="25" cy="7" r="2" fill="#6ee7b7" />
      </svg>
    </div>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark className={compact ? "h-9 w-9" : "h-11 w-11"} />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold tracking-tight text-white">
          Adley ML Tools
        </p>
        {!compact ? (
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Local-first workspace
          </p>
        ) : null}
      </div>
    </div>
  );
}
