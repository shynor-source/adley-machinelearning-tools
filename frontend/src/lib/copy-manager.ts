import { errorMessage } from "./path";

export interface CopyTask {
  id: string;
  sourcePath: string;
  destPath: string;
  expectedSize: number;
}

export interface CopyCallbacks {
  onStart?: (task: CopyTask) => void;
  onProgress?: (task: CopyTask, copiedBytes: number) => void;
  onDone?: (task: CopyTask, bytes: number) => void;
  onConflict?: (task: CopyTask, actualSize: number) => void;
  onError?: (task: CopyTask, message: string) => void;
}

interface TaskRecord {
  task: CopyTask;
  resolve: (outcome: CopyOutcome) => void;
}

interface WorkerSlot {
  worker: Worker;
  taskId: string | null;
}

export type CopyOutcome =
  | { status: "done"; bytes: number }
  | { status: "conflict"; actualSize: number }
  | { status: "error"; message: string }
  | { status: "cancelled" };

export class CopyManager {
  private slots: WorkerSlot[] = [];
  private queue: string[] = [];
  private records = new Map<string, TaskRecord>();
  private callbacks: CopyCallbacks;
  private disposed = false;

  constructor(
    private readonly source: FileSystemDirectoryHandle,
    private readonly result: FileSystemDirectoryHandle,
    callbacks: CopyCallbacks = {},
    concurrency = 2,
  ) {
    this.callbacks = callbacks;
    for (let index = 0; index < Math.max(1, concurrency); index += 1) {
      const slot: WorkerSlot = { worker: null as unknown as Worker, taskId: null };
      this.slots.push(slot);
      this.attachWorker(slot);
    }
  }

  get activeCount(): number {
    return this.slots.filter((slot) => slot.taskId !== null).length;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  enqueue(task: CopyTask): Promise<CopyOutcome> {
    if (this.disposed) {
      return Promise.resolve({ status: "error", message: "Copy manager is closed." });
    }
    if (this.records.has(task.id)) {
      return Promise.resolve({ status: "error", message: "Duplicate copy task." });
    }
    return new Promise((resolve) => {
      this.records.set(task.id, { task, resolve });
      this.queue.push(task.id);
      this.dispatch();
    });
  }

  private attachWorker(slot: WorkerSlot): void {
    const worker = new Worker(new URL("./copy.worker.ts", import.meta.url), { type: "module" });
    slot.worker = worker;
    slot.taskId = null;
    worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage(slot, event.data);
    worker.onerror = (event) => {
      const taskId = slot.taskId;
      const message = event.message || "The copy worker crashed.";
      if (taskId) {
        const record = this.records.get(taskId);
        if (record) {
          this.callbacks.onError?.(record.task, message);
          record.resolve({ status: "error", message });
          this.records.delete(taskId);
        }
      }
      slot.taskId = null;
      try {
        worker.terminate();
      } catch {
        // Best effort.
      }
      try {
        this.attachWorker(slot);
      } catch {
        // Keep the checkpoint recoverable if a replacement worker cannot start.
      }
      this.dispatch();
    };
    worker.postMessage({ type: "init", source: this.source, result: this.result });
  }

  private dispatch(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.taskId !== null) continue;
      let id = this.queue.shift();
      while (id && !this.records.has(id)) id = this.queue.shift();
      if (!id) return;
      const record = this.records.get(id);
      if (!record) continue;
      slot.taskId = id;
      this.callbacks.onStart?.(record.task);
      slot.worker.postMessage({
        type: "copy",
        taskId: record.task.id,
        sourcePath: record.task.sourcePath,
        destPath: record.task.destPath,
        expectedSize: record.task.expectedSize,
      });
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, data: Record<string, unknown>): void {
    const taskId = slot.taskId;
    if (!taskId) return;
    const record = this.records.get(taskId);
    if (!record) return;

    if (data.type === "progress") {
      this.callbacks.onProgress?.(record.task, Number(data.copiedBytes ?? 0));
      return;
    }
    if (data.type === "done") {
      const bytes = Number(data.bytes ?? 0);
      this.callbacks.onDone?.(record.task, bytes);
      this.finishTask(slot, record, { status: "done", bytes });
      return;
    }
    if (data.type === "conflict") {
      const actualSize = Number(data.actualSize ?? 0);
      this.callbacks.onConflict?.(record.task, actualSize);
      this.finishTask(slot, record, { status: "conflict", actualSize });
      return;
    }
    if (data.type === "error") {
      const message = String(data.error ?? "Copy failed.");
      this.callbacks.onError?.(record.task, message);
      this.finishTask(slot, record, { status: "error", message });
    }
  }

  private finishTask(slot: WorkerSlot, record: TaskRecord, outcome: CopyOutcome): void {
    this.records.delete(record.task.id);
    slot.taskId = null;
    record.resolve(outcome);
    this.dispatch();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
    for (const record of this.records.values()) {
      record.resolve({ status: "cancelled" });
    }
    this.records.clear();
    for (const slot of this.slots) {
      slot.worker.terminate();
    }
    this.slots = [];
  }
}

export function copyErrorMessage(error: unknown): string {
  return errorMessage(error);
}
