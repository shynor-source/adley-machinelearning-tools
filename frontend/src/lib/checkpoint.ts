import {
  CHECKPOINT_DIR,
  isSafeRelativePath,
  joinRelativePath,
  sanitizeFolderName,
} from "./path";
import {
  appendJsonLine,
  directoryExistsAt,
  getDirectoryAt,
  listCheckpointSessionIds,
  readJsonFile,
  readJsonLines,
  removeDirectoryAt,
  writeJsonFile,
} from "./fs";
import type {
  CheckpointSessionData,
  ImageState,
  ImageStatus,
  ManifestImage,
  ProgressEvent,
  RuntimeCounts,
  SessionConfig,
  SessionSummary,
} from "./types";

export const SESSION_FILE = "session.json";
export const MANIFEST_FILE = "manifest.jsonl";
export const PROGRESS_FILE = "progress.jsonl";

export function checkpointBase(sessionId: string): string {
  return `${CHECKPOINT_DIR}/${sessionId}`;
}

export function checkpointPath(sessionId: string, file: string): string {
  return `${checkpointBase(sessionId)}/${file}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid checkpoint: ${field}.`);
  return value;
}

function asFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid checkpoint: ${field}.`);
  }
  return value;
}

function asNonNegative(value: unknown, field: string): number {
  const number = asFinite(value, field);
  if (number < 0) throw new Error(`Invalid checkpoint: ${field}.`);
  return number;
}

function validSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(value) && value !== "." && value !== "..";
}

export function parseSessionConfig(raw: unknown): SessionConfig {
  if (!isObject(raw)) throw new Error("Invalid checkpoint: session data is missing.");
  if (raw.version !== 1) throw new Error("Unsupported checkpoint version.");
  const id = asString(raw.id, "session id");
  if (!validSessionId(id)) throw new Error("Invalid checkpoint: session id.");

  const outputMode = raw.outputMode;
  if (outputMode !== "flat" && outputMode !== "mirror") {
    throw new Error("Invalid checkpoint: output mode.");
  }

  if (!Array.isArray(raw.classes) || raw.classes.length === 0) {
    throw new Error("Invalid checkpoint: classes are missing.");
  }
  const seenIds = new Set<string>();
  const seenFolders = new Set<string>();
  const classes = raw.classes.map((entry, index) => {
    if (!isObject(entry)) throw new Error("Invalid checkpoint: class entry.");
    const classId = asString(entry.id, `class ${index + 1} id`);
    const name = asString(entry.name, `class ${index + 1} name`).trim();
    if (!name) throw new Error("Invalid checkpoint: empty class name.");
    if (seenIds.has(classId)) throw new Error("Invalid checkpoint: duplicate class id.");
    seenIds.add(classId);
    const folderName = sanitizeFolderName(name);
    if (seenFolders.has(folderName.toLowerCase())) {
      throw new Error("Invalid checkpoint: classes produce the same folder name.");
    }
    seenFolders.add(folderName.toLowerCase());
    return { id: classId, name, folderName };
  });

  const summaryRaw = raw.summary;
  let summary: SessionSummary | undefined;
  if (isObject(summaryRaw)) {
    summary = {
      labeled: asNonNegative(summaryRaw.labeled, "summary labeled"),
      copied: asNonNegative(summaryRaw.copied, "summary copied"),
      skipped: asNonNegative(summaryRaw.skipped, "summary skipped"),
      failed: asNonNegative(summaryRaw.failed, "summary failed"),
      updatedAt: typeof summaryRaw.updatedAt === "string" ? summaryRaw.updatedAt : "",
    };
  }

  return {
    version: 1,
    id,
    name: asString(raw.name, "session name"),
    createdAt: asString(raw.createdAt, "created date"),
    updatedAt: asString(raw.updatedAt, "updated date"),
    sourceName: asString(raw.sourceName, "source folder name"),
    resultName: asString(raw.resultName, "result folder name"),
    outputMode,
    classes,
    totalImages: asNonNegative(raw.totalImages, "image count"),
    totalBytes: asNonNegative(raw.totalBytes, "total size"),
    summary,
  };
}

export function parseManifestImage(raw: unknown): ManifestImage {
  if (!isObject(raw)) throw new Error("Invalid checkpoint: manifest entry.");
  const dir = asString(raw.dir, "image directory");
  const name = asString(raw.name, "image name");
  const path = asString(raw.path, "image path");
  if (!isSafeRelativePath(path)) throw new Error(`Invalid checkpoint image path: ${path}`);
  if (dir !== "." && !isSafeRelativePath(dir)) {
    throw new Error(`Invalid checkpoint image directory: ${dir}`);
  }
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error(`Invalid checkpoint image name: ${name}`);
  }
  if (joinRelativePath(dir, name) !== path) {
    throw new Error(`Checkpoint image path does not match its directory: ${path}`);
  }
  return {
    path,
    dir,
    name,
    size: asNonNegative(raw.size, "image size"),
    lastModified: asNonNegative(raw.lastModified, "image modified date"),
  };
}

function safeDest(value: unknown): string | null {
  if (typeof value !== "string" || !isSafeRelativePath(value)) return null;
  return value;
}

function safeEvent(raw: unknown, knownPaths: Set<string>): ProgressEvent | null {
  if (!isObject(raw)) return null;
  const seq = typeof raw.seq === "number" ? raw.seq : -1;
  const ts = typeof raw.ts === "number" ? raw.ts : -1;
  if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(ts) || ts < 0) return null;
  const type = raw.type;
  const base = { seq, ts };
  const path = typeof raw.path === "string" && knownPaths.has(raw.path) ? raw.path : null;

  switch (type) {
    case "label": {
      if (!path || typeof raw.classId !== "string" || typeof raw.className !== "string") return null;
      if (typeof raw.folderName !== "string") return null;
      const destPath = safeDest(raw.destPath);
      if (!destPath) return null;
      return {
        ...base,
        type,
        path,
        classId: raw.classId,
        className: raw.className,
        folderName: raw.folderName,
        destPath,
      };
    }
    case "copy_done": {
      if (!path || typeof raw.bytes !== "number" || raw.bytes < 0) return null;
      const destPath = safeDest(raw.destPath);
      if (!destPath) return null;
      return { ...base, type, path, destPath, bytes: raw.bytes };
    }
    case "copy_error": {
      if (!path || typeof raw.error !== "string") return null;
      const destPath = safeDest(raw.destPath);
      if (!destPath) return null;
      return { ...base, type, path, destPath, error: raw.error };
    }
    case "dest": {
      if (!path) return null;
      const destPath = safeDest(raw.destPath);
      if (!destPath) return null;
      return { ...base, type, path, destPath };
    }
    case "skip": {
      if (!path) return null;
      return { ...base, type, path };
    }
    case "undo": {
      if (!path || (raw.kind !== "label" && raw.kind !== "skip")) return null;
      return { ...base, type, path, kind: raw.kind };
    }
    case "retry": {
      if (!path) return null;
      const destPath = safeDest(raw.destPath);
      if (!destPath) return null;
      return { ...base, type, path, destPath };
    }
    case "finished": {
      if (
        typeof raw.copied !== "number" ||
        typeof raw.skipped !== "number" ||
        typeof raw.failed !== "number"
      ) {
        return null;
      }
      return {
        ...base,
        type,
        copied: raw.copied,
        skipped: raw.skipped,
        failed: raw.failed,
      };
    }
    default:
      return null;
  }
}

export interface SessionAction {
  kind: "label" | "skip";
  path: string;
}

export interface ReplayResult {
  states: Map<string, ImageState>;
  actions: SessionAction[];
  lastSeq: number;
  lastEventAt: number | null;
}

export function replayProgressEvents(events: ProgressEvent[]): ReplayResult {
  const states = new Map<string, ImageState>();
  const actions: SessionAction[] = [];
  let lastSeq = 0;
  let lastEventAt: number | null = null;

  const removeAction = (kind: "label" | "skip", path: string) => {
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      if (actions[index].kind === kind && actions[index].path === path) {
        actions.splice(index, 1);
        return;
      }
    }
  };

  for (const event of events) {
    lastSeq = Math.max(lastSeq, event.seq);
    lastEventAt = lastEventAt === null ? event.ts : Math.max(lastEventAt, event.ts);

    if (event.type === "label") {
      const existing = states.get(event.path);
      if (existing?.label) {
        // A duplicate label is not produced by the app, but keeping the latest
        // destination is the least surprising interpretation.
        states.delete(event.path);
      }
      states.set(event.path, {
        path: event.path,
        status: "preparing",
        label: {
          classId: event.classId,
          className: event.className,
          folderName: event.folderName,
          destPath: event.destPath,
        },
        updatedAt: event.ts,
      });
      actions.push({ kind: "label", path: event.path });
      continue;
    }

    if (event.type === "skip") {
      const existing = states.get(event.path);
      if (existing?.label) continue;
      states.set(event.path, { path: event.path, status: "skipped", updatedAt: event.ts });
      actions.push({ kind: "skip", path: event.path });
      continue;
    }

    if (event.type === "undo") {
      removeAction(event.kind, event.path);
      const state = states.get(event.path);
      if (event.kind === "label") {
        if (state?.label) states.delete(event.path);
      } else if (state?.status === "skipped" && !state.label) {
        states.delete(event.path);
      }
      continue;
    }

    if (event.type === "finished") continue;

    const state = states.get(event.path);
    if (!state?.label) continue;

    if (event.type === "dest") {
      state.label.destPath = event.destPath;
      state.updatedAt = event.ts;
      continue;
    }

    if (event.type === "retry") {
      state.label.destPath = event.destPath;
      state.status = "preparing";
      state.error = undefined;
      state.copiedBytes = undefined;
      state.updatedAt = event.ts;
      continue;
    }

    if (state.label.destPath !== event.destPath) continue;

    if (event.type === "copy_done") {
      state.status = "copied";
      state.copiedBytes = event.bytes;
      state.error = undefined;
      state.updatedAt = event.ts;
    } else if (event.type === "copy_error") {
      state.status = "failed";
      state.error = event.error;
      state.updatedAt = event.ts;
    }
  }

  return { states, actions, lastSeq, lastEventAt };
}

export function countsFromStates(states: Map<string, ImageState>, total: number): RuntimeCounts {
  let preparing = 0;
  let copying = 0;
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const state of states.values()) {
    if (state.status === "preparing") preparing += 1;
    else if (state.status === "copying") copying += 1;
    else if (state.status === "copied") copied += 1;
    else if (state.status === "skipped") skipped += 1;
    else if (state.status === "failed") failed += 1;
  }
  const labeled = preparing + copying + copied + failed;
  return {
    total,
    pending: Math.max(0, total - labeled - skipped),
    preparing,
    copying,
    copied,
    skipped,
    failed,
    labeled,
  };
}

export function summaryFromCounts(counts: RuntimeCounts, now = new Date().toISOString()): SessionSummary {
  return {
    labeled: counts.labeled,
    copied: counts.copied,
    skipped: counts.skipped,
    failed: counts.failed,
    updatedAt: now,
  };
}

export function destinationsInUse(states: Map<string, ImageState>): Set<string> {
  const paths = new Set<string>();
  for (const state of states.values()) {
    if (state.label) paths.add(state.label.destPath);
  }
  return paths;
}

export type ReconcileAction = "settled" | "retry-same" | "retry-new" | "leave";

/**
 * Decides how a replayed label should be reconciled against the real result
 * folder. A byte-size match is the resume contract: a file of the same size in
 * the recorded destination is treated as this session's completed copy.
 */
export function decideReconcileAction(
  status: ImageStatus,
  sourceSize: number,
  destinationSize: number | null,
): ReconcileAction {
  if (status === "copied" || status === "preparing" || status === "copying") {
    if (destinationSize === sourceSize) return "settled";
    if (destinationSize === null) return "retry-same";
    return "retry-new";
  }
  if (status === "failed" && destinationSize === sourceSize) return "settled";
  return "leave";
}

export async function readSessionConfig(
  result: FileSystemDirectoryHandle,
  sessionId: string,
): Promise<SessionConfig> {
  const raw = await readJsonFile<unknown>(result, checkpointPath(sessionId, SESSION_FILE));
  const config = parseSessionConfig(raw);
  if (config.id !== sessionId) throw new Error("Checkpoint session id does not match its folder.");
  return config;
}

export async function listStoredSessions(
  result: FileSystemDirectoryHandle,
): Promise<SessionConfig[]> {
  const ids = await listCheckpointSessionIds(result);
  const sessions: SessionConfig[] = [];
  for (const id of ids) {
    try {
      if (!validSessionId(id)) continue;
      sessions.push(await readSessionConfig(result, id));
    } catch {
      // Ignore unrelated folders and checkpoints that were not fully created.
    }
  }
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readSessionCheckpoint(
  result: FileSystemDirectoryHandle,
  sessionId: string,
): Promise<CheckpointSessionData> {
  const config = await readSessionConfig(result, sessionId);
  const manifestRaw = await readJsonLines<unknown>(
    result,
    checkpointPath(sessionId, MANIFEST_FILE),
  );
  const manifest = manifestRaw.map(parseManifestImage);
  if (manifest.length !== config.totalImages) {
    throw new Error(
      `Checkpoint is incomplete: expected ${config.totalImages} images, found ${manifest.length}.`,
    );
  }
  const paths = new Set<string>();
  for (const image of manifest) {
    if (paths.has(image.path)) throw new Error(`Checkpoint has a duplicate image path: ${image.path}`);
    paths.add(image.path);
  }

  const eventsRaw = await readJsonLines<unknown>(
    result,
    checkpointPath(sessionId, PROGRESS_FILE),
  );
  const events: ProgressEvent[] = [];
  for (const raw of eventsRaw) {
    const event = safeEvent(raw, paths);
    if (event) events.push(event);
  }
  return { config, manifest, events };
}

export interface CreateCheckpointProgress {
  written: number;
  total: number;
}

export async function createSessionCheckpoint(
  result: FileSystemDirectoryHandle,
  config: SessionConfig,
  manifest: ManifestImage[],
  onProgress?: (progress: CreateCheckpointProgress) => void,
): Promise<void> {
  if (!validSessionId(config.id)) throw new Error("Invalid session id.");
  if (manifest.length !== config.totalImages) {
    throw new Error("The image manifest does not match the session image count.");
  }
  for (const image of manifest) parseManifestImage(image);

  const base = checkpointBase(config.id);
  if (await directoryExistsAt(result, base)) {
    throw new Error("A checkpoint with this session id already exists in the result folder.");
  }

  let created = false;
  try {
    const directory = await getDirectoryAt(result, base, true);
    created = true;
    const handle = await directory.getFileHandle(MANIFEST_FILE, { create: true });
    const writer = await handle.createWritable();
    try {
      let buffer: string[] = [];
      let bufferSize = 0;
      let written = 0;
      for (const image of manifest) {
        const line = JSON.stringify(image);
        buffer.push(line);
        bufferSize += line.length + 1;
        written += 1;
        if (bufferSize >= 512 * 1024) {
          await writer.write(`${buffer.join("\n")}\n`);
          buffer = [];
          bufferSize = 0;
          onProgress?.({ written, total: manifest.length });
        }
      }
      if (buffer.length > 0) await writer.write(`${buffer.join("\n")}\n`);
      await writer.close();
      onProgress?.({ written: manifest.length, total: manifest.length });
    } catch (error) {
      try {
        await writer.abort(error);
      } catch {
        // Best effort.
      }
      throw error;
    }

    await writeJsonFile(result, checkpointPath(config.id, SESSION_FILE), config);
  } catch (error) {
    if (created) {
      try {
        await removeDirectoryAt(result, base);
      } catch {
        // Leave a partial folder behind rather than hiding the original error.
      }
    }
    throw error;
  }
}

export async function writeSessionConfig(
  result: FileSystemDirectoryHandle,
  config: SessionConfig,
): Promise<void> {
  await writeJsonFile(result, checkpointPath(config.id, SESSION_FILE), config);
}

export type CheckpointWriteState =
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

/**
 * Serializes JSONL appends. File System Access writes are asynchronous and a
 * single writer queue prevents interleaved lines.
 */
export class CheckpointEventWriter {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private failed = false;
  private lastError = "";
  private disposed = false;

  constructor(
    private readonly result: FileSystemDirectoryHandle,
    private readonly sessionId: string,
    private readonly onState: (state: CheckpointWriteState) => void,
  ) {}

  append(event: ProgressEvent): void {
    if (this.disposed) return;
    this.pending += 1;
    this.onState({ status: "saving" });
    const run = this.chain.then(() =>
      appendJsonLine(this.result, checkpointPath(this.sessionId, PROGRESS_FILE), event),
    );
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    run.then(
      () => {
        this.pending -= 1;
        this.finishWrite();
      },
      (error: unknown) => {
        this.pending -= 1;
        this.failed = true;
        this.lastError = error instanceof Error ? error.message : String(error);
        this.finishWrite();
      },
    );
  }

  private finishWrite(): void {
    if (this.pending > 0) return;
    if (this.failed) {
      this.onState({ status: "error", message: this.lastError || "Checkpoint write failed." });
    } else {
      this.onState({ status: "saved" });
    }
  }

  async flush(): Promise<void> {
    await this.chain;
  }

  dispose(): void {
    this.disposed = true;
  }
}
