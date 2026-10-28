import { getFileAt, isNotFound } from "./fs";
import { errorMessage } from "./path";
import type { CheckpointSessionData } from "./types";

export const SAMPLE_CHECK_COUNT = 5;

export interface SourceCheck {
  status: "idle" | "checking" | "ok" | "warning";
  missing: string[];
  checked: number;
  error?: string;
}

/**
 * Verifies a small sample of manifest paths. A full verification would read
 * the whole manifest and every directory up front; copies still validate each
 * source file, and the checkpoint reconciler handles later mismatches.
 */
export async function checkSourceSample(
  source: FileSystemDirectoryHandle,
  checkpoint: CheckpointSessionData,
): Promise<SourceCheck> {
  const sample = checkpoint.manifest.slice(0, SAMPLE_CHECK_COUNT);
  const missing: string[] = [];
  for (const image of sample) {
    try {
      const handle = await getFileAt(source, image.path);
      await handle.getFile();
    } catch (error) {
      if (isNotFound(error)) missing.push(image.path);
      else {
        return {
          status: "warning",
          missing,
          checked: sample.length,
          error: errorMessage(error),
        };
      }
    }
  }
  if (missing.length > 0) {
    return { status: "warning", missing, checked: sample.length };
  }
  return { status: "ok", missing: [], checked: sample.length };
}
