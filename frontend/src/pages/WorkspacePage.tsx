import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  FolderOpen,
  ImageOff,
  Info,
  Keyboard,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Tags,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Kbd,
  NoticeBanner,
  ProgressBar,
  SectionLabel,
  Spinner,
  cn,
} from "../components/ui";
import { useSession, useSessionSnapshot } from "../context/SessionContext";
import { classColor } from "../lib/class-colors";
import { getFileAt } from "../lib/fs";
import { errorMessage, formatBytes, formatNumber } from "../lib/path";
import { renderPreview } from "../lib/preview";
import type { SessionRuntime } from "../lib/session";
import type { ClassDefinition, ImageStatus, ManifestImage } from "../lib/types";

const PREVIEW_CACHE_LIMIT = 4;
const MAX_SHORTCUT_CLASSES = 20;

interface LoadedPreview {
  path: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

function shortcutLabel(index: number): string {
  if (index < 9) return String(index + 1);
  if (index === 9) return "0";
  if (index === 19) return "⇧0";
  return `⇧${index - 9}`;
}

function statusBadge(status: ImageStatus | undefined) {
  switch (status) {
    case "preparing":
      return <Badge tone="violet">Preparing copy</Badge>;
    case "copying":
      return <Badge tone="sky">Copying</Badge>;
    case "copied":
      return <Badge tone="mint">Copied</Badge>;
    case "skipped":
      return <Badge tone="neutral">Skipped</Badge>;
    case "failed":
      return <Badge tone="rose">Failed</Badge>;
    default:
      return <Badge tone="neutral">Unlabeled</Badge>;
  }
}

/**
 * Decodes the active image and prefetches a couple of upcoming images. The
 * cache is tiny and bitmaps are closed on eviction/unmount, so memory use is
 * bounded even for folders with very large images.
 */
function usePreview(runtime: SessionRuntime | null, image: ManifestImage | null) {
  const [preview, setPreview] = useState<LoadedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, LoadedPreview>());
  const inflight = useRef(new Map<string, Promise<LoadedPreview>>());
  const requestId = useRef(0);
  const visiblePath = useRef<string | null>(null);
  const disposed = useRef(false);

  const remember = useCallback((loaded: LoadedPreview, keepPath: string | null) => {
    if (disposed.current) {
      loaded.bitmap.close();
      return;
    }
    const existing = cache.current.get(loaded.path);
    if (existing && existing.bitmap !== loaded.bitmap) existing.bitmap.close();
    cache.current.delete(loaded.path);
    cache.current.set(loaded.path, loaded);
    while (cache.current.size > PREVIEW_CACHE_LIMIT) {
      const oldest = cache.current.entries().next().value as
        | [string, LoadedPreview]
        | undefined;
      if (!oldest) break;
      const [key, value] = oldest;
      if (key === keepPath) {
        cache.current.delete(key);
        cache.current.set(key, value);
        continue;
      }
      cache.current.delete(key);
      value.bitmap.close();
    }
  }, []);

  const load = useCallback(
    async (target: ManifestImage): Promise<LoadedPreview> => {
      const cached = cache.current.get(target.path);
      if (cached) return cached;
      const pending = inflight.current.get(target.path);
      if (pending) return pending;
      const promise = (async () => {
        if (!runtime) throw new Error("The session is not open.");
        const handle = await getFileAt(runtime.source, target.path);
        const file = await handle.getFile();
        const decoded = await renderPreview(file);
        return {
          path: target.path,
          bitmap: decoded.bitmap,
          width: decoded.width,
          height: decoded.height,
        };
      })();
      inflight.current.set(target.path, promise);
      try {
        const loaded = await promise;
        remember(loaded, visiblePath.current);
        return loaded;
      } finally {
        inflight.current.delete(target.path);
      }
    },
    [runtime, remember],
  );

