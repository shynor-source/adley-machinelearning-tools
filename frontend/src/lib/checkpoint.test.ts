import { describe, expect, it } from "vitest";
import {
  CheckpointEventWriter,
  SESSION_FILE,
  checkpointSessionPath,
  countsFromStates,
  createSessionCheckpoint,
  decideReconcileAction,
  destinationsInUse,
  parseManifestImage,
  parseSessionConfig,
  readSessionCheckpoint,
  replayProgressEvents,
  summaryFromCounts,
} from "./checkpoint";
import type {
  ImageState,
  ProgressEvent,
  SessionConfig,
} from "./types";

function config(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    version: 1,
    id: "session-abc",
    name: "Product review",
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:05:00.000Z",
    sourceName: "source",
    resultName: "result",
    outputMode: "flat",
    classes: [
      { id: "c1", name: "cats", folderName: "cats" },
      { id: "c2", name: "dogs", folderName: "dogs" },
    ],
    totalImages: 2,
    totalBytes: 500,
    ...overrides,
  };
}

function label(
  seq: number,
  path: string,
  destPath = `cats/${path}`,
  classId = "c1",
): ProgressEvent {
  return {
    type: "label",
    seq,
    ts: seq,
    path,
    classId,
    className: "cats",
    folderName: "cats",
    destPath,
  };
}

describe("checkpoint session config", () => {
  it("parses a valid config and recomputes sanitized folder names", () => {
    const parsed = parseSessionConfig(
      config({
        classes: [
          { id: "c1", name: "cats", folderName: "wrong" },
          { id: "c2", name: "dogs", folderName: "wrong" },
        ],
      }),
    );
    expect(parsed.id).toBe("session-abc");
    expect(parsed.outputMode).toBe("flat");
    expect(parsed.classes[0].folderName).toBe("cats");
    expect(parsed.classes[1].folderName).toBe("dogs");
    expect(parsed.totalImages).toBe(2);
  });

  it("accepts mirror mode and optional summaries", () => {
    const parsed = parseSessionConfig(
      config({
        outputMode: "mirror",
        summary: {
          labeled: 1,
          copied: 1,
          skipped: 0,
          failed: 0,
          updatedAt: "2026-01-01T10:06:00.000Z",
        },
      }),
    );
    expect(parsed.outputMode).toBe("mirror");
    expect(parsed.summary?.copied).toBe(1);
  });

  it("rejects malformed sessions", () => {
    expect(() => parseSessionConfig(config({ version: 2 }))).toThrow();
    expect(() => parseSessionConfig(config({ id: "../escape" }))).toThrow();
    expect(() => parseSessionConfig(config({ outputMode: "random" }))).toThrow();
    expect(() => parseSessionConfig(config({ classes: [] }))).toThrow();
    expect(() =>
      parseSessionConfig(
        config({
          classes: [
            { id: "c1", name: "cats", folderName: "cats" },
            { id: "c2", name: "Cats", folderName: "cats" },
          ],
        }),
      ),
    ).toThrow(/same folder/);
    expect(() =>
      parseSessionConfig(
        config({
          classes: [
            { id: "c1", name: "cats", folderName: "cats" },
            { id: "c1", name: "dogs", folderName: "dogs" },
          ],
        }),
      ),
    ).toThrow(/duplicate class id/);
    expect(() => parseSessionConfig(config({ totalImages: -1 }))).toThrow();
  });
});

describe("manifest validation", () => {
  it("accepts manifest entries whose path matches dir and name", () => {
    expect(
      parseManifestImage({
        path: "train/cats/one.jpg",
        dir: "train/cats",
        name: "one.jpg",
        size: 10,
        lastModified: 50,
      }),
    ).toEqual({
      path: "train/cats/one.jpg",
      dir: "train/cats",
      name: "one.jpg",
      size: 10,
      lastModified: 50,
    });
  });

  it("rejects traversal, mismatched paths, and unsafe names", () => {
    expect(() =>
      parseManifestImage({
        path: "../escape.jpg",
        dir: "..",
        name: "escape.jpg",
        size: 1,
        lastModified: 1,
      }),
    ).toThrow();
    expect(() =>
      parseManifestImage({
        path: "train/one.jpg",
        dir: ".",
        name: "one.jpg",
        size: 1,
        lastModified: 1,
      }),
    ).toThrow(/does not match/);
    expect(() =>
      parseManifestImage({
        path: "train/bad.jpg",
        dir: "train",
        name: "bad/name.jpg",
        size: 1,
        lastModified: 1,
      }),
    ).toThrow();
  });
});

