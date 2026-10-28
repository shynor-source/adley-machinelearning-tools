import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FolderOpen,
  HardDrive,
  ImageIcon,
  Info,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Tags,
} from "lucide-react";
import {
  Badge,
  Button,
  NoticeBanner,
  ProgressBar,
  SectionLabel,
  Spinner,
  cn,
} from "../components/ui";
import { useSession } from "../context/SessionContext";
import {
  listStoredSessions,
  readSessionCheckpoint,
} from "../lib/checkpoint";
import {
  ensurePermission,
  pickDirectory,
} from "../lib/fs";
import {
  errorMessage,
  formatBytes,
  formatDate,
  formatNumber,
} from "../lib/path";
import { SAMPLE_CHECK_COUNT, checkSourceSample, type SourceCheck } from "../lib/resume";
import { SessionRuntime } from "../lib/session";
import type { CheckpointSessionData, SessionConfig } from "../lib/types";

function progressValues(config: SessionConfig): { handled: number; percent: number } {
  const summary = config.summary;
  if (!summary) return { handled: 0, percent: 0 };
  const handled = Math.min(
    config.totalImages,
    summary.labeled + summary.skipped,
  );
  const percent = config.totalImages > 0 ? (handled / config.totalImages) * 100 : 0;
  return { handled, percent };
}

function SessionCard({
  config,
  active,
  onSelect,
}: {
  config: SessionConfig;
  active: boolean;
  onSelect: () => void;
}) {
  const { handled, percent } = progressValues(config);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group w-full rounded-2xl border p-4 text-left transition",
        active
          ? "border-mint-400/35 bg-mint-400/[0.055] shadow-[inset_0_0_0_1px_rgba(52,211,153,.1)]"
          : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.035]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{config.name}</p>
            <Badge tone={config.outputMode === "flat" ? "mint" : "sky"}>
              {config.outputMode === "flat" ? "Flat" : "Mirror"}
            </Badge>
            {config.summary && config.summary.failed > 0 ? (
              <Badge tone="rose">{formatNumber(config.summary.failed)} failed</Badge>
            ) : null}
          </div>
          <p className="mt-1.5 truncate text-[11px] text-slate-500">
            {config.sourceName} <span className="text-slate-700">→</span> {config.resultName}
          </p>
        </div>
        <ChevronRight
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 transition",
            active ? "text-mint-300" : "text-slate-600 group-hover:text-slate-400",
          )}
        />
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-600">
          <span>{formatNumber(handled)} handled</span>
          <span>{formatNumber(config.totalImages)} images</span>
        </div>
        <ProgressBar
          value={handled}
          total={config.totalImages}
          tone={config.summary?.failed ? "amber" : "mint"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600">
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {formatDate(config.createdAt)}
        </span>
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="h-3 w-3" />
          {formatBytes(config.totalBytes)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Tags className="h-3 w-3" />
          {config.classes.length} classes
        </span>
        <span className="ml-auto font-mono text-slate-700">
          {percent > 0 ? `${percent.toFixed(0)}%` : "not started"}
        </span>
      </div>
    </button>
  );
}