  useEffect(() => {
    setPreview(null);
    setError(null);
    setLoading(false);
    visiblePath.current = image?.path ?? null;
    if (!runtime || !image) return;
    let cancelled = false;
    const id = ++requestId.current;
    const cached = cache.current.get(image.path);
    if (cached) {
      setPreview(cached);
    } else {
      setLoading(true);
      void load(image)
        .then((loaded) => {
          if (cancelled || requestId.current !== id) return;
          setPreview(loaded);
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (cancelled || requestId.current !== id) return;
          setError(errorMessage(reason));
          setLoading(false);
        });
    }

    for (const upcoming of runtime.peekUpcoming(3)) {
      if (upcoming.path === image.path) continue;
      if (cache.current.has(upcoming.path) || inflight.current.has(upcoming.path)) continue;
      void load(upcoming).catch(() => {
        // Prefetch failures are reported only when the image reaches the front.
      });
    }

    return () => {
      cancelled = true;
    };
  }, [runtime, image, load]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      requestId.current += 1;
      for (const loaded of cache.current.values()) loaded.bitmap.close();
      cache.current.clear();
    };
  }, [runtime]);

  return { preview, error, loading };
}

function PreviewCanvas({ preview }: { preview: LoadedPreview | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    canvas.width = preview.width;
    canvas.height = preview.height;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    context?.drawImage(preview.bitmap, 0, 0);
  }, [preview]);

  return (
    <canvas
      ref={canvasRef}
      className="max-h-[calc(100vh-310px)] max-w-full rounded-lg object-contain shadow-[0_24px_80px_-30px_rgba(0,0,0,.9)]"
      aria-label="Current image preview"
    />
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "rose" | "mint";
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-center">
      <p
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "rose" ? "text-rose-300" : tone === "mint" ? "text-mint-300" : "text-white",
        )}
      >
        {formatNumber(value)}
      </p>
      <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600">
        {label}
      </p>
    </div>
  );
}

