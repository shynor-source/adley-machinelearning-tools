import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Brand, LogoMark } from "./Brand";
import { Badge, Spinner, cn } from "./ui";
import { useAuth } from "../context/AuthContext";
import { useSession, useSessionSnapshot } from "../context/SessionContext";
import { TOOLS } from "../lib/tools";

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  soon,
  onClick,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  soon?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
          isActive
            ? "bg-white/[0.07] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]"
            : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "h-4 w-4 shrink-0 transition",
              isActive ? "text-mint-300" : "text-slate-500 group-hover:text-slate-300",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {soon ? (
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
              Soon
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function ActiveSessionCard({ onNavigate }: { onNavigate?: () => void }) {
  const { runtime } = useSession();
  const snapshot = useSessionSnapshot();
  if (!runtime || !snapshot?.config) return null;
  const handled = snapshot.counts.total - snapshot.counts.pending;
  const pct = snapshot.counts.total > 0 ? (handled / snapshot.counts.total) * 100 : 0;
  return (
    <Link
      to="/labeling/workspace"
      onClick={onNavigate}
      className="group mx-3 mb-2 block rounded-xl border border-mint-400/15 bg-gradient-to-br from-mint-400/[0.08] to-sky-400/[0.03] p-3.5 transition hover:border-mint-300/30"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-70",
              snapshot.status === "complete" ? "bg-sky-400" : "animate-ping bg-mint-400",
            )}
          />
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              snapshot.status === "complete" ? "bg-sky-400" : "bg-mint-400",
            )}
          />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint-300/80">
          {snapshot.status === "loading"
            ? "Restoring"
            : snapshot.status === "complete"
              ? "Complete"
              : snapshot.paused
                ? "Paused"
                : "Active session"}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-white">{snapshot.config.name}</p>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span className="capitalize">
          {snapshot.config.outputMode === "flat" ? "Flat by class" : "Full mirror"}
        </span>
        <span>
          {handled.toLocaleString()} / {snapshot.counts.total.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/30">
        <div
          className="h-full rounded-full bg-gradient-to-r from-mint-400 to-sky-400 transition-[width]"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </Link>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { runtime, closeSession } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      if (runtime) await closeSession();
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-950 text-slate-200">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-ink-950/75 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-white/[0.06] bg-ink-900/95 backdrop-blur-xl transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-20 items-center justify-between px-5">
          <Link to="/" className="min-w-0">
            <Brand />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <div className="space-y-1">
            <NavItem to="/" label="Overview" icon={LayoutDashboard} end />
            <NavItem to="/labeling/new" label="New session" icon={PlusCircle} />
            <NavItem to="/labeling/sessions" label="Resume session" icon={FolderOpen} />
          </div>

          <div className="mt-7 px-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              Tools
            </p>
          </div>
          <div className="mt-2 space-y-1">
            {TOOLS.map((tool) => (
              <NavItem
                key={tool.id}
                to={`/tools/${tool.id}`}
                label={tool.name}
                icon={tool.icon}
                soon={!tool.available}
              />
            ))}
          </div>

          <div className="mt-7">
            <ActiveSessionCard onNavigate={() => setMobileOpen(false)} />
          </div>

          <div className="mx-3 mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-mint-400/80" />
              Files stay on your device
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-slate-600">
              The server authenticates access only. Images, labels, and checkpoints never leave
              your selected folders.
            </p>
          </div>
        </nav>

        <div className="border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-xs font-semibold text-mint-300">
              {user?.username.slice(0, 2).toUpperCase() ?? "AD"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">
                {user?.username ?? "Team account"}
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Signed in</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-rose-300 disabled:opacity-50"
              aria-label="Sign out"
              title="Sign out"
            >
              {loggingOut ? <Spinner className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[280px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/[0.06] bg-ink-950/85 px-4 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-300 transition hover:bg-white/[0.08]"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/">
            <Brand compact />
          </Link>
          <div className="ml-auto">
            <LogoMark className="h-8 w-8" />
          </div>
        </header>

        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
