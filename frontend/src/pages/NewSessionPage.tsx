import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Info,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  X,
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
  createSessionCheckpoint,
  type CreateCheckpointProgress,
} from "../lib/checkpoint";
import {
  ensurePermission,
  pickDirectory,
  validateSourceResult,
  type SourceResultValidation,
} from "../lib/fs";
import { scanErrorMessage, scanSourceFolder } from "../lib/scan";
import {
  buildDestinationPreview,
  errorMessage,
  formatBytes,
  formatNumber,
  sanitizeFolderName,
  validateClassNames,
  type OutputMode,
} from "../lib/path";
import { SessionRuntime } from "../lib/session";
import type { ScanProgress, ScanResult, SessionConfig } from "../lib/types";
import { classColor } from "../lib/class-colors";

interface EditableClass {
  id: string;
  name: string;
}

function newClassId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `class-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function FolderCard({
  icon: Icon,
  label,
  hint,
  handle,
  mode,
  onPick,
  disabled,
}: {
  icon: typeof FolderOpen;
  label: string;
  hint: string;
  handle: FileSystemDirectoryHandle | null;
  mode: "read" | "readwrite";
  onPick: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition",
        handle
          ? "border-mint-400/20 bg-mint-400/[0.04]"
          : "border-white/[0.07] bg-white/[0.02]",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
            handle
              ? "border-mint-400/20 bg-mint-400/10 text-mint-300"
              : "border-white/[0.07] bg-white/[0.03] text-slate-500",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-200">{label}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {handle ? handle.name : hint}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-600">
            {mode === "readwrite" ? "Read + write" : "Read only"}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onPick} disabled={disabled}>
          {handle ? "Change" : "Choose"}
        </Button>
      </div>
    </div>
  );
}

export function NewSessionPage() {
  const navigate = useNavigate();
  const { runtime: activeRuntime, startSession } = useSession();
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [classes, setClasses] = useState<EditableClass[]>([
    { id: newClassId(), name: "Class 1" },
    { id: newClassId(), name: "Class 2" },
  ]);
  const [mode, setMode] = useState<OutputMode>("flat");
  const [source, setSource] = useState<FileSystemDirectoryHandle | null>(null);
  const [result, setResult] = useState<FileSystemDirectoryHandle | null>(null);
  const [validation, setValidation] = useState<SourceResultValidation | null>(null);
  const [checkingFolders, setCheckingFolders] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createStage, setCreateStage] = useState("");
  const [createProgress, setCreateProgress] = useState<CreateCheckpointProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => scanAbort.current?.abort();
  }, []);

  const classNames = classes.map((item) => item.name);
  const classErrors = useMemo(() => validateClassNames(classNames), [classNames]);
  const hasClassErrors = classErrors.some(Boolean);
  const classFolders = classes.map((item) => sanitizeFolderName(item.name));

  const previewRows = useMemo(() => {
    if (!scan || scan.images.length === 0 || hasClassErrors) return [];
    return buildDestinationPreview(scan.images, classFolders, mode, 6);
  }, [scan, mode, hasClassErrors, classFolders.join("|")]);

  const validationError = validation?.error ?? null;
  const canScan = Boolean(
    source &&
      result &&
      validation &&
      !checkingFolders &&
      !validationError &&
      !scanning &&
      !creating,
  );
  const missingReason = useMemo(() => {
    if (!name.trim()) return "Give this session a name.";
    if (hasClassErrors) return "Finish naming the classes.";
    if (!source) return "Choose a source folder.";
    if (!result) return "Choose a result folder.";
    if (checkingFolders) return "Checking the selected folders…";
    if (validationError) return validationError;
    if (!validation) return "The folder selection could not be verified.";
    if (!scan) return "Scan the source folder.";
    if (scan.images.length === 0) return "No supported images were found.";
    return null;
  }, [name, hasClassErrors, source, result, checkingFolders, validationError, validation, scan]);

  const canStart = !missingReason && !creating && !scanning;

  function resetScan() {
    scanAbort.current?.abort();
    scanAbort.current = null;
    setScanning(false);
    setScanProgress(null);
    setScan(null);
    setScanError(null);
  }

  async function applyFolders(
    nextSource: FileSystemDirectoryHandle | null,
    nextResult: FileSystemDirectoryHandle | null,
  ) {
    setSource(nextSource);
    setResult(nextResult);
    resetScan();
    setValidation(null);
    setError(null);
    if (!nextSource || !nextResult) return;
    setCheckingFolders(true);
    try {
      const nextValidation = await validateSourceResult(nextSource, nextResult);
      setValidation(nextValidation);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCheckingFolders(false);
    }
  }

  async function pickSource() {
    if (creating) return;
    try {
      const picked = await pickDirectory("adley-labeling-source", "read");
      if (!picked) return;
      if (!nameTouched && !name.trim()) setName(`${picked.name} labeling`);
      await applyFolders(picked, result);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function pickResult() {
    if (creating) return;
    try {
      const picked = await pickDirectory("adley-labeling-result", "readwrite");
      if (!picked) return;
      await applyFolders(source, picked);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function runScan() {
    if (!source || !result || validationError || scanning || creating) return;
    resetScan();
    const controller = new AbortController();
    scanAbort.current = controller;
    setScanning(true);
    setError(null);
    try {
      const granted = await ensurePermission(result, "readwrite");
      if (!granted) throw new DOMException("Result folder permission was not granted.", "NotAllowedError");
      const scanned = await scanSourceFolder(source, validation?.excludedPaths ?? [], {
        signal: controller.signal,
        onProgress: setScanProgress,
      });
      setScan(scanned);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setScanError("Scan cancelled.");
      } else {
        setScanError(scanErrorMessage(reason));
      }
    } finally {
      setScanning(false);
      scanAbort.current = null;
    }
  }

  function updateClass(id: string, value: string) {
    setClasses((current) => current.map((item) => (item.id === id ? { ...item, name: value } : item)));
  }

  function addClass() {
    if (classes.length >= 20) return;
    setClasses((current) => [
      ...current,
      { id: newClassId(), name: `Class ${current.length + 1}` },
    ]);
  }

  function removeClass(id: string) {
    if (classes.length <= 1) return;
    setClasses((current) => current.filter((item) => item.id !== id));
  }

  async function handleStart() {
    if (!source || !result || !scan || !canStart) return;
    setCreating(true);
    setError(null);
    setCreateProgress(null);
    setCreateStage("Preparing session");
    try {
      const granted = await ensurePermission(result, "readwrite");
      if (!granted) throw new DOMException("Result folder permission was not granted.", "NotAllowedError");
      const createdAt = new Date().toISOString();
      const config: SessionConfig = {
        version: 1,
        id: newSessionId(),
        name: name.trim(),
        createdAt,
        updatedAt: createdAt,
        sourceName: source.name,
        resultName: result.name,
        outputMode: mode,
        classes: classes.map((item, index) => ({
          id: item.id,
          name: item.name.trim(),
          folderName: classFolders[index],
        })),
        totalImages: scan.images.length,
        totalBytes: scan.totalBytes,
        summary: {
          labeled: 0,
          copied: 0,
          skipped: 0,
          failed: 0,
          updatedAt: createdAt,
        },
      };

      setCreateStage("Writing checkpoint and image manifest");
      await createSessionCheckpoint(result, config, scan.images, setCreateProgress);
      setCreateStage("Opening labeling workspace");
      const runtime = SessionRuntime.open({
        source,
        result,
        config,
        manifest: scan.images,
        events: [],
      });
      await startSession(runtime);
      navigate("/labeling/workspace");
    } catch (reason) {
      setError(errorMessage(reason));
      setCreating(false);
      setCreateStage("");
    }
  }

  const createPercent =
    createProgress && createProgress.total > 0
      ? (createProgress.written / createProgress.total) * 100
      : 0;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link to="/" className="transition hover:text-slate-300">
              Overview
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span>New session</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Create a classification session
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Pick the folders, arrange the classes, and preview where copies will land. Originals
            are only ever read.
          </p>
        </div>
        <Badge tone="mint">
          <ShieldCheck className="h-3 w-3" />
          Local files only
        </Badge>
      </div>

      {activeRuntime ? (
        <div className="mt-6">
          <NoticeBanner
            tone="amber"
            title="A labeling session is already active."
            action={
              <Link
                to="/labeling/workspace"
                className="whitespace-nowrap rounded-lg border border-amber-300/20 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-300/10"
              >
                Return to session
              </Link>
            }
          >
            Starting a new session closes the current one. Copies in progress stop, but the
            checkpoint stays in the result folder and can be resumed.
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

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionLabel>Step 01</SectionLabel>
                <h2 className="mt-2 text-lg font-semibold text-white">Session and classes</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Each class becomes a folder inside the result directory.
                </p>
              </div>
              <Badge>{classes.length} classes</Badge>
            </div>

            <div className="mt-5">
              <label
                htmlFor="session-name"
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              >
                Session name
              </label>
              <input
                id="session-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameTouched(true);
                }}
                disabled={creating}
                placeholder="e.g. Product defect review"
                className="h-11 w-full rounded-xl border border-white/10 bg-ink-950/60 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-mint-400/40 focus:ring-2 focus:ring-mint-400/15 disabled:opacity-60"
              />
            </div>

            <div className="mt-5 space-y-2">
              {classes.map((item, index) => {
                const color = classColor(index);
                const folder = sanitizeFolderName(item.name);
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-white/[0.06] bg-ink-950/40 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03]">
                        <span className={cn("h-2 w-2 rounded-full", color.dot)} />
                      </div>
                      <span className="w-5 shrink-0 font-mono text-[11px] text-slate-600">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <input
                        value={item.name}
                        onChange={(event) => updateClass(item.id, event.target.value)}
                        disabled={creating}
                        aria-label={`Class ${index + 1} name`}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-ink-950/70 px-3 text-sm text-white outline-none transition focus:border-mint-400/40 focus:ring-2 focus:ring-mint-400/15 disabled:opacity-60"
                        placeholder={`Class ${index + 1}`}
                      />
                      <span className="hidden max-w-[180px] truncate text-[11px] text-slate-500 sm:block">
                        {mode === "flat" ? "result/" : "result/…/"}
                        <span className="text-slate-400">{folder}/</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeClass(item.id)}
                        disabled={classes.length <= 1 || creating}
                        className="rounded-lg p-2 text-slate-600 transition hover:bg-rose-400/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={`Remove class ${index + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {classErrors[index] ? (
                      <p className="mt-2 pl-[68px] text-xs text-rose-300">{classErrors[index]}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={addClass}
                disabled={classes.length >= 20 || creating}
              >
                <Plus className="h-3.5 w-3.5" />
                Add class
              </Button>
              <p className="text-[11px] text-slate-600">
                Up to 20 classes · unique folder names are required
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
            <SectionLabel>Step 02</SectionLabel>
            <h2 className="mt-2 text-lg font-semibold text-white">Output layout</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Flat by class is the default. Full mirror is opt-in and keeps every source directory.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Output layout">
              <button
                type="button"
                role="radio"
                aria-checked={mode === "flat"}
                onClick={() => setMode("flat")}
                disabled={creating}
                className={cn(
                  "relative rounded-xl border p-4 text-left transition",
                  mode === "flat"
                    ? "border-mint-400/35 bg-mint-400/[0.07] shadow-[inset_0_0_0_1px_rgba(52,211,153,.12)]"
                    : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Tags className="h-4 w-4 text-mint-300" />
                    <p className="text-sm font-medium text-white">Flat by class</p>
                  </div>
                  <Badge tone="mint">Default</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  All discovered images enter one queue. Copies go directly into a class folder.
                </p>
                <code className="mt-3 block rounded-lg border border-white/[0.06] bg-ink-950/60 px-2.5 py-2 text-[11px] text-slate-400">
                  result/{sanitizeFolderName(classes[0]?.name ?? "class")}/photo.jpg
                </code>
                {mode === "flat" ? (
                  <span className="sr-only">Selected</span>
                ) : null}
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={mode === "mirror"}
                onClick={() => setMode("mirror")}
                disabled={creating}
                className={cn(
                  "relative rounded-xl border p-4 text-left transition",
                  mode === "mirror"
                    ? "border-sky-400/35 bg-sky-400/[0.07] shadow-[inset_0_0_0_1px_rgba(56,189,248,.12)]"
                    : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-sky-300" />
                    <p className="text-sm font-medium text-white">
                      Preserve source folder structure (Full mirror)
                    </p>
                  </div>
                  <Badge tone="sky">Optional</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Recreates each source directory and places the class folder inside the image’s
                  original directory.
                </p>
                <code className="mt-3 block rounded-lg border border-white/[0.06] bg-ink-950/60 px-2.5 py-2 text-[11px] text-slate-400">
                  result/train/cats/{sanitizeFolderName(classes[0]?.name ?? "class")}/photo.jpg
                </code>
              </button>
            </div>

            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
              Duplicate filenames never overwrite an existing file. The app adds a safe suffix
              such as <code className="rounded bg-white/[0.06] px-1">__1</code> and records the
              exact source → destination mapping in the checkpoint.
            </p>
          </section>

          <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
            <SectionLabel>Step 03</SectionLabel>
            <h2 className="mt-2 text-lg font-semibold text-white">Folders</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Source files are read and copied. The result folder holds class copies and a hidden
              checkpoint directory.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <FolderCard
                icon={FolderOpen}
                label="Source images"
                hint="Choose the folder containing your images"
                handle={source}
                mode="read"
                onPick={() => void pickSource()}
                disabled={creating || scanning}
              />
              <FolderCard
                icon={HardDrive}
                label="Result folder"
                hint="Choose where labeled copies should go"
                handle={result}
                mode="readwrite"
                onPick={() => void pickResult()}
                disabled={creating || scanning}
              />
            </div>

            {checkingFolders ? (
              <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <Spinner className="h-3.5 w-3.5" />
                Checking folder relationship…
              </p>
            ) : null}
            {validation?.error ? (
              <div className="mt-3">
                <NoticeBanner tone="rose" title="These folders cannot be used">
                  {validation.error}
                </NoticeBanner>
              </div>
            ) : null}
            {validation?.warning ? (
              <div className="mt-3">
                <NoticeBanner tone="amber" title="Result folder is inside the source folder">
                  {validation.warning}
                </NoticeBanner>
              </div>
            ) : null}

            <div className="mt-5 rounded-xl border border-white/[0.06] bg-ink-950/35 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <Search className="h-4 w-4 text-mint-300" />
                    Recursive scan
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Finds supported images in every nested folder. Only metadata is read.
                  </p>
                </div>
                <div className="flex gap-2">
                  {scanning ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => scanAbort.current?.abort()}
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel scan
                    </Button>
                  ) : (
                    <Button
                      variant={scan ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => void runScan()}
                      disabled={!canScan}
                      loading={scanning}
                    >
                      {scan ? <RefreshCw className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
                      {scan ? "Scan again" : "Scan source folder"}
                    </Button>
                  )}
                </div>
              </div>

              {scanning ? (
                <div className="mt-4">
                  <ProgressBar indeterminate />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500 sm:grid-cols-4">
                    <span>
                      <strong className="text-slate-300">
                        {formatNumber(scanProgress?.imagesFound ?? 0)}
                      </strong>{" "}
                      images
                    </span>
                    <span>
                      <strong className="text-slate-300">
                        {formatNumber(scanProgress?.foldersFound ?? 0)}
                      </strong>{" "}
                      folders
                    </span>
                    <span>
                      <strong className="text-slate-300">
                        {formatBytes(scanProgress?.bytesFound ?? 0)}
                      </strong>{" "}
                      total
                    </span>
                    <span className="truncate">
                      {((scanProgress?.elapsedMs ?? 0) / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[10px] text-slate-600">
                    {scanProgress?.currentPath || "Starting scan…"}
                  </p>
                </div>
              ) : scan ? (
                <div className="mt-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { label: "Images", value: formatNumber(scan.images.length) },
                      { label: "Folders", value: formatNumber(Math.max(0, scan.folders.length - 1)) },
                      { label: "Total size", value: formatBytes(scan.totalBytes) },
                      { label: "Scan time", value: `${(scan.elapsedMs / 1000).toFixed(1)}s` },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                      >
                        <p className="text-sm font-semibold text-white">{stat.value}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                          {stat.label}
                        </p>
                      </div>
                    ))}
                  </div>
                  {scan.warnings.length > 0 ? (
                    <p className="mt-3 flex items-start gap-2 text-xs text-amber-200/80">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {scan.warnings.length} unreadable item
                      {scan.warnings.length === 1 ? "" : "s"} will be skipped. The first:{" "}
                      {scan.warnings[0].path} — {scan.warnings[0].message}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-600">
                  {scanError ? (
                    <span className="text-amber-200/80">{scanError}</span>
                  ) : (
                    "Choose both folders, then scan to preview the queue."
                  )}
                </p>
              )}
            </div>
          </section>

          {scan && scan.images.length > 0 ? (
            <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <SectionLabel>Step 04</SectionLabel>
                  <h2 className="mt-2 text-lg font-semibold text-white">Destination preview</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    A sample of the queue using the current mode and class names. Exact
                    collision-safe names are assigned as you label.
                  </p>
                </div>
                <Badge tone={mode === "flat" ? "mint" : "sky"}>
                  {mode === "flat" ? "Flat by class" : "Full mirror"}
                </Badge>
              </div>

              {hasClassErrors ? (
                <p className="mt-4 text-xs text-rose-300">
                  Fix the class names above to preview destinations.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.06]">
                  <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.025] text-[10px] uppercase tracking-[0.12em] text-slate-600">
                        <th className="px-3 py-2.5 font-semibold">Source image</th>
                        {classes.map((item, index) => (
                          <th key={item.id} className="px-3 py-2.5 font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={cn("h-1.5 w-1.5 rounded-full", classColor(index).dot)} />
                              {item.name || `Class ${index + 1}`}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr
                          key={row.image.path}
                          className="border-b border-white/[0.04] last:border-0"
                        >
                          <td className="max-w-[220px] truncate px-3 py-2.5 font-mono text-[10px] text-slate-500">
                            {row.image.path}
                          </td>
                          {row.destinations.map((destination) => (
                            <td
                              key={destination.folderName}
                              className="max-w-[220px] truncate px-3 py-2.5 font-mono text-[10px] text-slate-400"
                              title={`result/${destination.destPath}`}
                            >
                              {destination.destPath}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[11px] text-slate-600">
                Previewing {Math.min(6, scan.images.length)} of {formatNumber(scan.images.length)}{" "}
                images. Suffixes are added if a name already exists in the result folder.
              </p>
            </section>
          ) : null}
        </div>

        <aside className="xl:sticky xl:top-8 xl:self-start">
          <div className="rounded-2xl border border-white/10 bg-ink-900/80 p-5 shadow-panel backdrop-blur">
            <SectionLabel>Session summary</SectionLabel>
            <h2 className="mt-2 text-lg font-semibold text-white">
              {name.trim() || "Untitled session"}
            </h2>

            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Layout</span>
                <span className="text-right text-slate-200">
                  {mode === "flat" ? "Flat by class" : "Full mirror"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Classes</span>
                <span className="text-right text-slate-200">{classes.length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Source</span>
                <span className="max-w-[190px] truncate text-right text-slate-200">
                  {source?.name ?? "Not selected"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Result</span>
                <span className="max-w-[190px] truncate text-right text-slate-200">
                  {result?.name ?? "Not selected"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Discovered images</span>
                <span className="text-right text-slate-200">
                  {scan ? formatNumber(scan.images.length) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Total size</span>
                <span className="text-right text-slate-200">
                  {scan ? formatBytes(scan.totalBytes) : "—"}
                </span>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3.5">
              <div className="flex items-start gap-2 text-[11px] leading-5 text-slate-500">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-400/80" />
                A checkpoint with the manifest and destination map will be written to{" "}
                <code className="rounded bg-white/[0.06] px-1 text-slate-400">
                  {result?.name ?? "result"}/
                </code>
                . You can resume later.
              </div>
            </div>

            <Button
              size="lg"
              className="mt-5 w-full"
              onClick={() => void handleStart()}
              disabled={!canStart}
              loading={creating}
            >
              {creating ? "Preparing session…" : "Start labeling"}
              {!creating ? <ArrowRight className="h-4 w-4" /> : null}
            </Button>

            {creating ? (
              <div className="mt-3">
                <ProgressBar
                  value={createProgress?.written}
                  total={createProgress?.total}
                  indeterminate={!createProgress}
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  {createStage}
                  {createProgress
                    ? ` · ${formatNumber(createProgress.written)} / ${formatNumber(createProgress.total)} manifest rows`
                    : ""}
                </p>
                {createProgress && createProgress.total > 0 ? (
                  <p className="mt-1 text-[10px] text-slate-600">
                    {Math.round(createPercent)}% of the manifest saved
                  </p>
                ) : null}
              </div>
            ) : null}

            {missingReason && !creating ? (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
                {missingReason}
              </p>
            ) : null}

            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="text-[11px] text-slate-600">
                Pause, resume, skip, and undo work in both layout modes.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
