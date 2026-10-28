import type { PreviewResult, PreviewWorkerResponse } from "./types";

interface PendingPreview {
  resolve: (result: PreviewResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<string, PendingPreview>();

function failAll(message: string): void {
  for (const request of pending.values()) {
    request.reject(new Error(message));
  }
  pending.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const nextWorker = new Worker(new URL("./preview.worker.ts", import.meta.url), {
    type: "module",
  });
  nextWorker.onmessage = (event: MessageEvent<PreviewWorkerResponse>) => {
    const message = event.data;
    const request = pending.get(message.id);
    if (!request) {
      if (message.type === "loaded") message.bitmap.close();
      return;
    }
    pending.delete(message.id);
    if (message.type === "loaded") {
      request.resolve({ bitmap: message.bitmap, width: message.width, height: message.height });
    } else {
      request.reject(new Error(message.message));
    }
  };
  nextWorker.onerror = (event) => {
    failAll(event.message || "The preview worker failed.");
  };
  worker = nextWorker;
  return nextWorker;
}

/** Decodes a local file off the main thread and returns a bounded bitmap. */
export function renderPreview(file: File): Promise<PreviewResult> {
  return new Promise((resolve, reject) => {
    sequence += 1;
    const id = `preview-${sequence}`;
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ type: "load", id, file });
    } catch (error) {
      pending.delete(id);
      failAll(error instanceof Error ? error.message : String(error));
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function disposePreviewWorker(): void {
  failAll("Preview worker was closed.");
}
