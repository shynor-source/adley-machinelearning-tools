import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  FolderOpen,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Tags,
} from "lucide-react";
import { Badge, SectionLabel } from "../components/ui";
import { findTool } from "../lib/tools";
import { NotFoundPage } from "./NotFoundPage";

const CLASSIFICATION_POINTS = [
  "Recursive scan across nested source folders",
  "Flat-by-class results by default, full mirror optional",
  "Collision-safe filenames with an exact destination map",
  "Checkpoint files in the result folder for crash-safe resume",
  "Pause, resume, skip, undo, and retry failed copies",
  "Only a few previews decoded at a time; suitable for 5 GB+ datasets",
];

const PLANNED_POINTS = [
  "Designed to run locally in the browser",
  "No dataset uploads or server-side storage",
  "Will share the same checkpoint and resume model",
];

export function ToolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tool = id ? findTool(id) : undefined;

  if (!tool) return <NotFoundPage />;

  const Icon = tool.icon;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link to="/" className="transition hover:text-slate-300">
          Overview
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span>{tool.name}</span>
      </div>

      <section className="relative mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-900">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(52,211,153,.12),transparent_38%),radial-gradient(circle_at_90%_90%,rgba(56,189,248,.09),transparent_45%)]" />
        <div className="relative grid gap-8 p-6 sm:p-9 lg:grid-cols-[1fr_320px] lg:items-center">
          <div>
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
                tool.available
                  ? "border-mint-400/20 bg-mint-400/10 text-mint-300"
                  : "border-white/10 bg-white/[0.04] text-slate-400"
              }`}
            >
              <Icon className="h-6 w-6" />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
                {tool.name}
              </h1>
              <Badge tone={tool.available ? "mint" : "neutral"}>
                {tool.available ? "Available now" : tool.estimated ?? "Planned"}
              </Badge>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-400">{tool.description}</p>

            {tool.available ? (
              <div className="mt-7 flex flex-wrap gap-2">
                <Link
                  to="/labeling/new"
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-mint-400 px-5 text-sm font-semibold text-ink-950 shadow-[0_16px_40px_-18px_rgba(52,211,153,.8)] transition hover:bg-mint-300"
                >
                  <PlusCircle className="h-4 w-4" />
                  New session
                </Link>
                <Link
                  to="/labeling/sessions"
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                >
                  <FolderOpen className="h-4 w-4" />
                  Resume session
                </Link>
              </div>
            ) : (
              <div className="mt-7">
                <Link
                  to="/labeling/new"
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                >
                  <Tags className="h-4 w-4" />
                  Use image classification today
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-ink-950/45 p-5">
            <p className="flex items-center gap-2 text-xs font-medium text-slate-300">
              {tool.available ? (
                <Sparkles className="h-3.5 w-3.5 text-mint-300" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-slate-500" />
              )}
              {tool.available ? "Ready for local folders" : "On the roadmap"}
            </p>
            <ul className="mt-4 space-y-2.5">
              {(tool.available ? CLASSIFICATION_POINTS : PLANNED_POINTS).map((point) => (
                <li key={point} className="flex items-start gap-2 text-[11px] leading-5 text-slate-500">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-mint-400/70" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-start gap-2 border-t border-white/[0.06] pt-4 text-[10px] leading-4 text-slate-600">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-mint-400/60" />
              Images never leave the device; the server only authenticates access.
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
        <SectionLabel>How it works</SectionLabel>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: tool.available ? "Connect" : "Design",
              text: tool.available
                ? "Choose a source folder of images and a writable result folder in Chrome or Edge."
                : "The interaction model is being designed around local file access.",
            },
            {
              title: "Preview",
              text: tool.available
                ? "The recursive scan shows counts, sizes, and a sample of destination paths before copying."
                : "Output format and review flow will be documented before release.",
            },
            {
              title: tool.available ? "Label" : "Ship",
              text: tool.available
                ? "Label with keyboard shortcuts. Copies and checkpoint events are written as you go."
                : "Planned after the classification workflow is fully hardened.",
            },
          ].map((step, index) => (
            <div
              key={step.title}
              className="rounded-xl border border-white/[0.06] bg-ink-950/35 p-4"
            >
              <span className="font-mono text-[10px] text-slate-600">0{index + 1}</span>
              <p className="mt-2 text-sm font-medium text-slate-200">{step.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 text-xs text-slate-500 transition hover:text-slate-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to overview
      </Link>
    </div>
  );
}
