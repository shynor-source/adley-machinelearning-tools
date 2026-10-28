import { CHECKPOINT_DIR, errorMessage, fileNameOf, parentPath, validateRelativePath } from "./path";
import type { ManifestImage } from "./types";
import type { DirectoryPickerOptions, FileSystemPickerWindow, FsAccessMode } from "../types/fs-access";

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.isSecureContext === true &&
    typeof (window as FileSystemPickerWindow).showDirectoryPicker === "function"
  );
}

export function browserSupportMessage(): string {
  return "Local folder labeling requires Chrome or Edge on a desktop computer over HTTPS. Firefox, Safari, and mobile browsers do not support the File System Access API.";
}

export async function pickDirectory(
  id: string,
  mode: FsAccessMode,
): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as FileSystemPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("This browser does not support local folder access.");
  const options: DirectoryPickerOptions = { id, mode };
  try {
    const handle = await picker(options);
    const granted = await ensurePermission(handle, mode);
    if (!granted) throw new DOMException("Folder permission was not granted.", "NotAllowedError");
    return handle;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: FsAccessMode,
): Promise<boolean> {
  if (!handle.queryPermission) return true;
  const descriptor = { mode };
  const current = await handle.queryPermission(descriptor);
  if (current === "granted") return true;
  if (!handle.requestPermission) return false;
  const requested = await handle.requestPermission(descriptor);
  return requested === "granted";
}

export async function getDirectoryAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  if (!relativePath || relativePath === ".") return root;
  validateRelativePath(relativePath);
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

export async function getFileAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle> {
  validateRelativePath(relativePath);
  const parent = await getDirectoryAt(root, parentOf(relativePath));
  return parent.getFileHandle(nameOf(relativePath));
}

export async function readFileAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<File> {
  const handle = await getFileAt(root, relativePath);
  return handle.getFile();
}

