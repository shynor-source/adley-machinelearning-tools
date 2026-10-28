import { isSupportedImage, joinRelativePath, isExcludedPath, errorMessage } from "./path";
import type { ManifestImage, ScanProgress, ScanWarning } from "./types";

interface StartMessage {
  type: "start";
  source: FileSystemDirectoryHandle;
  excludedPaths: string[];
}

interface CancelMessage {
  type: "cancel";
}

type IncomingMessage = StartMessage | CancelMessage;

interface WorkerScope {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null;
  postMessage(message: unknown): void;
}

const ctx = self as unknown as WorkerScope;
let cancelled = false;

ctx.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }
  if (message.type !== "start") return;
  await runScan(message.source, message.excludedPaths);
};

async function runScan(source: FileSystemDirectoryHandle, excludedPaths: string[]): Promise<void> {
  const started = performance.now();
  const folders = new Set<string>([""]);
  const warnings: ScanWarning[] = [];
  const pendingImages: ManifestImage[] = [];
  const pendingFolders: string[] = [];
  let imagesFound = 0;
  let bytesFound = 0;
  let scannedEntries = 0;
  let ignoredFiles = 0;
  let lastProgress = 0;

  const postProgress = (currentPath: string, force = false) => {
    const now = performance.now();
    if (!force && now - lastProgress < 180) return;
    lastProgress = now;
    const progress: ScanProgress = {
      imagesFound,
      foldersFound: folders.size,
      bytesFound,
      scannedEntries,
      currentPath,
      elapsedMs: Math.round(now - started),
    };
    ctx.postMessage({ type: "progress", progress });
  };

  const flush = (currentPath: string, force = false) => {
    if (pendingImages.length || pendingFolders.length) {
      ctx.postMessage({
        type: "batch",
        images: pendingImages.splice(0, pendingImages.length),
        folders: pendingFolders.splice(0, pendingFolders.length),
      });
    }
    postProgress(currentPath, force);
  };

  const stack: Array<{ handle: FileSystemDirectoryHandle; path: string }> = [
    { handle: source, path: "" },
  ];

  try {
    while (stack.length > 0) {
      if (cancelled) {
        ctx.postMessage({ type: "cancelled" });
        return;
      }
      const current = stack.pop()!;
      if (current.path && isExcludedPath(current.path, excludedPaths)) {
        continue;
      }
      if (current.path) {
        folders.add(current.path);
      }
      postProgress(current.path || source.name);

      try {
        for await (const entry of current.handle.values()) {
          if (cancelled) {
            ctx.postMessage({ type: "cancelled" });
            return;
          }
          scannedEntries += 1;

          if (entry.kind === "directory") {
            if (entry.name === ".adley-labeling") {
              ignoredFiles += 1;
              continue;
            }
            const childPath = joinRelativePath(current.path, entry.name);
            if (isExcludedPath(childPath, excludedPaths)) {
              ignoredFiles += 1;
              continue;
            }
            if (!folders.has(childPath)) {
              folders.add(childPath);
              pendingFolders.push(childPath);
            }
            stack.push({ handle: entry as FileSystemDirectoryHandle, path: childPath });
            continue;
          }

          const childPath = joinRelativePath(current.path, entry.name);
          if (isExcludedPath(childPath, excludedPaths)) {
            ignoredFiles += 1;
            continue;
          }
          if (!isSupportedImage(entry.name)) {
            ignoredFiles += 1;
            continue;
          }

          try {
            const file = await (entry as FileSystemFileHandle).getFile();
            const image: ManifestImage = {
              path: childPath,
              dir: current.path || ".",
              name: entry.name,
              size: file.size,
              lastModified: file.lastModified,
            };
            pendingImages.push(image);
            imagesFound += 1;
            bytesFound += file.size;
          } catch (error) {
            if (warnings.length < 50) {
              warnings.push({ path: childPath, message: errorMessage(error) });
            }
          }

          if (pendingImages.length >= 300) flush(current.path || source.name);
        }
      } catch (error) {
        if (warnings.length < 50) {
          warnings.push({ path: current.path || ".", message: errorMessage(error) });
        }
      }

      flush(current.path || source.name);
    }

    flush(".", true);
    ctx.postMessage({
      type: "done",
      warnings,
      ignoredFiles,
      elapsedMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    ctx.postMessage({ type: "error", message: errorMessage(error) });
  }
}

export {};