export function WorkspacePage() {
  const navigate = useNavigate();
  const { runtime, closeSession } = useSession();
  const snapshot = useSessionSnapshot();
  const [actionError, setActionError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const config = snapshot?.config ?? null;
  const classes = useMemo<ClassDefinition[]>(() => config?.classes ?? [], [config]);
  const current = snapshot?.current ?? null;
  const currentState = snapshot?.currentState ?? null;
  const { preview, error: previewError, loading: previewLoading } = usePreview(runtime, current);

  const classIndexById = useMemo(() => {
    const map = new Map<string, number>();
    classes.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [classes]);

  const paused = snapshot?.paused ?? false;
  const ready = snapshot?.status === "ready";
  const complete = snapshot?.status === "complete";
  const loading = snapshot?.status === "loading";
  const fatal = snapshot?.status === "error";
  const busy = snapshot?.busy ?? false;
  const canLabel = ready && !paused && !busy && Boolean(current);
  const canSkip = canLabel;
  const canUndo =
    (ready || complete) &&
    !busy &&
    (snapshot?.canUndo ?? false) &&
    (snapshot?.counts.labeled ?? 0) + (snapshot?.counts.skipped ?? 0) > 0;
  const handled = snapshot ? snapshot.counts.total - snapshot.counts.pending : 0;

  useEffect(() => {
    if (!runtime || complete || fatal) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [runtime, complete, fatal]);

  const handleLabel = useCallback(
    async (classId: string) => {
      if (!runtime || !canLabel) return;
      setActionError(null);
      try {
        await runtime.label(classId);
      } catch (reason) {
        setActionError(errorMessage(reason));
      }
    },
    [runtime, canLabel],
  );

  const handleSkip = useCallback(() => {
    if (!runtime || !canSkip) return;
    setActionError(null);
    runtime.skip();
  }, [runtime, canSkip]);

  const handleUndo = useCallback(() => {
    if (!runtime || !canUndo) return;
    setActionError(null);
    void runtime.undo().catch((reason: unknown) => setActionError(errorMessage(reason)));
  }, [runtime, canUndo]);

  const togglePause = useCallback(() => {
    if (!runtime || loading || complete || fatal) return;
    if (paused) runtime.resume();
    else runtime.pause();
  }, [runtime, paused, loading, complete, fatal]);

  const handleRetryFailures = useCallback(() => {
    if (!runtime) return;
    setActionError(null);
    void runtime.retryFailed().catch((reason: unknown) => setActionError(errorMessage(reason)));
  }, [runtime]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (closeOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        setShortcutsOpen(false);
        return;
      }
      if (event.repeat || event.defaultPrevented) return;
      if (event.key === " " || event.key.toLowerCase() === "p") {
        event.preventDefault();
        togglePause();
        return;
      }
      if (event.key.toLowerCase() === "s" || event.key === "ArrowRight") {
        event.preventDefault();
        handleSkip();
        return;
      }
      if (event.key.toLowerCase() === "u") {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((value) => !value);
        return;
      }
      const digitMatch = /^Digit([0-9])$/.exec(event.code);
      if (!digitMatch) return;
      const digit = Number(digitMatch[1]);
      const index = event.shiftKey
        ? digit === 0
          ? 19
          : 9 + digit
        : digit === 0
          ? 9
          : digit - 1;
      if (index < 0 || index >= classes.length || index >= MAX_SHORTCUT_CLASSES) return;
      event.preventDefault();
      void handleLabel(classes[index].id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    classes,
    closeOpen,
    handleLabel,
    handleSkip,
    handleUndo,
    togglePause,
  ]);

  async function handleCloseSession() {
    if (closing) return;
    setClosing(true);
    try {
      await closeSession();
      navigate("/");
    } finally {
      setClosing(false);
      setCloseOpen(false);
    }
  }

  if (!runtime || !snapshot || !config) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-500">
          <Tags className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">No active labeling session</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
          Start a new session or reconnect a checkpoint from a result folder. File handles cannot
          be restored after a page reload without choosing the folders again.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            to="/labeling/new"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-mint-400 px-5 text-sm font-semibold text-ink-950 transition hover:bg-mint-300"
          >
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
      </div>
    );
  }

  const notice = snapshot.notice;
  const failures = snapshot.failures;
  const position = snapshot.position;

  if (loading) {
    const reconcile = snapshot.reconcile;
    const reconcilePercent =
      reconcile && reconcile.total > 0 ? (reconcile.done / reconcile.total) * 100 : 0;
    return (
      <div className="mx-auto flex min-h-[75vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-mint-400/20 bg-mint-400/10">
          <Spinner className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">Restoring checkpoint</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Verifying previously labeled copies before labeling resumes. This does not relabel any
          completed image.
        </p>
        <div className="mt-6 w-full max-w-sm">
          <ProgressBar
            value={reconcile?.done}
            total={reconcile?.total}
            indeterminate={!reconcile || reconcile.total === 0}
          />
          <p className="mt-2 text-xs text-slate-600">
            {reconcile && reconcile.total > 0
              ? `${formatNumber(reconcile.done)} / ${formatNumber(reconcile.total)} copies verified · ${reconcilePercent.toFixed(0)}%`
              : "Reading session manifest and progress…"}
          </p>
        </div>
        <p className="mt-6 max-w-sm text-[11px] leading-5 text-slate-600">
          {config.name} · {formatNumber(config.totalImages)} images · {config.sourceName} →{" "}
          {config.resultName}
        </p>
      </div>
    );
  }

  if (fatal) {
    return (
      <div className="mx-auto flex min-h-[75vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/10 text-rose-300">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">The session could not be restored</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{snapshot.error}</p>
        <p className="mt-3 max-w-md text-xs leading-5 text-slate-600">
          The checkpoint itself is still in the result folder. Check folder permissions, then try
          resuming again.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => void handleCloseSession()}>
            Close session
          </Button>
          <Button onClick={() => navigate("/labeling/sessions")}>
            <RotateCcw className="h-4 w-4" />
            Resume another checkpoint
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link to="/" className="transition hover:text-slate-300">
              Overview
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="truncate">{config.name}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="max-w-xl truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {config.name}
            </h1>
            <Badge tone={config.outputMode === "flat" ? "mint" : "sky"}>
              {config.outputMode === "flat" ? "Flat by class" : "Full mirror"}
            </Badge>
            {paused ? <Badge tone="amber">Paused</Badge> : null}
            {complete ? <Badge tone="sky">Complete</Badge> : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-600">
            {config.sourceName} <span className="text-slate-700">→</span> {config.resultName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CheckpointStatus
            status={snapshot.checkpointStatus}
            error={snapshot.checkpointError}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={togglePause}
            disabled={complete || loading}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCloseOpen(true)}
          >
            <X className="h-3.5 w-3.5" />
            Close session
          </Button>
        </div>
      </header>

      {actionError ? (
        <div className="mt-4">
          <NoticeBanner tone="rose" title="Action failed" onDismiss={() => setActionError(null)}>
            {actionError}
          </NoticeBanner>
        </div>
      ) : null}

      {notice ? (
        <div className="mt-4">
          <NoticeBanner
            tone={notice.kind === "error" ? "rose" : "sky"}
            title={notice.kind === "error" ? "Session warning" : "Session update"}
            onDismiss={() => runtime.clearNotice()}
          >
            {notice.text}
          </NoticeBanner>
        </div>
      ) : null}

      {complete ? (
        <CompletionPanel
          total={snapshot.counts.total}
          copied={snapshot.counts.copied}
          skipped={snapshot.counts.skipped}
          failed={snapshot.counts.failed}
          retrying={busy}
          canUndo={canUndo}
          onRetryFailed={handleRetryFailures}
          onUndo={handleUndo}
          onNew={() => {
            void closeSession().then(() => navigate("/labeling/new"));
          }}
          onResumeAnother={() => {
            void closeSession().then(() => navigate("/labeling/sessions"));
          }}
          onOverview={() => {
            void closeSession().then(() => navigate("/"));
          }}
        />
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <ImageIcon className="h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0">
                    <p className="max-w-[52vw] truncate text-sm font-medium text-slate-200">
                      {current?.name ?? "No pending image"}
                    </p>
                    <p className="max-w-[52vw] truncate font-mono text-[10px] text-slate-600">
                      {current?.dir === "." ? "source root" : current?.dir}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {currentState ? statusBadge(currentState.status) : null}
                  <span className="font-mono text-[10px] text-slate-600">
                    {formatNumber(position)} / {formatNumber(snapshot.counts.total)}
                  </span>
                </div>
              </div>

              <div className="relative flex min-h-[300px] items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,.045),transparent_65%)] p-4">
                {preview ? (
                  <PreviewCanvas preview={preview} />
                ) : previewError ? (
                  <div className="flex max-w-md flex-col items-center px-6 py-14 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-rose-400/15 bg-rose-400/10 text-rose-300">
                      <ImageOff className="h-5 w-5" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-slate-200">
                      This image could not be previewed
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{previewError}</p>
                    <p className="mt-3 text-[11px] leading-5 text-slate-600">
                      You can still skip it. If copies fail, the source file may have moved or the
                      folder may be disconnected.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={handleSkip}
                      disabled={!canSkip}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip this image
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-16 text-slate-600">
                    <Spinner className="h-6 w-6" />
                    <p className="mt-3 text-xs">
                      {previewLoading ? "Decoding preview…" : "Loading image…"}
                    </p>
                  </div>
                )}

                {paused ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink-950/75 backdrop-blur-sm">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
                      <Pause className="h-5 w-5" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white">Labeling paused</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Copies already queued will finish, but no new labels are accepted.
                    </p>
                    <Button size="sm" className="mt-4" onClick={() => runtime.resume()}>
                      <Play className="h-3.5 w-3.5" />
                      Resume labeling
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600">
                  <span>
                    {preview ? `${preview.width} × ${preview.height}px` : "—"}
                  </span>
                  <span>{current ? formatBytes(current.size) : "—"}</span>
                  {snapshot.activeCopies > 0 ? (
                    <span className="inline-flex items-center gap-1 text-sky-300/80">
                      <Copy className="h-3 w-3" />
                      {snapshot.activeCopies} copy task{snapshot.activeCopies === 1 ? "" : "s"} active
                    </span>
                  ) : null}
                  {snapshot.cleanupCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-amber-300/80">
                      <Clock className="h-3 w-3" />
                      cleaning up {snapshot.cleanupCount} undone cop
                      {snapshot.cleanupCount === 1 ? "y" : "ies"}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUndo}
                    disabled={!canUndo}
                    title="Undo last label or skip (Ctrl+Z)"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Undo
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSkip}
                    disabled={!canSkip}
                    title="Skip this image (S)"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                    Skip
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-300">
                    {handled.toLocaleString()} of {snapshot.counts.total.toLocaleString()} handled
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    {snapshot.counts.pending.toLocaleString()} images remaining in the queue
                  </p>
                </div>
                <span className="font-mono text-[11px] text-slate-500">
                  {snapshot.counts.total > 0
                    ? `${((handled / snapshot.counts.total) * 100).toFixed(1)}%`
                    : "0%"}
                </span>
              </div>
              <ProgressBar
                className="mt-2.5"
                value={handled}
                total={snapshot.counts.total}
                tone={snapshot.counts.failed > 0 ? "amber" : "mint"}
              />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Copied" value={snapshot.counts.copied} tone="mint" />
                <Stat label="Pending" value={snapshot.counts.pending} />
                <Stat label="Skipped" value={snapshot.counts.skipped} />
                <Stat label="Failed" value={snapshot.counts.failed} tone="rose" />
                <Stat label="In flight" value={snapshot.counts.copying + snapshot.counts.preparing} />
              </div>
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
            <section className="rounded-2xl border border-white/[0.08] bg-ink-900/80 p-4 shadow-panel">
              <div className="flex items-center justify-between">
                <SectionLabel>Choose a class</SectionLabel>
                <button
                  type="button"
                  onClick={() => setShortcutsOpen((value) => !value)}
                  className="rounded-md p-1 text-slate-600 transition hover:bg-white/5 hover:text-slate-300"
                  aria-label="Show keyboard shortcuts"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {classes.map((item, index) => {
                  const color = classColor(index);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleLabel(item.id)}
                      disabled={!canLabel}
                      className={cn(
                        "group flex h-12 items-center gap-3 rounded-xl border px-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 disabled:cursor-not-allowed disabled:opacity-40",
                        color.button,
                        color.ring,
                      )}
                    >
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color.dot)} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                        {item.name}
                      </span>
                      <Kbd>{shortcutLabel(index)}</Kbd>
                    </button>
                  );
                })}
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-slate-600">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Destination: <span className="font-mono text-slate-500">
                  result/{config.outputMode === "flat" ? "" : "…/"}class/{current?.name ?? "image.jpg"}
                </span>
              </p>

              {shortcutsOpen ? (
                <div className="mt-3 rounded-xl border border-white/[0.06] bg-ink-950/50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Keyboard
                  </p>
                  <div className="mt-2 space-y-1.5 text-[11px] text-slate-400">
                    <ShortcutRow keys="1–0" text="Pick classes 1–10" />
                    <ShortcutRow keys="⇧1–⇧0" text="Pick classes 11–20" />
                    <ShortcutRow keys="S / →" text="Skip image" />
                    <ShortcutRow keys="U / Ctrl+Z" text="Undo last action" />
                    <ShortcutRow keys="Space / P" text="Pause or resume" />
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <SectionLabel>Recent labels</SectionLabel>
                <span className="text-[10px] text-slate-600">latest first</span>
              </div>
              {snapshot.recentLabels.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-slate-600">
                  Labels will appear here as you work.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {snapshot.recentLabels.map((item, index) => {
                    const classIndex = classIndexById.get(item.classId);
                    const color = classColor(classIndex ?? index);
                    return (
                      <li
                        key={`${item.path}-${index}`}
                        className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs hover:bg-white/[0.03]"
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", color.dot)} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-slate-300">{item.name}</p>
                          <p className="truncate text-[10px] text-slate-600">
                            {item.destPath ?? item.folderName}
                          </p>
                        </div>
                        <RecentStatus status={item.status} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {failures.length > 0 ? (
              <section className="rounded-2xl border border-rose-400/15 bg-rose-400/[0.035] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <SectionLabel>Copy failures</SectionLabel>
                    <p className="mt-1 text-xs text-rose-200/90">
                      {formatNumber(failures.length)} image{failures.length === 1 ? "" : "s"} need
                      attention
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleRetryFailures}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry all
                  </Button>
                </div>
                <ul className="mt-3 space-y-2">
                  {failures.slice(0, 5).map((failure) => (
                    <li
                      key={failure.path}
                      className="rounded-lg border border-white/[0.06] bg-ink-950/40 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200">
                          {failure.name}
                        </p>
                        <span className="shrink-0 text-[10px] text-slate-500">
                          {failure.className}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-rose-200/70">
                        {failure.error}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (!runtime) return;
                          setActionError(null);
                          void runtime
                            .retryFailed(failure.path)
                            .catch((reason: unknown) => setActionError(errorMessage(reason)));
                        }}
                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 transition hover:text-white"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        Retry this copy
                      </button>
                    </li>
                  ))}
                </ul>
                {failures.length > 5 ? (
                  <p className="mt-2 text-[10px] text-slate-600">
                    Showing 5 of {formatNumber(failures.length)} failures.
                  </p>
                ) : null}
              </section>
            ) : null}

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <p className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-600">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-mint-400/60" />
                Originals are read-only. Undo removes only a copy whose size still matches this
                session’s copy.
              </p>
            </div>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={closeOpen}
        title="Close this labeling session?"
        description={
          <>
            Copies already finished will stay in the result folder. Queued copies stop, and the
            checkpoint remains resumable from the result folder.
            {snapshot.activeCopies > 0 || snapshot.counts.preparing > 0 ? (
              <span className="mt-2 block text-amber-200/90">
                {snapshot.activeCopies + snapshot.counts.preparing} copy task
                {snapshot.activeCopies + snapshot.counts.preparing === 1 ? " is" : "s are"} still
                in progress.
              </span>
            ) : null}
          </>
        }
        confirmLabel="Close session"
        cancelLabel="Keep labeling"
        danger
        busy={closing}
        onConfirm={() => void handleCloseSession()}
        onCancel={() => setCloseOpen(false)}
      />
    </div>
  );
}

function CheckpointStatus({
  status,
  error,
}: {
  status: "idle" | "saving" | "saved" | "error";
  error?: string;
}) {
  if (status === "error") {
    return (
      <span
        title={error ?? "Checkpoint saving failed"}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 text-[10px] font-medium text-rose-200"
      >
        <AlertTriangle className="h-3 w-3" />
        Checkpoint error
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[10px] font-medium text-slate-400">
        <Spinner className="h-3 w-3" />
        Saving checkpoint
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-2.5 text-[10px] font-medium text-emerald-300/90">
        <Check className="h-3 w-3" />
        Checkpoint saved
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 text-[10px] font-medium text-slate-600">
      <Clock className="h-3 w-3" />
      Checkpoint idle
    </span>
  );
}

function RecentStatus({ status }: { status: ImageStatus }) {
  if (status === "copied") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />;
  }
  if (status === "failed") {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400/80" />;
  }
  if (status === "skipped") {
    return <span className="text-[9px] uppercase tracking-wider text-slate-600">skip</span>;
  }
  return <Spinner className="h-3 w-3 shrink-0" />;
}

function ShortcutRow({ keys, text }: { keys: string; text: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{text}</span>
      <span className="shrink-0 rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
        {keys}
      </span>
    </div>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15-4.5-4.5L9 18" />
    </svg>
  );
}

function CompletionPanel({
  total,
  copied,
  skipped,
  failed,
  retrying,
  canUndo,
  onRetryFailed,
  onUndo,
  onNew,
  onResumeAnother,
  onOverview,
}: {
  total: number;
  copied: number;
  skipped: number;
  failed: number;
  retrying: boolean;
  canUndo: boolean;
  onRetryFailed: () => void;
  onUndo: () => void;
  onNew: () => void;
  onResumeAnother: () => void;
  onOverview: () => void;
}) {
  const hasFailures = failed > 0;
  return (
    <section className="relative mt-6 overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(52,211,153,.15),transparent_40%),radial-gradient(circle_at_90%_90%,rgba(56,189,248,.1),transparent_45%)]" />
      <div className="relative px-6 py-12 text-center sm:px-10 sm:py-16">
        <div
          className={cn(
            "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border",
            hasFailures
              ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
              : "border-mint-400/25 bg-mint-400/10 text-mint-300",
          )}
        >
          {hasFailures ? <AlertTriangle className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
        </div>
        <p
          className={cn(
            "mt-6 text-[11px] font-semibold uppercase tracking-[0.2em]",
            hasFailures ? "text-amber-300/80" : "text-mint-300/80",
          )}
        >
          {hasFailures ? "Queue finished with issues" : "Queue complete"}
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
          {hasFailures ? "Some copies still need attention." : "Every image has been handled."}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
          {hasFailures
            ? `${formatNumber(copied)} copies were written safely, but ${formatNumber(failed)} could not be copied. Retry them now while the source folder is still connected.`
            : `${formatNumber(copied)} copies were written safely. You can review the result folder, resume another checkpoint, or start a fresh session.`}
        </p>

        <div className="mx-auto mt-8 grid max-w-lg grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-4">
            <p className="text-2xl font-semibold text-emerald-300">{formatNumber(copied)}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">Copied</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-4">
            <p className="text-2xl font-semibold text-white">{formatNumber(skipped)}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">Skipped</p>
          </div>
          <div
            className={cn(
              "rounded-xl border px-3 py-4",
              hasFailures
                ? "border-rose-400/20 bg-rose-400/[0.05]"
                : "border-white/[0.07] bg-white/[0.025]",
            )}
          >
            <p
              className={cn(
                "text-2xl font-semibold",
                hasFailures ? "text-rose-300" : "text-white",
              )}
            >
              {formatNumber(failed)}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">Failed</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-600">
          {formatNumber(total)} images in this queue
          {hasFailures ? ` · ${formatNumber(failed)} still need attention` : ""}
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {hasFailures ? (
            <Button onClick={onRetryFailed} loading={retrying}>
              <RotateCcw className="h-4 w-4" />
              Retry failed copies
            </Button>
          ) : null}
          {canUndo ? (
            <Button variant="secondary" onClick={onUndo}>
              <Undo2 className="h-4 w-4" />
              Undo last action
            </Button>
          ) : null}
          <Button variant={hasFailures ? "secondary" : undefined} onClick={onOverview}>
            <ShieldCheck className="h-4 w-4" />
            Back to overview
          </Button>
          <Button variant="secondary" onClick={onResumeAnother}>
            <FolderOpen className="h-4 w-4" />
            Resume another
          </Button>
          <Button variant="ghost" onClick={onNew}>
            <Tags className="h-4 w-4" />
            New session
          </Button>
        </div>
      </div>
    </section>
  );
}