export function SessionsPage() {
  const navigate = useNavigate();
  const { runtime: activeRuntime, startSession } = useSession();
  const [result, setResult] = useState<FileSystemDirectoryHandle | null>(null);
  const [sessions, setSessions] = useState<SessionConfig[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<FileSystemDirectoryHandle | null>(null);
  const [sourceCheck, setSourceCheck] = useState<SourceCheck | null>(null);
  const [checkingSource, setCheckingSource] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const checkpointCache = useRef(new Map<string, CheckpointSessionData>());
  const requestRef = useRef(0);

  const selected = useMemo(
    () => sessions?.find((item) => item.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  const loadSessions = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const requestId = ++requestRef.current;
    setLoadingList(true);
    setListError(null);
    checkpointCache.current.clear();
    try {
      const stored = await listStoredSessions(handle);
      if (requestRef.current !== requestId) return;
      setSessions(stored);
      setSelectedId((current) => {
        if (current && stored.some((item) => item.id === current)) return current;
        return stored[0]?.id ?? null;
      });
    } catch (reason) {
      if (requestRef.current !== requestId) return;
      setSessions([]);
      setListError(`Could not read checkpoints from this folder: ${errorMessage(reason)}`);
    } finally {
      if (requestRef.current === requestId) setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (result) void loadSessions(result);
  }, [result, loadSessions, refreshToken]);

  async function pickResult() {
    if (resuming) return;
    try {
      const picked = await pickDirectory("adley-labeling-result", "readwrite");
      if (!picked) return;
      setResult(picked);
      setSessions(null);
      setSelectedId(null);
      setSource(null);
      setSourceCheck(null);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function loadCheckpointFor(id: string): Promise<CheckpointSessionData | null> {
    if (!result) return null;
    const cached = checkpointCache.current.get(id);
    if (cached) return cached;
    const checkpoint = await readSessionCheckpoint(result, id);
    checkpointCache.current.set(id, checkpoint);
    return checkpoint;
  }

  async function pickSource() {
    if (!selected || !result || resuming) return;
    try {
      const picked = await pickDirectory("adley-labeling-source", "read");
      if (!picked) return;
      setSource(picked);
      setError(null);
      setCheckingSource(true);
      setSourceCheck({ status: "checking", missing: [], checked: 0 });
      try {
        const checkpoint = await loadCheckpointFor(selected.id);
        if (!checkpoint) throw new Error("The checkpoint could not be loaded.");
        const check = await checkSourceSample(picked, checkpoint);
        setSourceCheck(check);
      } catch (reason) {
        setSourceCheck({
          status: "warning",
          missing: [],
          checked: 0,
          error: `Could not verify the source folder: ${errorMessage(reason)}`,
        });
      } finally {
        setCheckingSource(false);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function selectSession(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setSource(null);
    setSourceCheck(null);
    setError(null);
  }

  async function resumeSession() {
    if (!result || !selected || !source || resuming) return;
    if (activeRuntime) {
      setError(
        "Another labeling session is active. Return to it, or close it from the workspace before resuming this checkpoint.",
      );
      return;
    }
    setResuming(true);
    setError(null);
    try {
      const granted = await ensurePermission(result, "readwrite");
      if (!granted) {
        throw new DOMException("Result folder permission was not granted.", "NotAllowedError");
      }
      const checkpoint = await loadCheckpointFor(selected.id);
      if (!checkpoint) throw new Error("The checkpoint could not be loaded.");
      const runtime = SessionRuntime.fromCheckpoint(source, result, checkpoint);
      await startSession(runtime);
      navigate("/labeling/workspace");
    } catch (reason) {
      setError(errorMessage(reason));
      setResuming(false);
    }
  }

  const sourceNameMismatch = Boolean(
    selected && source && selected.sourceName !== source.name,
  );
  const checkIsWarning = sourceCheck?.status === "warning";
  const canResume = Boolean(selected && source && !checkingSource && !resuming);
  const { handled, percent } = selected
    ? progressValues(selected)
    : { handled: 0, percent: 0 };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link to="/" className="transition hover:text-slate-300">
              Overview
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span>Resume session</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Resume from a checkpoint
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Checkpoints live in the result folder. Pick that folder again, reconnect the same
            source, and continue exactly where labeling stopped.
          </p>
        </div>
        <Link
          to="/labeling/new"
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-white transition hover:bg-white/[0.08]"
        >
          New session
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {activeRuntime ? (
        <div className="mt-6">
          <NoticeBanner
            tone="amber"
            title="Another labeling session is active."
            action={
              <Link
                to="/labeling/workspace"
                className="whitespace-nowrap rounded-lg border border-amber-300/20 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-300/10"
              >
                Return to session
              </Link>
            }
          >
            Close the active session in the workspace before resuming a checkpoint.
          </NoticeBanner>
        </div>
      ) : null}

      {error ? (
        <div className="mt-6">
          <NoticeBanner tone="rose" title="Something went wrong" onDismiss={() => setError(null)}>
            {error}
          </NoticeBanner>
        </div>
      ) : null}

      {!result ? (
        <section className="mt-8 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_360px] lg:items-center">
            <div>
              <SectionLabel>Step 01</SectionLabel>
              <h2 className="mt-2 text-xl font-semibold text-white">Choose the result folder</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                This is the folder you selected when the session was created. Its hidden{" "}
                <code className="rounded bg-white/[0.06] px-1 text-slate-400">.adley-labeling</code>{" "}
                directory contains the session, manifest, and progress files.
              </p>
              <Button
                size="lg"
                className="mt-6"
                onClick={() => void pickResult()}
                loading={loadingList}
              >
                <FolderOpen className="h-4 w-4" />
                Choose result folder
              </Button>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-ink-950/45 p-4">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-300">
                <ShieldCheck className="h-3.5 w-3.5 text-mint-400/80" />
                Nothing is uploaded
              </p>
              <p className="mt-2 text-[11px] leading-5 text-slate-600">
                Folder access is granted by your browser, not the server. No file handles are
                stored in cookies, local storage, or a database.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-mint-400/20 bg-mint-400/10 text-mint-300">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{result.name}</p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                    Result folder · read + write
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRefreshToken((value) => value + 1)}
                  disabled={loadingList || resuming}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingList && "animate-spin")} />
                  Refresh
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void pickResult()}
                  disabled={resuming}
                >
                  Change
                </Button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div>
                <SectionLabel>Stored sessions</SectionLabel>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {sessions === null
                    ? "Reading checkpoints…"
                    : `${sessions.length} checkpoint${sessions.length === 1 ? "" : "s"} found`}
                </h2>
              </div>
              {sessions && sessions.length > 0 ? (
                <Badge tone="neutral">Newest first</Badge>
              ) : null}
            </div>

            {loadingList ? (
              <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-sm text-slate-500">
                <Spinner />
                Looking inside {result.name}/.adley-labeling…
              </div>
            ) : listError ? (
              <div className="mt-6">
                <NoticeBanner
                  tone="rose"
                  title="Checkpoints could not be listed"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setRefreshToken((value) => value + 1)}
                    >
                      Try again
                    </Button>
                  }
                >
                  {listError}
                </NoticeBanner>
              </div>
            ) : sessions && sessions.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-500">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-medium text-slate-200">
                  No checkpoints in this result folder
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
                  Choose the result folder used by a session. If you never started labeling,
                  create a new session instead.
                </p>
                <Link
                  to="/labeling/new"
                  className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-mint-400 px-4 text-sm font-semibold text-ink-950 transition hover:bg-mint-300"
                >
                  <PlusCircle className="h-4 w-4" />
                  Create a session
                </Link>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {sessions?.map((item) => (
                  <SessionCard
                    key={item.id}
                    config={item}
                    active={item.id === selectedId}
                    onSelect={() => selectSession(item.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            {selected ? (
              <div className="rounded-2xl border border-white/10 bg-ink-900/80 p-5 shadow-panel backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <SectionLabel>Selected checkpoint</SectionLabel>
                    <h2 className="mt-2 truncate text-lg font-semibold text-white">
                      {selected.name}
                    </h2>
                  </div>
                  <Badge tone={selected.outputMode === "flat" ? "mint" : "sky"}>
                    {selected.outputMode === "flat" ? "Flat" : "Mirror"}
                  </Badge>
                </div>

                <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Progress</span>
                    <span className="font-medium text-slate-200">
                      {formatNumber(handled)} / {formatNumber(selected.totalImages)}
                    </span>
                  </div>
                  <ProgressBar
                    className="mt-2"
                    value={handled}
                    total={selected.totalImages}
                    tone={selected.summary?.failed ? "amber" : "mint"}
                  />
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600">
                    <span>{percent.toFixed(1)}% complete</span>
                    {selected.summary?.failed ? (
                      <span className="text-rose-300/80">
                        {formatNumber(selected.summary.failed)} failed
                      </span>
                    ) : (
                      <span>No failed copies</span>
                    )}
                  </div>
                </div>

                <dl className="mt-4 space-y-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Original source</dt>
                    <dd className="max-w-[200px] truncate text-right text-slate-200">
                      {selected.sourceName}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Classes</dt>
                    <dd className="flex max-w-[220px] flex-wrap justify-end gap-1">
                      {selected.classes.slice(0, 4).map((item, index) => (
                        <span
                          key={item.id}
                          className="max-w-[110px] truncate rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-300"
                        >
                          {item.name}
                        </span>
                      ))}
                      {selected.classes.length > 4 ? (
                        <span className="text-[10px] text-slate-500">
                          +{selected.classes.length - 4}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Total size</dt>
                    <dd className="text-slate-200">{formatBytes(selected.totalBytes)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="inline-flex items-center gap-1 text-slate-500">
                      <Clock className="h-3 w-3" /> Last activity
                    </dt>
                    <dd className="text-slate-200">{formatDate(selected.updatedAt)}</dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-white/[0.06] pt-4">
                  <SectionLabel>Reconnect source folder</SectionLabel>
                  <div
                    className={cn(
                      "mt-2 rounded-xl border p-3.5",
                      source
                        ? "border-mint-400/20 bg-mint-400/[0.04]"
                        : "border-white/[0.07] bg-white/[0.02]",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400">
                        <FolderOpen className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-200">
                          {source?.name ?? "No source selected"}
                        </p>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                          {source ? "Read only" : "Required to resume"}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void pickSource()}
                        disabled={checkingSource || resuming}
                      >
                        {source ? "Change" : "Choose"}
                      </Button>
                    </div>

                    {checkingSource ? (
                      <p className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                        <Spinner className="h-3 w-3" />
                        Checking the first {SAMPLE_CHECK_COUNT} manifest paths…
                      </p>
                    ) : sourceCheck?.status === "ok" ? (
                      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-300/90">
                        <CheckCircle2 className="h-3 w-3" />
                        Source checked. Sample files match the manifest.
                      </p>
                    ) : sourceCheck?.status === "warning" ? (
                      <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-100/90">
                        <p className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {sourceCheck.error ??
                            `${sourceCheck.missing.length} of ${sourceCheck.checked} sampled images were not found. Check that this is the same source folder, not a parent or a copy.`}
                        </p>
                        {sourceCheck.missing[0] ? (
                          <p className="mt-1 truncate font-mono text-[10px] text-amber-200/60">
                            Missing: {sourceCheck.missing[0]}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {sourceNameMismatch ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-amber-200/80">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      The selected folder is named “{source?.name}”, but the checkpoint expects “{selected.sourceName}”.
                    </p>
                  ) : null}
                </div>

                <Button
                  size="lg"
                  className="mt-4 w-full"
                  onClick={() => void resumeSession()}
                  disabled={!canResume}
                  loading={resuming}
                >
                  <RotateCcw className="h-4 w-4" />
                  {resuming ? "Reconciling checkpoint…" : "Resume labeling"}
                </Button>

                {!source ? (
                  <p className="mt-2 text-[11px] text-slate-600">
                    Choose the original source folder to reconnect file handles.
                  </p>
                ) : null}

                <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-slate-600">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Existing copies are verified by size before copying resumes. Completed images
                  are never relabeled.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center text-sm text-slate-500">
                Select a checkpoint to see its details.
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