export async function fileExistsAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  try {
    await getFileAt(root, relativePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function fileSizeAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<number | null> {
  try {
    const file = await readFileAt(root, relativePath);
    return file.size;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function directoryExistsAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  try {
    await getDirectoryAt(root, relativePath, false);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function removeFileAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<void> {
  validateRelativePath(relativePath);
  const parent = await getDirectoryAt(root, parentOf(relativePath));
  try {
    await parent.removeEntry(nameOf(relativePath));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function removeDirectoryAt(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<void> {
  validateRelativePath(relativePath);
  const parent = await getDirectoryAt(root, parentOf(relativePath));
  try {
    await parent.removeEntry(nameOf(relativePath), { recursive: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function readTextFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<string> {
  const file = await readFileAt(root, relativePath);
  return file.text();
}

export async function writeTextFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  text: string,
): Promise<void> {
  validateRelativePath(relativePath);
  const parent = await getDirectoryAt(root, parentOf(relativePath), true);
  const handle = await parent.getFileHandle(nameOf(relativePath), { create: true });
  const writer = await handle.createWritable();
  try {
    await writer.write(text);
  } catch (error) {
    try {
      await writer.abort(error);
    } catch {
      // Best effort only.
    }
    throw error;
  }
  await writer.close();
}

export async function appendTextFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  text: string,
): Promise<void> {
  validateRelativePath(relativePath);
  const parent = await getDirectoryAt(root, parentOf(relativePath), true);
  const handle = await parent.getFileHandle(nameOf(relativePath), { create: true });
  const file = await handle.getFile();
  const writer = await handle.createWritable({ keepExistingData: true });
  try {
    if (file.size > 0) await writer.seek(file.size);
    await writer.write(text);
  } catch (error) {
    try {
      await writer.abort(error);
    } catch {
      // Best effort only.
    }
    throw error;
  }
  await writer.close();
}

export async function readJsonFile<T>(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<T> {
  const text = await readTextFile(root, relativePath);
  return JSON.parse(text) as T;
}

export async function writeJsonFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  value: unknown,
): Promise<void> {
  await writeTextFile(root, relativePath, JSON.stringify(value, null, 2));
}

export function parseJsonLines<T>(text: string): T[] {
  const values: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as T);
    } catch {
      // A crash can leave the final line partially written. Ignore malformed
      // lines and keep every complete record before it.
    }
  }
  return values;
}

export async function readJsonLines<T>(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<T[]> {
  try {
    const text = await readTextFile(root, relativePath);
    return parseJsonLines<T>(text);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

const JSONL_TAIL_SCAN_BYTES = 64 * 1024;

/**
 * Returns the file size up to the last complete JSONL line. A crash can leave
 * a partially written final line; appending after it would corrupt the next
 * event too, so the partial tail is truncated before the new record is added.
 */
async function completeJsonlSize(file: File): Promise<number> {
  if (file.size === 0) return 0;
  const start = Math.max(0, file.size - JSONL_TAIL_SCAN_BYTES);
  const tail = await file.slice(start).text();
  if (tail.endsWith("\n")) return file.size;
  const lastNewline = tail.lastIndexOf("\n");
  return lastNewline >= 0 ? start + lastNewline + 1 : 0;
}

export async function appendJsonLine(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  value: unknown,
): Promise<void> {
  validateRelativePath(relativePath);
  const parent = await getDirectoryAt(root, parentOf(relativePath), true);
  const handle = await parent.getFileHandle(nameOf(relativePath), { create: true });
  const file = await handle.getFile();
  const size = await completeJsonlSize(file);
  const writer = await handle.createWritable({ keepExistingData: true });
  try {
    if (size < file.size) await writer.truncate(size);
    if (size > 0) await writer.seek(size);
    await writer.write(`${JSON.stringify(value)}\n`);
  } catch (error) {
    try {
      await writer.abort(error);
    } catch {
      // Best effort only.
    }
    throw error;
  }
  await writer.close();
}

export async function listDirectoryNames(
  directory: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of directory.values()) {
    if (entry.kind === "directory") names.push(entry.name);
  }
  return names;
}

export async function listCheckpointSessionIds(
  resultRoot: FileSystemDirectoryHandle,
): Promise<string[]> {
  try {
    const checkpoints = await resultRoot.getDirectoryHandle(CHECKPOINT_DIR);
    return await listDirectoryNames(checkpoints);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

export interface SourceResultValidation {
  sourceInResult: boolean;
  resultInSource: boolean;
  same: boolean;
  excludedPaths: string[];
  error?: string;
  warning?: string;
}

export async function validateSourceResult(
  source: FileSystemDirectoryHandle,
  result: FileSystemDirectoryHandle,
): Promise<SourceResultValidation> {
  const same = await source.isSameEntry(result);
  if (same) {
    return {
      sourceInResult: false,
      resultInSource: false,
      same: true,
      excludedPaths: [],
      error: "The source and result folders must be different.",
    };
  }

  const resultRelative = await source.resolve(result);
  if (resultRelative) {
    const path = resultRelative.join("/");
    return {
      sourceInResult: false,
      resultInSource: true,
      same: false,
      excludedPaths: [path],
      warning: `The result folder is inside the source folder. "${path}" will be excluded from scanning.`,
    };
  }

  const sourceRelative = await result.resolve(source);
  if (sourceRelative) {
    return {
      sourceInResult: true,
      resultInSource: false,
      same: false,
      excludedPaths: [],
      error: "The source folder cannot be inside the result folder.",
    };
  }

  return {
    sourceInResult: false,
    resultInSource: false,
    same: false,
    excludedPaths: [],
  };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

export function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) || "." : ".";
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function safeError(error: unknown): string {
  return errorMessage(error);
}

export function manifestImageFromFile(
  path: string,
  dir: string,
  name: string,
  file: File,
): ManifestImage {
  return { path, dir, name, size: file.size, lastModified: file.lastModified };
}
