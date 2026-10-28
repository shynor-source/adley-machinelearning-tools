import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Compass, LayoutDashboard } from "lucide-react";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-500">
        <Compass className="h-6 w-6" />
      </div>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-600">
        404 · not found
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
        This page does not exist.
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
        The link may be outdated, or the tool may not be available in this workspace yet.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          to="/"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-mint-400 px-5 text-sm font-semibold text-ink-950 transition hover:bg-mint-300"
        >
          <LayoutDashboard className="h-4 w-4" />
          Back to overview
        </Link>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-white transition hover:bg-white/[0.08]"
        >
          <ArrowLeft className="h-4 w-4" />
          Go back
        </button>
      </div>
    </div>
  );
}
