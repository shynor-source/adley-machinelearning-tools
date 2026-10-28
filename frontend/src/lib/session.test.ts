import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionRuntime } from "./session";
import type { ManifestImage, SessionConfig } from "./types";

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(): void {
    // Copy workers are not exercised by the fresh-session test.
  }

  terminate(): void {
    // Nothing to release in the mock.
  }
}

function config(): SessionConfig {
  const createdAt = "2026-01-01T10:00:00.000Z";
  return {
    version: 1,
    id: "session-test",
    name: "Fresh session",
    createdAt,
    updatedAt: createdAt,
    sourceName: "source",
    resultName: "result",
    outputMode: "flat",
    classes: [{ id: "c1", name: "cats", folderName: "cats" }],
    totalImages: 2,
    totalBytes: 30,
    summary: { labeled: 0, copied: 0, skipped: 0, failed: 0, updatedAt: createdAt },
  };
}

const manifest: ManifestImage[] = [
  { path: "a.jpg", dir: ".", name: "a.jpg", size: 10, lastModified: 1 },
  { path: "b.jpg", dir: ".", name: "b.jpg", size: 20, lastModified: 2 },
];

describe("session initialization", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves the loading state after a fresh session is restored", async () => {
    const runtime = SessionRuntime.open({
      source: {} as FileSystemDirectoryHandle,
      result: {} as FileSystemDirectoryHandle,
      config: config(),
      manifest,
      events: [],
    });

    await runtime.ready();

    expect(runtime.getSnapshot().status).toBe("ready");
    expect(runtime.getSnapshot().reconcile).toBeNull();
    expect(runtime.getSnapshot().current?.path).toBe("a.jpg");

    await runtime.close();
  });
});
