import {
  useEffect,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-mint-400 text-ink-950 shadow-[0_12px_32px_-14px_rgba(52,211,153,.7)] hover:bg-mint-300 active:bg-mint-500",
  secondary:
    "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-white/20 hover:bg-white/[0.08]",
  ghost: "text-slate-300 hover:bg-white/[0.06] hover:text-white",
  danger:
    "border border-rose-400/25 bg-rose-400/10 text-rose-200 hover:border-rose-300/40 hover:bg-rose-400/15",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 gap-2 rounded-lg px-3 text-sm",
  md: "h-11 gap-2 rounded-xl px-4 text-sm font-medium",
  lg: "h-12 gap-2.5 rounded-xl px-5 text-sm font-semibold",
  icon: "h-10 w-10 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

type BadgeTone = "neutral" | "mint" | "amber" | "rose" | "sky" | "violet";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-slate-300",
  mint: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  rose: "border-rose-400/20 bg-rose-400/10 text-rose-300",
  sky: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  violet: "border-violet-400/20 bg-violet-400/10 text-violet-300",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-mint-300", className)} aria-hidden="true" />;
}

export function ProgressBar({
  value,
  total,
  className,
  tone = "mint",
  indeterminate = false,
}: {
  value?: number;
  total?: number;
  className?: string;
  tone?: "mint" | "sky" | "amber" | "rose";
  indeterminate?: boolean;
}) {
  const pct =
    value === undefined || !total || total <= 0
      ? 0
      : Math.max(0, Math.min(100, (value / total) * 100));
  const toneClass =
    tone === "sky"
      ? "bg-sky-400"
      : tone === "amber"
        ? "bg-amber-400"
        : tone === "rose"
          ? "bg-rose-400"
          : "bg-mint-400";
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      {indeterminate ? (
        <div className="h-full w-1/3 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-gradient-to-r from-transparent via-mint-300 to-transparent bg-[length:200%_100%]" />
      ) : (
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", toneClass)}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/10 bg-white/[0.06] px-1.5 font-mono text-[10px] font-semibold text-slate-400">
      {children}
    </kbd>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      {children}
    </p>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-ink-950/80 backdrop-blur-sm"
        aria-label="Close dialog"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-md animate-fade-up rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl"
      >
        <div className="flex items-start gap-4">
          {danger ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-white">
              {title}
            </h2>
            <div className="mt-2 text-sm leading-6 text-slate-400">{description}</div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NoticeBanner({
  tone = "rose",
  title,
  children,
  onDismiss,
  action,
}: {
  tone?: "rose" | "amber" | "sky" | "mint";
  title: string;
  children?: ReactNode;
  onDismiss?: () => void;
  action?: ReactNode;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-100"
      : tone === "sky"
        ? "border-sky-400/20 bg-sky-400/[0.06] text-sky-100"
        : tone === "mint"
          ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100"
          : "border-rose-400/20 bg-rose-400/[0.06] text-rose-100";
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", toneClass)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-white">{title}</p>
        {children ? <div className="mt-0.5 opacity-80">{children}</div> : null}
      </div>
      {action}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 opacity-60 transition hover:bg-white/10 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