describe("progress event replay", () => {
  it("replays label and copy completion", () => {
    const replay = replayProgressEvents([
      label(1, "a.jpg"),
      {
        type: "copy_done",
        seq: 2,
        ts: 20,
        path: "a.jpg",
        destPath: "cats/a.jpg",
        bytes: 100,
      },
    ]);
    const state = replay.states.get("a.jpg");
    expect(state?.status).toBe("copied");
    expect(state?.copiedBytes).toBe(100);
    expect(replay.actions).toEqual([{ kind: "label", path: "a.jpg" }]);
    expect(replay.lastSeq).toBe(2);
    expect(replay.lastEventAt).toBe(20);
  });

  it("replays skip, failed copy, and retry", () => {
    const replay = replayProgressEvents([
      label(1, "a.jpg"),
      {
        type: "copy_error",
        seq: 2,
        ts: 2,
        path: "a.jpg",
        destPath: "cats/a.jpg",
        error: "disk full",
      },
      { type: "skip", seq: 3, ts: 3, path: "c.jpg" },
      {
        type: "retry",
        seq: 5,
        ts: 5,
        path: "a.jpg",
        destPath: "cats/a.jpg",
      },
      {
        type: "copy_done",
        seq: 6,
        ts: 6,
        path: "a.jpg",
        destPath: "cats/a.jpg",
        bytes: 100,
      },
    ]);
    expect(replay.states.get("a.jpg")?.status).toBe("copied");
    expect(replay.states.get("a.jpg")?.error).toBeUndefined();
    expect(replay.states.get("c.jpg")?.status).toBe("skipped");
    expect(replay.actions).toEqual([
      { kind: "label", path: "a.jpg" },
      { kind: "skip", path: "c.jpg" },
    ]);
  });

  it("applies destination corrections and ignores stale copy results", () => {
    const replay = replayProgressEvents([
      label(1, "a.jpg", "cats/a.jpg"),
      {
        type: "dest",
        seq: 2,
        ts: 2,
        path: "a.jpg",
        destPath: "cats/a__1.jpg",
      },
      {
        type: "copy_done",
        seq: 3,
        ts: 3,
        path: "a.jpg",
        destPath: "cats/a.jpg",
        bytes: 100,
      },
      {
        type: "copy_done",
        seq: 4,
        ts: 4,
        path: "a.jpg",
        destPath: "cats/a__1.jpg",
        bytes: 100,
      },
    ]);
    expect(replay.states.get("a.jpg")?.label?.destPath).toBe("cats/a__1.jpg");
    expect(replay.states.get("a.jpg")?.status).toBe("copied");
  });

  it("undo removes label and skip actions", () => {
    const replay = replayProgressEvents([
      label(1, "a.jpg"),
      label(2, "b.jpg", "cats/b.jpg"),
      { type: "skip", seq: 3, ts: 3, path: "c.jpg" },
      { type: "undo", seq: 4, ts: 4, path: "b.jpg", kind: "label" },
      { type: "undo", seq: 5, ts: 5, path: "c.jpg", kind: "skip" },
    ]);
    expect(replay.actions).toEqual([{ kind: "label", path: "a.jpg" }]);
    expect(replay.states.has("b.jpg")).toBe(false);
    expect(replay.states.has("c.jpg")).toBe(false);
    expect(replay.states.has("a.jpg")).toBe(true);
  });

  it("records finished summaries without creating image states", () => {
    const replay = replayProgressEvents([
      {
        type: "finished",
        seq: 2,
        ts: 2,
        copied: 5,
        skipped: 1,
        failed: 0,
      },
    ]);
    expect(replay.states.size).toBe(0);
    expect(replay.lastSeq).toBe(2);
  });

  it("counts states by status and computes summaries", () => {
    const states = new Map<string, ImageState>([
      [
        "copied.jpg",
        {
          path: "copied.jpg",
          status: "copied",
          label: {
            classId: "c1",
            className: "cats",
            folderName: "cats",
            destPath: "cats/copied.jpg",
          },
          updatedAt: 1,
        },
      ],
      ["skipped.jpg", { path: "skipped.jpg", status: "skipped", updatedAt: 1 }],
      [
        "failed.jpg",
        {
          path: "failed.jpg",
          status: "failed",
          label: {
            classId: "c1",
            className: "cats",
            folderName: "cats",
            destPath: "cats/failed.jpg",
          },
          updatedAt: 1,
        },
      ],
    ]);
    const counts = countsFromStates(states, 5);
    expect(counts).toMatchObject({
      total: 5,
      copied: 1,
      skipped: 1,
      failed: 1,
      labeled: 2,
      pending: 2,
    });
    expect(summaryFromCounts(counts, "now")).toEqual({
      labeled: 2,
      copied: 1,
      skipped: 1,
      failed: 1,
      updatedAt: "now",
    });
    expect(destinationsInUse(states)).toEqual(
      new Set(["cats/copied.jpg", "cats/failed.jpg"]),
    );
  });
});

describe("reconciliation decisions", () => {
  it("treats byte-size matches as settled", () => {
    for (const status of ["copied", "preparing", "copying", "failed"] as const) {
      expect(decideReconcileAction(status, 100, 100)).toBe("settled");
    }
    expect(decideReconcileAction("skipped", 100, 100)).toBe("leave");
    expect(decideReconcileAction("pending", 100, 100)).toBe("leave");
  });

  it("retries missing files and moves mismatched files to a new name", () => {
    expect(decideReconcileAction("copied", 100, null)).toBe("retry-same");
    expect(decideReconcileAction("copying", 100, null)).toBe("retry-same");
    expect(decideReconcileAction("copied", 100, 99)).toBe("retry-new");
    expect(decideReconcileAction("preparing", 100, 101)).toBe("retry-new");
  });

  it("leaves failed copies alone until the user retries them", () => {
    expect(decideReconcileAction("failed", 100, null)).toBe("leave");
    expect(decideReconcileAction("failed", 100, 50)).toBe("leave");
  });
});

