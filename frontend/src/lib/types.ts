export type OutputMode = "flat" | "mirror";

export interface ClassDefinition {
  id: string;
  name: string;
  folderName: string;
}

export interface SessionSummary {
  labeled: number;
  copied: number;
  skipped: number;
  failed: number;
  updatedAt: string;
}

export interface SessionConfig {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceName: string;
  resultName: string;
  outputMode: OutputMode;
  classes: ClassDefinition[];
  totalImages: number;
  totalBytes: number;
  summary?: SessionSummary;
}

export interface ManifestImage {
  path: string;
  dir: string;
  name: string;
  size: number;
  lastModified: number;
}

export type ImageStatus =
  | "pending"
  | "preparing"
  | "copying"
  | "copied"
  | "skipped"
  | "failed";

export interface ImageLabel {
  classId: string;
  className: string;
  folderName: string;
  destPath: string;
}

export interface ImageState {
  path: string;
  status: ImageStatus;
  label?: ImageLabel;
  error?: string;
  copiedBytes?: number;
  updatedAt: number;
}

export interface ProgressEventBase {
  seq: number;
  ts: number;
}

export interface LabelEvent extends ProgressEventBase {
  type: "label";
  path: string;
  classId: string;
  className: string;
  folderName: string;
  destPath: string;
}

export interface CopyDoneEvent extends ProgressEventBase {
  type: "copy_done";
  path: string;
  destPath: string;
  bytes: number;
}

export interface CopyErrorEvent extends ProgressEventBase {
  type: "copy_error";
  path: string;
  destPath: string;
  error: string;
}

/** Corrects the destination mapping after a conflict or reconciliation. */
export interface DestinationEvent extends ProgressEventBase {
  type: "dest";
  path: string;
  destPath: string;
}

export interface SkipEvent extends ProgressEventBase {
  type: "skip";
  path: string;
}

export interface UndoEvent extends ProgressEventBase {
  type: "undo";
  path: string;
  kind: "label" | "skip";
}

export interface RetryEvent extends ProgressEventBase {
  type: "retry";
  path: string;
  destPath: string;
}

export interface FinishedEvent extends ProgressEventBase {
  type: "finished";
  copied: number;
  skipped: number;
  failed: number;
}

export type ProgressEvent =
  | LabelEvent
  | CopyDoneEvent
  | CopyErrorEvent
  | DestinationEvent
  | SkipEvent
  | UndoEvent
  | RetryEvent
  | FinishedEvent;

export interface CheckpointSessionData {
  config: SessionConfig;
  manifest: ManifestImage[];
  events: ProgressEvent[];
}

export interface ScanWarning {
  path: string;
  message: string;
}

export interface ScanProgress {
  imagesFound: number;
  foldersFound: number;
  bytesFound: number;
  scannedEntries: number;
  currentPath: string;
  elapsedMs: number;
}

export interface ScanResult {
  images: ManifestImage[];
  folders: string[];
  warnings: ScanWarning[];
  totalBytes: number;
  elapsedMs: number;
  ignoredFiles: number;
}

export interface RuntimeCounts {
  total: number;
  pending: number;
  preparing: number;
  copying: number;
  copied: number;
  skipped: number;
  failed: number;
  labeled: number;
}

export interface CopyFailure {
  path: string;
  name: string;
  className: string;
  error: string;
  destPath?: string;
}

export interface RecentLabel {
  path: string;
  name: string;
  classId: string;
  className: string;
  folderName?: string;
  destPath?: string;
  status: ImageStatus;
  copiedBytes?: number;
}

export interface RuntimeNotice {
  kind: "error" | "info";
  text: string;
}

export interface RuntimeSnapshot {
  status: "loading" | "ready" | "complete" | "error";
  config: SessionConfig | null;
  current: ManifestImage | null;
  currentState: ImageState | null;
  position: number;
  counts: RuntimeCounts;
  paused: boolean;
  busy: boolean;
  checkpointStatus: "idle" | "saving" | "saved" | "error";
  checkpointError?: string;
  error?: string;
  notice: RuntimeNotice | null;
  reconcile: { done: number; total: number } | null;
  failures: CopyFailure[];
  recentLabels: RecentLabel[];
  canUndo: boolean;
  activeCopies: number;
  cleanupCount: number;
  lastEventAt: number | null;
}

export interface PreviewResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export type PreviewWorkerResponse =
  | { type: "loaded"; id: string; bitmap: ImageBitmap; width: number; height: number }
  | { type: "error"; id: string; message: string };
