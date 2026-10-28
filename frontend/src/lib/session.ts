import { CopyManager, type CopyOutcome, type CopyTask } from "./copy-manager";
import {
  CheckpointEventWriter,
  countsFromStates,
  decideReconcileAction,
  destinationsInUse,
  replayProgressEvents,
  summaryFromCounts,
  writeSessionConfig,
  type CheckpointWriteState,
  type SessionAction,
} from "./checkpoint";
import {
  fileExistsAt,
  fileSizeAt,
  getDirectoryAt,
  isNotFound,
  nameOf,
  removeFileAt,
} from "./fs";
import { errorMessage, findAvailableDestination, parentPath } from "./path";
import type {
  CheckpointSessionData,
  CopyFailure,
  ImageLabel,
  ImageState,
  ImageStatus,
  ManifestImage,
  ProgressEvent,
  RecentLabel,
  RuntimeCounts,
  RuntimeNotice,
  RuntimeSnapshot,
  SessionConfig,
} from "./types";

export interface SessionOpenOptions {
  source: FileSystemDirectoryHandle;
  result: FileSystemDirectoryHandle;
  config: SessionConfig;
  manifest: ManifestImage[];
  events: ProgressEvent[];
}

interface PendingCopy {
  taskId: string;
  destPath: string;
  promise: Promise<CopyOutcome>;
}

type ProgressEventPayload =
  | Omit<Extract<ProgressEvent, { type: "label" }>, "seq" | "ts">
  | Omit<Extract<ProgressEvent, { type: "copy_done" }>, "seq" | "ts">
  | Omit<Extract<ProgressEvent, { type: "copy_error" }>, "seq" | "ts">
  | Omit<Extract<ProgressEvent, { type: "dest" }>, "seq" | "ts">
  | Omit<Extract<ProgressEvent, { type: "skip" }>, "seq" | "ts">
  | Omit<Extract<ProgressEvent, { type: "undo" }>, "seq" | "ts">
  | Omit<Extract<ProgressEvent, { type: "retry" }>, "seq" | "ts">
  | Omit<Extract<ProgressEvent, { type: "finished" }>, "seq" | "ts">;

const COPY_CONCURRENCY = 2;
const RECONCILE_CONCURRENCY = 8;
const CONFLICT_RETRY_LIMIT = 25;

