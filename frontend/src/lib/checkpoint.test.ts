import { describe, expect, it } from "vitest";
import {
  countsFromStates,
  decideReconcileAction,
  destinationsInUse,
  parseManifestImage,
  parseSessionConfig,
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
