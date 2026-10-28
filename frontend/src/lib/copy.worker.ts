import { errorMessage, fileNameOf, parentPath, validateRelativePath } from "./path";

interface InitMessage {
  type: "init";
  source: FileSystemDirectoryHandle;
  result: FileSystemDirectoryHandle;
}

interface CopyMessage {
  type: "copy";
  taskId: string;
  sourcePath: string;
  destPath: string;
  expectedSize: number;
}

type Incoming = InitMessage | CopyMessage;

interface WorkerScope {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage(message: unknown): void;
}

const ctx = self as unknown as WorkerScope;
let sourceRoot: FileSystemDirectoryHandle | null = null;
let resultRoot: FileSystemDirectoryHandle | null = null;

ctx.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === "init") {
    sourceRoot = message.source;
    resultRoot = message.result;
    ctx.postMessage({ type: "ready" });
    return;
  }
  if (message.type !== "copy" || !sourceRoot || !resultRoot) return;
  await copyFile(message);
};

async function getDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  if (!path || path === ".") return root;
  validateRelativePath(path);
  let directory = root;
  for (const segment of path.split("/")) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory;
}

async function removeDestination(destPath: string): Promise<void> {
  try {
    const parent = await getDirectory(resultRoot!, parentPath(destPath), false);
    await parent.removeEntry(fileNameOf(destPath));
  } catch {
    // A partial file may survive a hard interruption. Resume reconciliation
    // detects it by size before choosing a fresh destination.
  }
}

async function copyFile(message: CopyMessage): Promise<void> {
  const { taskId, sourcePath, destPath, expectedSize } = message;
  let writable: FileSystemWritableFileStream | null = null;
  let destCreated = false;

  try {
    validateRelativePath(sourcePath);
    validateRelativePath(destPath);

    const sourceDir = await getDirectory(sourceRoot!, parentPath(sourcePath), false);
    const sourceHandle = await sourceDir.getFileHandle(fileNameOf(sourcePath));
    const sourceFile = await sourceHandle.getFile();

    const destDir = await getDirectory(resultRoot!, parentPath(destPath), true);
    const destName = fileNameOf(destPath);

    let destHandle: FileSystemFileHandle;
    try {
      destHandle = await destDir.getFileHandle(destName);
      const existing = await destHandle.getFile();
      ctx.postMessage({ type: "conflict", taskId, actualSize: existing.size });
      return;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      destHandle = await destDir.getFileHandle(destName, { create: true });
      destCreated = true;
    }

    writable = await destHandle.createWritable();
    let copiedBytes = 0;
    let lastProgress = 0;

    const readable = sourceFile.stream().pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          copiedBytes += chunk.byteLength;
          const now = performance.now();
          if (now - lastProgress > 250) {
            lastProgress = now;
            ctx.postMessage({ type: "progress", taskId, copiedBytes });
          }
          controller.enqueue(chunk);
        },
      }),
    );

    await readable.pipeTo(writable);
    writable = null;

    const written = await destHandle.getFile();
    if (written.size !== expectedSize || written.size !== sourceFile.size) {
      throw new Error(
        `Destination size check failed (expected ${expectedSize} bytes, got ${written.size}).`,
      );
    }

    ctx.postMessage({ type: "done", taskId, bytes: written.size, destPath });
  } catch (error) {
    if (writable) {
      try {
        await writable.abort(error);
      } catch {
        // Best effort.
      }
    }
    if (destCreated) await removeDestination(destPath);
    ctx.postMessage({
      type: "error",
      taskId,
      error: errorMessage(error),
      destPath,
    });
  }
}

export {};
