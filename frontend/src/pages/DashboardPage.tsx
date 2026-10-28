import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  FolderOpen,
  HardDrive,
  Layers,
  Play,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Tags,
} from "lucide-react";
import { Badge, ProgressBar, cn } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useSessionSnapshot } from "../context/SessionContext";
import { TOOLS } from "../lib/tools";
import { formatDate, formatNumber } from "../lib/path";

export function DashboardPage() {
  const { user } = useAuth();
  const snapshot = useSessionSnapshot();
  const activeConfig = snapshot?.config ?? null;
  const active =
    snapshot && activeConfig ? { ...snapshot, config: activeConfig } : null;
  const handled = active ? active.counts.total - active.counts.pending : 0;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Workspace overview
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Welcome back{user ? `, ${user.username.split("_")[0]}` : ""}.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Build local training sets without uploading a single image. Start a classification
            session or reconnect an existing checkpoint.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          Local-first mode
        </div>
      </div>

      <section className="relative mt-8 overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-900">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(52,211,153,.16),transparent_38%),radial-gradient(circle_at_92%_80%,rgba(56,189,248,.12),transparent_40%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.15fr_.85fr] lg:p-10">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-mint-400/20 bg-mint-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-mint-300">
              <Sparkles className="h-3.5 w-3.5" />
              Image classification
            </div>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-4xl">
              Turn nested image folders into a clean, labeled dataset.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-400">
              Scan once, preview the destination layout, then label with large image previews and
              keyboard shortcuts. Copies are uniquely named, checksummed by size, and checkpointed
              as you go.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/labeling/new"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-mint-400 px-5 text-sm font-semibold text-ink-950 shadow-[0_16px_40px_-18px_rgba(52,211,153,.8)] transition hover:bg-mint-300"
              >
                <PlusCircle className="h-4 w-4" />
                New labeling session
              </Link>
              <Link
                to="/labeling/sessions"
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-white transition hover:bg-white/[0.08]"
              >
                <FolderOpen className="h-4 w-4" />
                Resume from checkpoint
              </Link>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
              {[
                "Flat by class by default",
                "Full mirror optional",
                "Originals are never changed",
              ].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-mint-400" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            {active ? (
              <div className="rounded-2xl border border-white/10 bg-ink-950/55 p-5 shadow-panel backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-mint-300">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute h-full w-full animate-ping rounded-full bg-mint-400 opacity-70" />
                        <span className="relative h-2 w-2 rounded-full bg-mint-400" />
                      </span>
                      {active.status === "loading"
                        ? "Restoring checkpoint"
                        : active.status === "complete"
                          ? "Session complete"
                          : active.paused
                            ? "Session paused"
                            : "Session in progress"}
                    </div>
                    <p className="mt-2 truncate text-lg font-semibold text-white">
                      {active.config.name}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {active.config.sourceName} → {active.config.resultName}
                    </p>
                  </div>
                  <Badge tone={active.config.outputMode === "flat" ? "mint" : "sky"}>
                    {active.config.outputMode === "flat" ? "Flat" : "Mirror"}
                  </Badge>
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                    <span>{formatNumber(handled)} handled</span>
                    <span>{formatNumber(active.counts.total)} total</span>
                  </div>
                  <ProgressBar value={handled} total={active.counts.total} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                    <p className="text-sm font-semibold text-white">
                      {formatNumber(active.counts.copied)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-600">Copied</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                    <p className="text-sm font-semibold text-white">
                      {formatNumber(active.counts.pending)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-600">Pending</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        active.counts.failed > 0 ? "text-rose-300" : "text-white",
                      )}
                    >
                      {formatNumber(active.counts.failed)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-600">Failed</p>
                  </div>
                </div>
                <Link
                  to="/labeling/workspace"
                  className="mt-4 flex h-10 items-center justify-center gap-2 rounded-xl bg-white/[0.07] text-sm font-medium text-white transition hover:bg-white/[0.11]"
                >
                  {active.status === "complete" ? "Review session" : "Continue labeling"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-ink-950/55 p-5 shadow-panel backdrop-blur">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Three-step workflow
                </p>
                <div className="mt-4 space-y-3">
                  {[
                    {
                      icon: FolderOpen,
                      title: "Connect folders",
                      text: "Choose a source folder and a result folder.",
                    },
                    {
                      icon: Tags,
                      title: "Preview and label",
                      text: "See the destination layout before copying.",
                    },
                    {
                      icon: ShieldCheck,
                      title: "Resume safely",
                      text: "Checkpoints live in the result folder.",
                    },
                  ].map((step, index) => (
                    <div
                      key={step.title}
                      className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[11px] font-semibold text-mint-300">
                        0{index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-200">{step.title}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-500">{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Toolbox
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">Machine learning tools</h2>
          </div>
          <span className="text-xs text-slate-600">More tools are being prepared</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((tool) => (
            <Link
              key={tool.id}
              to={`/tools/${tool.id}`}
              className={cn(
                "group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 transition",
                tool.available
                  ? "hover:-translate-y-0.5 hover:border-mint-400/25 hover:bg-white/[0.045]"
                  : "opacity-70 hover:border-white/10 hover:bg-white/[0.035]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl border",
                    tool.available
                      ? "border-mint-400/20 bg-mint-400/10 text-mint-300"
                      : "border-white/[0.07] bg-white/[0.035] text-slate-500",
                  )}
                >
                  <tool.icon className="h-5 w-5" />
                </div>
                <Badge tone={tool.available ? "mint" : "neutral"}>
                  {tool.available ? "Available" : tool.estimated}
                </Badge>
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{tool.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{tool.description}</p>
              <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-500 transition group-hover:text-slate-300">
                {tool.available ? "Open tool" : "View details"}
                <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-3">
        {[
          {
            icon: HardDrive,
            title: "Files never upload",
            text: "The browser reads and copies files from folders you choose. The server only serves the app and authenticates the team.",
          },
          {
            icon: Layers,
            title: "Flat or full mirror",
            text: "Flat by class is the default. Full mirror keeps every source directory and places each class folder beside its images.",
          },
          {
            icon: Clock,
            title: "Checkpoint based",
            text: "Session, manifest, destination map, and copy progress are saved as JSON files in the result folder. Nothing is stored in a database.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
          >
            <item.icon className="h-4 w-4 text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-200">{item.title}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{item.text}</p>
          </div>
        ))}
      </section>

      {active?.config ? (
        <p className="mt-8 flex items-center gap-2 text-xs text-slate-600">
          <Play className="h-3 w-3" />
          Last checkpoint activity {formatDate(active.config.updatedAt)} · keep the labeling tab
          open while copies run.
        </p>
      ) : null}
    </div>
  );
}
