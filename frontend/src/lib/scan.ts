import { errorMessage } from "./path";
import type { ManifestImage, ScanProgress, ScanResult, ScanWarning } from "./types";

interface ScanCallbacks {
  onBatch?: (images: ManifestImage[], folders: string[]) => void;
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

export function scanSourceFolder(
  source: FileSystemDirectoryHandle,
  excludedPaths: string[],
  callbacks: ScanCallbacks = {},
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    const images: ManifestImage[] = [];
    const folders = new Set<string>([""]);
    let settled = false;

    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      callbacks.signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(result);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      callbacks.signal?.removeEventListener("abort", abort);
      worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const abort = () => {
      worker.postMessage({ type: "cancel" });
      worker.terminate();
      fail(new DOMException("Scan cancelled.", "AbortError"));
    };

    if (callbacks.signal?.aborted) {
      abort();
      return;
    }
    callbacks.signal?.addEventListener("abort", abort, { once: true });

    worker.onerror = (event) => {
      fail(new Error(event.message || "The scan worker failed."));
    };

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        type: string;
        images?: ManifestImage[];
        folders?: string[];
        progress?: ScanProgress;
        warnings?: ScanWarning[];
        ignoredFiles?: number;
        elapsedMs?: number;
        message?: string;
      };

      if (message.type === "batch") {
        const nextImages = message.images ?? [];
        const nextFolders = message.folders ?? [];
        images.push(...nextImages);
        nextFolders.forEach((folder) => folders.add(folder));
        callbacks.onBatch?.(nextImages, nextFolders);
        return;
      }
      if (message.type === "progress" && message.progress) {
        callbacks.onProgress?.(message.progress);
        return;
      }
      if (message.type === "cancelled") {
        fail(new DOMException("Scan cancelled.", "AbortError"));
        return;
      }
      if (message.type === "error") {
        fail(new Error(message.message || "Could not scan the source folder."));
        return;
      }
      if (message.type === "done") {
        const totalBytes = images.reduce((sum, image) => sum + image.size, 0);
        finish({
          images,
          folders: Array.from(folders).sort((a, b) => a.localeCompare(b)),
          warnings: message.warnings ?? [],
          totalBytes,
          elapsedMs: message.elapsedMs ?? 0,
          ignoredFiles: message.ignoredFiles ?? 0,
        });
      }
    };

    worker.postMessage({ type: "start", source, excludedPaths });
  });
}

export function scanErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Scan cancelled.";
  return errorMessage(error);
}