function pendingState(path: string): ImageState {
  return { path, status: "pending", updatedAt: 0 };
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export class SessionRuntime {
  readonly source: FileSystemDirectoryHandle;
  readonly result: FileSystemDirectoryHandle;

  private config: SessionConfig;
  private readonly manifest: ManifestImage[];
  private readonly manifestByPath = new Map<string, ManifestImage>();
  private readonly indexByPath = new Map<string, number>();
  private readonly states: Map<string, ImageState>;
  private readonly actions: SessionAction[];
  private readonly writer: CheckpointEventWriter;
  private readonly copyManager: CopyManager;
  private readonly listeners = new Set<() => void>();
  private readonly failedPaths = new Set<string>();
  private readonly destinations: Set<string>;
  private readonly pendingCopies = new Map<string, PendingCopy>();
  private readonly conflictAttempts = new Map<string, number>();
  private readonly destDirCache = new Map<string, Promise<FileSystemDirectoryHandle | null>>();

  private counts: RuntimeCounts;
  private cursorIndex: number;
  private nextSeq: number;
  private snapshot: RuntimeSnapshot;
  private initializePromise: Promise<void>;
  private status: RuntimeSnapshot["status"] = "loading";
  private paused = false;
  private busy = false;
  private closed = false;
  private fatalError: string | undefined;
  private notice: RuntimeNotice | null = null;
  private reconcile: { done: number; total: number } | null = { done: 0, total: 0 };
  private lastEventAt: number | null;
  private lastProgressEmit = 0;
  private cleanupCount = 0;
  private taskCounter = 0;
  private allocationChain: Promise<unknown> = Promise.resolve();
  private configWriteChain: Promise<void> = Promise.resolve();
  private configTimer: ReturnType<typeof setTimeout> | null = null;
  private eventSaving = false;
  private configSaving = false;
  private checkpointHadError = false;
  private checkpointError = "";
  private checkpointWasWritten = false;
  private checkpointStatus: RuntimeSnapshot["checkpointStatus"] = "idle";
  private copyRefreshScheduled = false;

  private constructor(options: SessionOpenOptions) {
    this.source = options.source;
    this.result = options.result;
    this.config = { ...options.config, classes: options.config.classes.map((item) => ({ ...item })) };
    this.manifest = options.manifest;
    this.manifest.forEach((image, index) => {
      this.manifestByPath.set(image.path, image);
      this.indexByPath.set(image.path, index);
    });

    const replay = replayProgressEvents(options.events);
    this.states = replay.states;
    this.actions = replay.actions;
    this.destinations = destinationsInUse(replay.states);
    this.counts = countsFromStates(replay.states, this.manifest.length);
    this.nextSeq = replay.lastSeq + 1;
    this.lastEventAt = replay.lastEventAt;
    for (const [path, state] of replay.states) {
      if (state.status === "failed") this.failedPaths.add(path);
    }
    this.cursorIndex = this.findNextPendingIndex(0);

    this.copyManager = new CopyManager(options.source, options.result, {
      onStart: (task) => this.handleCopyStart(task),
      onProgress: (task, bytes) => this.handleCopyProgress(task, bytes),
      onDone: (task, bytes) => this.handleCopyDone(task, bytes),
      onConflict: (task, actualSize) => this.handleCopyConflict(task, actualSize),
      onError: (task, message) => this.handleCopyError(task, message),
    }, COPY_CONCURRENCY);

    this.writer = new CheckpointEventWriter(options.result, this.config.id, (state) =>
      this.handleCheckpointState(state),
    );
    this.snapshot = this.buildSnapshot();
    this.initializePromise = this.initialize();
  }

  static open(options: SessionOpenOptions): SessionRuntime {
    return new SessionRuntime(options);
  }

  static fromCheckpoint(
    source: FileSystemDirectoryHandle,
    result: FileSystemDirectoryHandle,
    checkpoint: CheckpointSessionData,
  ): SessionRuntime {
    return new SessionRuntime({ source, result, ...checkpoint });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RuntimeSnapshot => this.snapshot;

  get sessionId(): string {
    return this.config.id;
  }

  getConfig(): SessionConfig {
    return this.config;
  }

  /** Pending images starting at the current cursor, for preview prefetching. */
  peekUpcoming(limit = 3): ManifestImage[] {
    const upcoming: ManifestImage[] = [];
    for (
      let index = this.cursorIndex;
      index < this.manifest.length && upcoming.length < limit;
      index += 1
    ) {
      const image = this.manifest[index];
      if (!this.states.has(image.path)) upcoming.push(image);
    }
    return upcoming;
  }

  ready(): Promise<void> {
    return this.initializePromise;
  }

  private async initialize(): Promise<void> {
    this.status = "loading";
    this.reconcile = { done: 0, total: 0 };
    this.emit();
    try {
      const candidates: ImageState[] = [];
      for (const state of this.states.values()) {
        if (state.label) candidates.push(state);
      }
      this.reconcile = { done: 0, total: candidates.length };
      this.emit();

      let done = 0;
      let lastReport = 0;
      await runPool(candidates, RECONCILE_CONCURRENCY, async (state) => {
        try {
          await this.reconcileState(state);
        } catch (error) {
          const message = `Could not verify ${state.label?.destPath ?? state.path}: ${errorMessage(error)}`;
          // A state stuck in preparing/copying would keep the queue open
          // forever with no active worker. Surface it as a retryable failure.
          if (state.status === "preparing" || state.status === "copying") {
            this.failCopy(state.path, message);
          } else {
            this.reportNotice("error", message);
          }
        }
        done += 1;
        const now = performance.now();
        if (done === candidates.length || now - lastReport > 200) {
          lastReport = now;
          this.reconcile = { done, total: candidates.length };
          this.emit();
        }
      });

      this.reconcile = null;
      this.cursorIndex = this.findNextPendingIndex(0);
      // Reconciliation is complete. Leave the loading state explicitly before
      // recalculating readiness; updateStatus intentionally ignores loading.
      this.status = "ready";
      this.updateStatus();
      this.scheduleConfigSave();
      this.emit();
    } catch (error) {
      this.reconcile = null;
      this.fatalError = errorMessage(error);
      this.status = "error";
      this.emit();
    }
  }

  private async reconcileState(state: ImageState): Promise<void> {
    const image = this.manifestByPath.get(state.path);
    if (!image || !state.label) return;
    const destPath = state.label.destPath;
    const size = await this.destinationSizeForReconcile(destPath);
    const action = decideReconcileAction(state.status, image.size, size);

    if (action === "settled") {
      if (state.status === "copied") {
        state.copiedBytes = image.size;
      } else {
        this.applyCopyDone(state.path, destPath, image.size);
      }
      return;
    }
    if (action === "retry-same") {
      await this.retryCopy(state, destPath);
      return;
    }
    if (action === "retry-new") {
      await this.retryCopyWithNewDestination(state);
    }
  }

  private async destinationSizeForReconcile(destPath: string): Promise<number | null> {
    const parent = parentPath(destPath);
    let handlePromise = this.destDirCache.get(parent);
    if (!handlePromise) {
      handlePromise = getDirectoryAt(this.result, parent, false).catch((error: unknown) => {
        if (isNotFound(error)) return null;
        throw error;
      });
      this.destDirCache.set(parent, handlePromise);
    }
    const directory = await handlePromise;
    if (!directory) return null;
    try {
      const fileHandle = await directory.getFileHandle(nameOf(destPath));
      const file = await fileHandle.getFile();
      return file.size;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private buildSnapshot(): RuntimeSnapshot {
    const current = this.manifest[this.cursorIndex] ?? null;
    const currentState = current
      ? this.states.get(current.path) ?? pendingState(current.path)
      : null;
    return {
      status: this.status,
      config: this.config,
      current,
      currentState,
      position: current ? this.cursorIndex + 1 : this.manifest.length,
      counts: { ...this.counts },
      paused: this.paused,
      busy: this.busy,
      checkpointStatus: this.checkpointStatus,
      checkpointError: this.checkpointError || undefined,
      error: this.fatalError,
      notice: this.notice,
      reconcile: this.reconcile ? { ...this.reconcile } : null,
      failures: this.collectFailures(),
      recentLabels: this.collectRecentLabels(),
      canUndo: this.actions.length > 0 && !this.busy && this.status !== "loading" && this.status !== "error",
      activeCopies: this.copyManager.activeCount,
      cleanupCount: this.cleanupCount,
      lastEventAt: this.lastEventAt,
    };
  }

  private collectFailures(): CopyFailure[] {
    const failures: CopyFailure[] = [];
    for (const path of this.failedPaths) {
      if (failures.length >= 100) break;
      const state = this.states.get(path);
      const image = this.manifestByPath.get(path);
      if (!state?.label || !image) continue;
      failures.push({
        path,
        name: image.name,
        className: state.label.className,
        error: state.error ?? "Copy failed.",
        destPath: state.label.destPath,
      });
    }
    return failures;
  }

  private collectRecentLabels(): RecentLabel[] {
    const recent: RecentLabel[] = [];
    for (let index = this.actions.length - 1; index >= 0 && recent.length < 8; index -= 1) {
      const action = this.actions[index];
      if (action.kind !== "label") continue;
      const state = this.states.get(action.path);
      const image = this.manifestByPath.get(action.path);
      if (!state?.label || !image) continue;
      recent.push({
        path: action.path,
        name: image.name,
        classId: state.label.classId,
        className: state.label.className,
        folderName: state.label.folderName,
        destPath: state.label.destPath,
        status: state.status,
        copiedBytes: state.copiedBytes,
      });
    }
    return recent;
  }

  private findNextPendingIndex(start: number): number {
    for (let index = Math.max(0, start); index < this.manifest.length; index += 1) {
      if (!this.states.has(this.manifest[index].path)) return index;
    }
    return this.manifest.length;
  }

  private emit(): void {
    if (this.closed) return;
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  async label(classId: string): Promise<void> {
    if (this.closed) throw new Error("The session is closed.");
    if (this.status !== "ready" || this.paused || this.busy) return;
    const image = this.manifest[this.cursorIndex];
    if (!image) return;
    if (this.states.has(image.path)) {
      this.cursorIndex = this.findNextPendingIndex(this.cursorIndex + 1);
      this.emit();
      return;
    }
    const definition = this.config.classes.find((item) => item.id === classId);
    if (!definition) throw new Error("The selected class no longer exists.");

    this.busy = true;
    this.emit();
    try {
      const destPath = await this.withAllocationLock(() =>
        this.allocateDestination(image, definition.folderName),
      );
      if (this.closed) return;
      if (this.states.has(image.path)) {
        this.destinations.delete(destPath);
        return;
      }

      const label: ImageLabel = {
        classId: definition.id,
        className: definition.name,
        folderName: definition.folderName,
        destPath,
      };
      this.states.set(image.path, {
        path: image.path,
        status: "preparing",
        label,
        updatedAt: Date.now(),
      });
      this.bump("preparing", 1);
      this.failedPaths.delete(image.path);
      this.actions.push({ kind: "label", path: image.path });
      this.appendEvent({
        type: "label",
        path: image.path,
        classId: label.classId,
        className: label.className,
        folderName: label.folderName,
        destPath: label.destPath,
      });
      this.advanceCursor(image.path);
      this.commit();
      this.enqueueCopy(image, label);
    } catch (error) {
      throw new Error(errorMessage(error));
    } finally {
      this.busy = false;
      this.updateStatus();
      this.emit();
    }
  }

  skip(): void {
    if (this.status !== "ready" || this.paused || this.busy) return;
    const image = this.manifest[this.cursorIndex];
    if (!image || this.states.has(image.path)) return;
    this.states.set(image.path, {
      path: image.path,
      status: "skipped",
      updatedAt: Date.now(),
    });
    this.bump("skipped", 1);
    this.actions.push({ kind: "skip", path: image.path });
    this.appendEvent({ type: "skip", path: image.path });
    this.advanceCursor(image.path);
    this.commit();
  }

  async undo(): Promise<void> {
    if (this.status === "loading" || this.status === "error" || this.busy) return;
    const action = this.actions[this.actions.length - 1];
    if (!action) return;

    this.busy = true;
    this.emit();
    const index = this.indexByPath.get(action.path);
    const state = this.states.get(action.path);

    if (action.kind === "skip") {
      this.actions.pop();
      if (state?.status === "skipped") this.deleteState(action.path);
      this.appendEvent({ type: "undo", path: action.path, kind: "skip" });
      if (index !== undefined) this.cursorIndex = index;
      this.busy = false;
      this.commit();
      return;
    }

    const label = state?.label;
    const expectedSize = this.manifestByPath.get(action.path)?.size ?? 0;
    const pendingCopy = this.pendingCopies.get(action.path);
    this.actions.pop();
    if (state?.label) this.deleteState(action.path);
    this.appendEvent({ type: "undo", path: action.path, kind: "label" });
    if (index !== undefined) this.cursorIndex = index;
    this.busy = false;
    this.commit();
    this.emit();

    if (label) {
      this.cleanupCount += 1;
      this.emit();
      void this.cleanupUndoneCopy(action.path, label.destPath, expectedSize, pendingCopy);
    }
  }

  pause(): void {
    if (this.closed || this.paused) return;
    this.paused = true;
    void this.queueConfigSave();
    this.emit();
  }

  resume(): void {
    if (this.closed || !this.paused) return;
    this.paused = false;
    void this.queueConfigSave();
    this.emit();
  }

  async retryFailed(path?: string): Promise<void> {
    if (this.closed || this.status === "loading" || this.status === "error" || this.busy) return;
    const paths = path ? [path] : Array.from(this.failedPaths);
    if (paths.length === 0) return;

    this.busy = true;
    this.emit();
    try {
      for (const candidate of paths) {
        const state = this.states.get(candidate);
        const image = this.manifestByPath.get(candidate);
        if (!state?.label || !image || state.status !== "failed") continue;
        try {
          const size = await fileSizeAt(this.result, state.label.destPath).catch((error: unknown) => {
            if (isNotFound(error)) return null;
            throw error;
          });
          if (size === image.size) {
            this.applyCopyDone(state.path, state.label.destPath, image.size);
            this.pendingCopies.delete(state.path);
            continue;
          }
          if (size === null) {
            await this.retryCopy(state, state.label.destPath);
          } else {
            await this.retryCopyWithNewDestination(state);
          }
        } catch (error) {
          this.reportNotice(
            "error",
            `Could not retry ${image.name}: ${errorMessage(error)}`,
          );
        }
      }
    } finally {
      this.busy = false;
      this.commit();
    }
  }

  clearNotice(): void {
    if (!this.notice) return;
    this.notice = null;
    this.emit();
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.configWriteChain;
      return;
    }
    this.closed = true;
    if (this.configTimer) {
      clearTimeout(this.configTimer);
      this.configTimer = null;
    }
    this.copyManager.dispose();
    try {
      await this.writer.flush();
    } catch {
      // The checkpoint is best-effort on close; resume reconciliation can
      // recover any completed copy that did not get its final event.
    }
    try {
      const config = this.makeConfigSnapshot();
      const run = this.configWriteChain.then(() => writeSessionConfig(this.result, config));
      this.configWriteChain = run.then(
        () => undefined,
        () => undefined,
      );
      await run;
    } catch {
      // Best effort only.
    }
    this.writer.dispose();
    this.listeners.clear();
  }

  private appendEvent(payload: ProgressEventPayload): void {
    const event = {
      ...payload,
      seq: this.nextSeq,
      ts: Date.now(),
    } as ProgressEvent;
    this.nextSeq += 1;
    this.lastEventAt = event.ts;
    this.writer.append(event);
  }

  private commit(): void {
    this.scheduleConfigSave();
    this.updateStatus();
    this.emit();
  }

  private updateStatus(): void {
    if (this.status === "loading" || this.status === "error") return;
    const copying = this.counts.preparing > 0 || this.counts.copying > 0;
    this.status =
      this.counts.pending > 0 || copying || this.copyManager.activeCount > 0
        ? "ready"
        : "complete";
  }

  private bump(status: ImageStatus, delta: number): void {
    if (status === "preparing") this.counts.preparing += delta;
    else if (status === "copying") this.counts.copying += delta;
    else if (status === "copied") this.counts.copied += delta;
    else if (status === "skipped") this.counts.skipped += delta;
    else if (status === "failed") this.counts.failed += delta;
    this.counts.labeled =
      this.counts.preparing + this.counts.copying + this.counts.copied + this.counts.failed;
    this.counts.pending = Math.max(
      0,
      this.counts.total - this.counts.labeled - this.counts.skipped,
    );
  }

  private setStatus(state: ImageState, next: ImageStatus): void {
    if (state.status === next) return;
    this.bump(state.status, -1);
    state.status = next;
    state.updatedAt = Date.now();
    this.bump(next, 1);
    if (next === "failed") this.failedPaths.add(state.path);
    else this.failedPaths.delete(state.path);
  }

  private deleteState(path: string): void {
    const state = this.states.get(path);
    if (!state) return;
    this.bump(state.status, -1);
    this.states.delete(path);
    this.failedPaths.delete(path);
    this.conflictAttempts.delete(path);
  }

  private advanceCursor(path: string): void {
    const index = this.indexByPath.get(path);
    const start = index === undefined ? this.cursorIndex + 1 : index + 1;
    this.cursorIndex = this.findNextPendingIndex(start);
  }

  private withAllocationLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.allocationChain.then(operation, operation);
    this.allocationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async allocateDestination(
    image: ManifestImage,
    classFolder: string,
  ): Promise<string> {
    const { destPath } = await findAvailableDestination(
      image,
      classFolder,
      this.config.outputMode,
      async (candidate) =>
        this.destinations.has(candidate) || (await fileExistsAt(this.result, candidate)),
    );
    this.destinations.add(destPath);
    return destPath;
  }

  private enqueueCopy(image: ManifestImage, label: ImageLabel): void {
    if (this.closed) return;
    this.taskCounter += 1;
    const task: CopyTask = {
      id: `${image.path}#task-${this.taskCounter}`,
      sourcePath: image.path,
      destPath: label.destPath,
      expectedSize: image.size,
    };
    try {
      const promise = this.copyManager.enqueue(task);
      this.pendingCopies.set(image.path, {
        taskId: task.id,
        destPath: label.destPath,
        promise,
      });
      void promise.catch((error: unknown) => {
        const current = this.pendingCopies.get(image.path);
        if (current?.taskId === task.id) {
          this.failCopy(image.path, errorMessage(error));
        }
      });
    } catch (error) {
      this.failCopy(image.path, errorMessage(error));
    }
  }

  private handleCopyStart(task: CopyTask): void {
    const state = this.states.get(task.sourcePath);
    if (!state?.label || state.label.destPath !== task.destPath) return;
    if (state.status === "preparing") {
      this.setStatus(state, "copying");
      state.copiedBytes = 0;
      this.commit();
    }
  }

  private handleCopyProgress(task: CopyTask, copiedBytes: number): void {
    const state = this.states.get(task.sourcePath);
    if (!state?.label || state.label.destPath !== task.destPath) return;
    state.copiedBytes = copiedBytes;
    const now = performance.now();
    if (now - this.lastProgressEmit > 150) {
      this.lastProgressEmit = now;
      this.emit();
    }
  }

  private handleCopyDone(task: CopyTask, bytes: number): void {
    const state = this.states.get(task.sourcePath);
    if (!state?.label || state.label.destPath !== task.destPath) {
      this.clearPendingCopy(task);
      return;
    }
    this.applyCopyDone(task.sourcePath, task.destPath, bytes);
    this.pendingCopies.delete(task.sourcePath);
    this.conflictAttempts.delete(task.sourcePath);
    this.commit();
    this.scheduleCopyRefresh();
  }

  private applyCopyDone(path: string, destPath: string, bytes: number): void {
    const state = this.states.get(path);
    if (!state?.label || state.label.destPath !== destPath) return;
    this.setStatus(state, "copied");
    state.copiedBytes = bytes;
    state.error = undefined;
    this.failedPaths.delete(path);
    this.appendEvent({ type: "copy_done", path, destPath, bytes });
  }

  private handleCopyError(task: CopyTask, message: string): void {
    const state = this.states.get(task.sourcePath);
    if (!state?.label || state.label.destPath !== task.destPath) {
      this.clearPendingCopy(task);
      return;
    }
    this.failCopy(task.sourcePath, message);
  }

  private failCopy(path: string, message: string): void {
    const state = this.states.get(path);
    if (!state?.label) return;
    this.setStatus(state, "failed");
    state.error = message;
    this.appendEvent({
      type: "copy_error",
      path,
      destPath: state.label.destPath,
      error: message,
    });
    this.pendingCopies.delete(path);
    this.commit();
    this.scheduleCopyRefresh();
  }

  private handleCopyConflict(task: CopyTask, _actualSize: number): void {
    const state = this.states.get(task.sourcePath);
    if (!state?.label || state.label.destPath !== task.destPath) {
      this.clearPendingCopy(task);
      return;
    }
    const current = this.pendingCopies.get(task.sourcePath);
    if (current?.taskId === task.id) this.pendingCopies.delete(task.sourcePath);
    void this.resolveDestinationConflict(task);
  }

  private async resolveDestinationConflict(task: CopyTask): Promise<void> {
    const state = this.states.get(task.sourcePath);
    const image = this.manifestByPath.get(task.sourcePath);
    if (!state?.label || !image || state.label.destPath !== task.destPath) return;
    const attempts = (this.conflictAttempts.get(task.sourcePath) ?? 0) + 1;
    this.conflictAttempts.set(task.sourcePath, attempts);
    if (attempts > CONFLICT_RETRY_LIMIT) {
      this.failCopy(
        task.sourcePath,
        "The destination filename kept changing. Retry the copy to choose a new name.",
      );
      return;
    }

    try {
      const oldDest = state.label.destPath;
      const newDest = await this.withAllocationLock(async () => {
        this.destinations.delete(oldDest);
        return this.allocateDestination(image, state.label!.folderName);
      });
      if (this.closed) return;
      const latest = this.states.get(task.sourcePath);
      if (
        !latest?.label ||
        latest.label.destPath !== oldDest ||
        latest.status === "copied" ||
        latest.status === "failed"
      ) {
        return;
      }
      latest.label.destPath = newDest;
      this.setStatus(latest, "preparing");
      latest.error = undefined;
      latest.copiedBytes = undefined;
      this.appendEvent({
        type: "dest",
        path: latest.path,
        destPath: newDest,
      });
      this.enqueueCopy(image, latest.label);
      this.commit();
    } catch (error) {
      this.failCopy(
        task.sourcePath,
        `Could not choose a new destination: ${errorMessage(error)}`,
      );
    }
  }

  private clearPendingCopy(task: CopyTask): void {
    const current = this.pendingCopies.get(task.sourcePath);
    if (current?.taskId === task.id) this.pendingCopies.delete(task.sourcePath);
  }

  private scheduleCopyRefresh(): void {
    if (this.copyRefreshScheduled) return;
    this.copyRefreshScheduled = true;
    queueMicrotask(() => {
      this.copyRefreshScheduled = false;
      if (this.closed) return;
      this.updateStatus();
      this.emit();
    });
  }

  private async retryCopy(state: ImageState, destPath: string): Promise<void> {
    const image = this.manifestByPath.get(state.path);
    if (!image || !state.label) return;
    state.label.destPath = destPath;
    this.destinations.add(destPath);
    this.setStatus(state, "preparing");
    state.error = undefined;
    state.copiedBytes = undefined;
    this.appendEvent({ type: "retry", path: state.path, destPath });
    this.enqueueCopy(image, state.label);
    this.commit();
  }

  private async retryCopyWithNewDestination(state: ImageState): Promise<void> {
    const image = this.manifestByPath.get(state.path);
    if (!image || !state.label) return;
    const oldDest = state.label.destPath;
    const folderName = state.label.folderName;
    const destPath = await this.withAllocationLock(async () => {
      this.destinations.delete(oldDest);
      return this.allocateDestination(image, folderName);
    });
    await this.retryCopy(state, destPath);
  }

  private async cleanupUndoneCopy(
    path: string,
    destPath: string,
    expectedSize: number,
    pending: PendingCopy | undefined,
  ): Promise<void> {
    try {
      let ownedByThisSession = !pending;
      if (pending) {
        const outcome = await pending.promise;
        ownedByThisSession = outcome.status === "done";
      }
      if (this.closed || !ownedByThisSession) return;
      const size = await fileSizeAt(this.result, destPath).catch((error: unknown) => {
        if (isNotFound(error)) return null;
        throw error;
      });
      if (size === expectedSize) {
        await removeFileAt(this.result, destPath);
      }
    } catch (error) {
      this.reportNotice(
        "error",
        `The label was undone, but the copied file could not be removed: ${errorMessage(error)}`,
      );
    } finally {
      this.destinations.delete(destPath);
      const current = this.pendingCopies.get(path);
      if (pending && current?.taskId === pending.taskId) this.pendingCopies.delete(path);
      this.cleanupCount = Math.max(0, this.cleanupCount - 1);
      if (!this.closed) {
        this.updateStatus();
        this.emit();
      }
    }
  }

  private scheduleConfigSave(): void {
    if (this.closed || this.configTimer) return;
    this.configTimer = setTimeout(() => {
      this.configTimer = null;
      void this.queueConfigSave();
    }, 1200);
  }

  private makeConfigSnapshot(): SessionConfig {
    const now = new Date().toISOString();
    const next: SessionConfig = {
      ...this.config,
      updatedAt: now,
      classes: this.config.classes.map((item) => ({ ...item })),
      summary: summaryFromCounts(this.counts, now),
    };
    this.config = next;
    return next;
  }

  private queueConfigSave(): Promise<void> {
    const config = this.makeConfigSnapshot();
    this.configSaving = true;
    this.checkpointWasWritten = true;
    this.syncCheckpointStatus();
    if (!this.closed) this.emit();
    const run = this.configWriteChain.then(() => writeSessionConfig(this.result, config));
    this.configWriteChain = run.then(
      () => undefined,
      () => undefined,
    );
    void run.then(
      () => {
        this.configSaving = false;
        this.syncCheckpointStatus();
        if (!this.closed) this.emit();
      },
      (error: unknown) => {
        this.configSaving = false;
        this.markCheckpointError(error);
      },
    );
    return run.then(
      () => undefined,
      () => undefined,
    );
  }

  private handleCheckpointState(state: CheckpointWriteState): void {
    if (state.status === "saving") {
      this.eventSaving = true;
      this.checkpointWasWritten = true;
    } else if (state.status === "saved") {
      this.eventSaving = false;
    } else {
      this.eventSaving = false;
      this.markCheckpointError(new Error(state.message));
      return;
    }
    this.syncCheckpointStatus();
    if (!this.closed) this.emit();
  }

  private markCheckpointError(error: unknown): void {
    this.checkpointHadError = true;
    this.checkpointError = errorMessage(error);
    this.syncCheckpointStatus();
    this.paused = true;
    this.reportNotice(
      "error",
      `Checkpoint saving failed. The session was paused. ${this.checkpointError}`,
    );
    if (!this.closed) this.emit();
  }

  private syncCheckpointStatus(): void {
    if (this.checkpointHadError) {
      this.checkpointStatus = "error";
    } else if (this.eventSaving || this.configSaving) {
      this.checkpointStatus = "saving";
    } else if (this.checkpointWasWritten) {
      this.checkpointStatus = "saved";
    } else {
      this.checkpointStatus = "idle";
    }
  }

  private reportNotice(kind: RuntimeNotice["kind"], text: string): void {
    if (this.notice?.kind === kind && this.notice.text === text) return;
    this.notice = { kind, text };
  }
}
