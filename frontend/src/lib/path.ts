import type { ClassDefinition, ManifestImage, OutputMode } from "./types";

export type { OutputMode };

export const CHECKPOINT_DIR = ".adley-labeling";
export const SUPPORTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".gif",
] as const;

const SUPPORTED_SET = new Set<string>(SUPPORTED_EXTENSIONS);
const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function isSupportedImage(name: string): boolean {
  return SUPPORTED_SET.has(extensionOf(name));
}

export function joinRelativePath(...parts: Array<string | undefined | null>): string {
  return parts
    .filter((part): part is string => Boolean(part && part !== "."))
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function parentPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  if (!normalized || !normalized.includes("/")) return ".";
  return normalized.slice(0, normalized.lastIndexOf("/")) || ".";
}

export function fileNameOf(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function isWithinPath(path: string, prefix: string): boolean {
  if (!prefix || prefix === ".") return true;
  const normalized = path.replace(/^\/+|\/+$/g, "");
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return normalized === cleanPrefix || normalized.startsWith(`${cleanPrefix}/`);
}

/** True when the path is inside a directory that should not be scanned. */
export function isExcludedPath(path: string, excluded: string[]): boolean {
  return excluded.some((prefix) => isWithinPath(path, prefix));
}

export function validateRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
  if (path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
  if (path.split("/")[0] === CHECKPOINT_DIR) {
    throw new Error("The checkpoint folder is reserved.");
  }
}

export function isSafeRelativePath(path: string): boolean {
  try {
    validateRelativePath(path);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeFolderName(raw: string): string {
  let value = raw.normalize("NFC").trim();
  value = value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_");
  value = value.replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
  value = value.replace(/^\.+/, "");
  if (!value) value = "class";
  if (value === "." || value === "..") value = "class";
  if (value.toLowerCase() === CHECKPOINT_DIR) value = "class";
  if (WINDOWS_RESERVED.has(value.toLowerCase())) value = `_${value}`;
  return value.slice(0, 96).replace(/[. ]+$/g, "") || "class";
}

export function validateClassNames(names: string[]): string[] {
  const errors: string[] = [];
  const seenRaw = new Set<string>();
  const seenFolders = new Set<string>();

  names.forEach((name, index) => {
    const trimmed = name.trim();
    if (!trimmed) {
      errors[index] = "Enter a class name.";
      return;
    }
    const rawKey = trimmed.toLowerCase();
    if (seenRaw.has(rawKey)) {
      errors[index] = "Class names must be unique.";
      return;
    }
    seenRaw.add(rawKey);
    const folder = sanitizeFolderName(trimmed);
    const folderKey = folder.toLowerCase();
    if (seenFolders.has(folderKey)) {
      errors[index] = "This class produces the same folder name as another class.";
      return;
    }
    seenFolders.add(folderKey);
  });

  return errors;
}

export function makeClasses(names: string[]): ClassDefinition[] {
  return names.map((name, index) => ({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `class-${Date.now()}-${index}`,
    name: name.trim(),
    folderName: sanitizeFolderName(name),
  }));
}

export function suffixFilename(name: string, attempt: number): string {
  if (attempt <= 0) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${base}__${attempt}${ext}`;
}

export function baseDestinationPath(
  image: Pick<ManifestImage, "dir" | "name">,
  classFolder: string,
  mode: OutputMode,
): string {
  if (mode === "mirror") {
    return joinRelativePath(image.dir, classFolder, image.name);
  }
  return joinRelativePath(classFolder, image.name);
}

export function destinationCandidate(
  image: Pick<ManifestImage, "dir" | "name">,
  classFolder: string,
  mode: OutputMode,
  attempt: number,
): string {
  if (mode === "mirror") {
    return joinRelativePath(image.dir, classFolder, suffixFilename(image.name, attempt));
  }
  return joinRelativePath(classFolder, suffixFilename(image.name, attempt));
}

/**
 * Picks the first collision-safe destination name. `isTaken` can also look at
 * the real result folder, so a name that already exists on disk is skipped.
 */
export async function findAvailableDestination(
  image: Pick<ManifestImage, "dir" | "name">,
  classFolder: string,
  mode: OutputMode,
  isTaken: (path: string) => boolean | Promise<boolean>,
): Promise<{ destPath: string; attempt: number }> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const candidate = destinationCandidate(image, classFolder, mode, attempt);
    if (!(await isTaken(candidate))) return { destPath: candidate, attempt };
  }
  throw new Error("Could not find an unused destination filename after 10,000 attempts.");
}

export interface PreviewDestination {
  folderName: string;
  destPath: string;
}

export interface DestinationPreviewRow {
  image: ManifestImage;
  destinations: PreviewDestination[];
}

/**
 * Builds a representative preview. Collision suffixes are calculated for the
 * sampled rows only; the real mapping is assigned and persisted at label time.
 */
export function buildDestinationPreview(
  images: ManifestImage[],
  classFolders: string[],
  mode: OutputMode,
  maxImages = 6,
): DestinationPreviewRow[] {
  const sample = images.slice(0, maxImages);
  const used = new Map<string, Set<string>>();
  classFolders.forEach((folder) => used.set(folder, new Set()));

  return sample.map((image) => {
    const destinations = classFolders.map((folderName) => {
      const folderUsed = used.get(folderName)!;
      let attempt = 0;
      let destPath = destinationCandidate(image, folderName, mode, attempt);
      while (folderUsed.has(destPath)) {
        attempt += 1;
        destPath = destinationCandidate(image, folderName, mode, attempt);
      }
      folderUsed.add(destPath);
      return { folderName, destPath };
    });
    return { image, destinations };
  });
}

export function classFolderConflict(
  imageDirs: string[],
  folders: string[],
  classFolders: string[],
): string | null {
  const folderSet = new Set(folders);
  const dirs = new Set(imageDirs);
  for (const dir of dirs) {
    for (const classFolder of classFolders) {
      const child = joinRelativePath(dir, classFolder);
      if (folderSet.has(child)) {
        return `${child} exists in the source folder and conflicts with the class folder "${classFolder}". Rename the class or use Flat by class mode.`;
      }
    }
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "AbortError") return "The folder selection was cancelled.";
    if (error.name === "NotAllowedError") return "Folder permission was not granted.";
    if (error.name === "NotFoundError") return "The folder or file no longer exists.";
    if (error.name === "InvalidModificationError") return "The destination cannot be modified.";
    if (error.name === "QuotaExceededError") return "The destination disk is full.";
    return error.message || error.name;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