describe("checkpoint types", () => {
  it("round-trips a serializable config", () => {
    const parsed: SessionConfig = parseSessionConfig(config());
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });
});

class MemoryFile {
  readonly kind = "file" as const;

  constructor(
    readonly name: string,
    public data: Uint8Array = new Uint8Array(),
    public lastModified = 0,
  ) {}

  async getFile(): Promise<File> {
    const data = this.data;
    return {
      name: this.name,
      size: data.byteLength,
      lastModified: this.lastModified,
      slice(start = 0, end = data.byteLength) {
        const part = data.slice(start, end);
        return { text: async () => new TextDecoder().decode(part) };
      },
      text: async () => new TextDecoder().decode(data),
    } as unknown as File;
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    return new MemoryWritable(
      this,
      options?.keepExistingData === true,
    ) as unknown as FileSystemWritableFileStream;
  }
}

class MemoryWritable {
  private buffer: Uint8Array;
  private position = 0;

  constructor(
    private readonly file: MemoryFile,
    keepExistingData: boolean,
  ) {
    this.buffer = keepExistingData ? file.data.slice() : new Uint8Array();
  }

  async write(data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const end = this.position + bytes.byteLength;
    if (end > this.buffer.byteLength) {
      const next = new Uint8Array(end);
      next.set(this.buffer);
      this.buffer = next;
    }
    this.buffer.set(bytes, this.position);
    this.position = end;
  }

  async seek(position: number): Promise<void> {
    this.position = position;
  }

  async truncate(size: number): Promise<void> {
    this.buffer = this.buffer.slice(0, size);
    if (this.position > size) this.position = size;
  }

  async close(): Promise<void> {
    this.file.data = this.buffer;
    this.file.lastModified = Date.now();
  }

  async abort(): Promise<void> {
    // The in-memory writer discards uncommitted data on abort.
  }
}

class MemoryDirectory {
  readonly kind = "directory" as const;
  readonly children = new Map<string, MemoryDirectory | MemoryFile>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<MemoryDirectory> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== "directory") {
        throw new DOMException("Not a directory.", "TypeMismatchError");
      }
      return existing;
    }
    if (!options.create) throw new DOMException("Directory not found.", "NotFoundError");
    const directory = new MemoryDirectory(name);
    this.children.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MemoryFile> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== "file") {
        throw new DOMException("Not a file.", "TypeMismatchError");
      }
      return existing;
    }
    if (!options.create) throw new DOMException("File not found.", "NotFoundError");
    const file = new MemoryFile(name);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) {
      throw new DOMException("Entry not found.", "NotFoundError");
    }
  }

  async *values(): AsyncIterableIterator<MemoryDirectory | MemoryFile> {
    yield* this.children.values();
  }
}

function asResultHandle(directory: MemoryDirectory): FileSystemDirectoryHandle {
  return directory as unknown as FileSystemDirectoryHandle;
}

describe("checkpoint storage", () => {
  it("keeps checkpoint paths relative to the reserved checkpoint root", () => {
    expect(checkpointSessionPath("session-abc", SESSION_FILE)).toBe("session-abc/session.json");
    expect(() => checkpointSessionPath("../escape", SESSION_FILE)).toThrow();
    expect(() => checkpointSessionPath("session-abc", "../escape")).toThrow();
  });

  it("creates, reads, and appends to a checkpoint in the result folder", async () => {
    const result = new MemoryDirectory("result");
    const parsed = parseSessionConfig(
      config({ totalImages: 2, totalBytes: 30 }),
    );
    const manifest = [
      { path: "cats/a.jpg", dir: "cats", name: "a.jpg", size: 10, lastModified: 1 },
      { path: "dogs/b.jpg", dir: "dogs", name: "b.jpg", size: 20, lastModified: 2 },
    ];

    await createSessionCheckpoint(asResultHandle(result), parsed, manifest);

    const checkpointDir = await result.getDirectoryHandle(".adley-labeling");
    expect(checkpointDir.children.has(parsed.id)).toBe(true);

    const loaded = await readSessionCheckpoint(asResultHandle(result), parsed.id);
    expect(loaded.config.id).toBe(parsed.id);
    expect(loaded.manifest).toEqual(manifest);
    expect(loaded.events).toEqual([]);

    const states: string[] = [];
    const writer = new CheckpointEventWriter(
      asResultHandle(result),
      parsed.id,
      (state) => states.push(state.status),
    );
    writer.append(label(1, "cats/a.jpg"));
    await writer.flush();

    const updated = await readSessionCheckpoint(asResultHandle(result), parsed.id);
    expect(updated.events).toHaveLength(1);
    expect(states).toContain("saved");
  });
});
