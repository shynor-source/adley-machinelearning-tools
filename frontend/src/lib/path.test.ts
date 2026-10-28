import { describe, expect, it } from "vitest";
import {
  buildDestinationPreview,
  classFolderConflict,
  destinationCandidate,
  errorMessage,
  findAvailableDestination,
  formatBytes,
  isSafeRelativePath,
  isSupportedImage,
  isWithinPath,
  joinRelativePath,
  makeClasses,
  parentPath,
  sanitizeFolderName,
  suffixFilename,
  validateClassNames,
  validateRelativePath,
} from "./path";
import type { ManifestImage } from "./types";

function image(path: string, size = 100): ManifestImage {
  const slash = path.lastIndexOf("/");
  return {
    path,
    dir: slash > 0 ? path.slice(0, slash) : ".",
    name: slash >= 0 ? path.slice(slash + 1) : path,
    size,
    lastModified: 1,
  };
}

describe("path helpers", () => {
  it("joins relative paths without introducing leading or trailing slashes", () => {
    expect(joinRelativePath("train", "cats", "a.jpg")).toBe("train/cats/a.jpg");
    expect(joinRelativePath(".", "cats", "a.jpg")).toBe("cats/a.jpg");
    expect(joinRelativePath("/train/", "/cats/", "a.jpg")).toBe("train/cats/a.jpg");
    expect(joinRelativePath(undefined, null, "", "a.jpg")).toBe("a.jpg");
  });

  it("computes parent and file names", () => {
    expect(parentPath("train/cats/a.jpg")).toBe("train/cats");
    expect(parentPath("a.jpg")).toBe(".");
    expect(parentPath("/a.jpg/")).toBe(".");
    expect(parentPath("")).toBe(".");
  });

  it("detects path containment on segment boundaries", () => {
    expect(isWithinPath("result/images/a.jpg", "result")).toBe(true);
    expect(isWithinPath("result/images/a.jpg", "result/images")).toBe(true);
    expect(isWithinPath("result/images/a.jpg", "result/image")).toBe(false);
    expect(isWithinPath("anything", ".")).toBe(true);
  });

  it("rejects unsafe relative paths", () => {
    expect(() => validateRelativePath("../etc/passwd")).toThrow();
    expect(() => validateRelativePath("a/../../b")).toThrow();
    expect(() => validateRelativePath("/abs/path")).toThrow();
    expect(() => validateRelativePath("a\\b")).toThrow();
    expect(() => validateRelativePath("a//b")).toThrow();
    expect(() => validateRelativePath(".adley-labeling/session.json")).toThrow();
    expect(isSafeRelativePath("result/cats/a.jpg")).toBe(true);
    expect(isSafeRelativePath("../escape.jpg")).toBe(false);
  });

  it("recognizes supported image extensions case-insensitively", () => {
    expect(isSupportedImage("photo.JPG")).toBe(true);
    expect(isSupportedImage("photo.jpeg")).toBe(true);
    expect(isSupportedImage("photo.webp")).toBe(true);
    expect(isSupportedImage("notes.txt")).toBe(false);
    expect(isSupportedImage("archive.tar.gz")).toBe(false);
    expect(isSupportedImage("noextension")).toBe(false);
  });
});

describe("folder and class names", () => {
  it("sanitizes unsafe folder names", () => {
    expect(sanitizeFolderName("  cats / dogs  ")).toBe("cats _ dogs");
    expect(sanitizeFolderName("bad<>:name?")).toBe("bad___name_");
    expect(sanitizeFolderName("trailing...")).toBe("trailing");
    expect(sanitizeFolderName("...leading")).toBe("leading");
    expect(sanitizeFolderName("CON")).toBe("_CON");
    expect(sanitizeFolderName("com1")).toBe("_com1");
    expect(sanitizeFolderName("   ")).toBe("class");
    expect(sanitizeFolderName(".")).toBe("class");
    expect(sanitizeFolderName("..")).toBe("class");
  });

  it("limits folder names to 96 characters", () => {
    const result = sanitizeFolderName("x".repeat(150));
    expect(result).toHaveLength(96);
    expect(result).not.toMatch(/[. ]$/);
  });

  it("validates empty and duplicate class names", () => {
    expect(validateClassNames(["cats", "dogs"])).toEqual([]);
    expect(validateClassNames(["", "dogs"])[0]).toBeTruthy();
    expect(validateClassNames(["cats", " cats "])[1]).toBeTruthy();
    expect(validateClassNames(["CATS", "cats"])[1]).toBeTruthy();
    // Different raw names can still sanitize to the same folder.
    expect(validateClassNames(["a/b", "a:b"])[1]).toBeTruthy();
  });

  it("creates class definitions with stable folder names", () => {
    const classes = makeClasses(["cats", "dogs"]);
    expect(classes).toHaveLength(2);
    expect(classes[0].folderName).toBe("cats");
    expect(classes[1].folderName).toBe("dogs");
    expect(classes[0].id).not.toBe(classes[1].id);
  });

  it("detects class folders that collide with source directories in mirror mode", () => {
    expect(classFolderConflict(["train", "train"], ["train", "train/cats"], ["cats"])).toContain(
      "train/cats",
    );
    expect(classFolderConflict(["train"], ["train", "train/cats"], ["dogs"])).toBeNull();
  });
});

describe("destination allocation", () => {
  it("adds collision suffixes before the extension", () => {
    expect(suffixFilename("photo.jpg", 0)).toBe("photo.jpg");
    expect(suffixFilename("photo.jpg", 1)).toBe("photo__1.jpg");
    expect(suffixFilename("archive.tar.gz", 2)).toBe("archive.tar__2.gz");
    expect(suffixFilename("no-extension", 1)).toBe("no-extension__1");
    expect(suffixFilename(".hidden", 1)).toBe(".hidden__1");
  });

  it("uses flat and mirror destination rules", () => {
    const flat = image("train/cats/photo.jpg");
    const mirror = image("deep/nested/photo.jpg");
    expect(destinationCandidate(flat, "cats", "flat", 0)).toBe("cats/photo.jpg");
    expect(destinationCandidate(flat, "cats", "flat", 1)).toBe("cats/photo__1.jpg");
    expect(destinationCandidate(mirror, "cats", "mirror", 0)).toBe("deep/nested/cats/photo.jpg");
    expect(destinationCandidate(image("root.jpg"), "cats", "mirror", 0)).toBe(
      "cats/root.jpg",
    );
  });

  it("finds the first available destination using both reservations and the disk", async () => {
    const taken = new Set(["cats/photo.jpg", "cats/photo__1.jpg"]);
    const result = await findAvailableDestination(
      image("train/photo.jpg"),
      "cats",
      "flat",
      (candidate) => taken.has(candidate),
    );
    expect(result).toEqual({ destPath: "cats/photo__2.jpg", attempt: 2 });
  });

  it("checks real files asynchronously", async () => {
    const result = await findAvailableDestination(
      image("train/photo.jpg"),
      "cats",
      "flat",
      async (candidate) => candidate === "cats/photo.jpg",
    );
    expect(result.destPath).toBe("cats/photo__1.jpg");
  });

  it("previews unique names for duplicate basenames within one class", () => {
    const rows = buildDestinationPreview(
      [image("a/first.jpg"), image("b/second.jpg"), image("c/second.jpg")],
      ["cats", "dogs"],
      "flat",
      6,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].destinations.map((item) => item.destPath)).toEqual([
      "cats/first.jpg",
      "dogs/first.jpg",
    ]);
    expect(rows[1].destinations[0].destPath).toBe("cats/second.jpg");
    expect(rows[2].destinations[0].destPath).toBe("cats/second__1.jpg");
    // Collision tracking is per class folder.
    expect(rows[2].destinations[1].destPath).toBe("dogs/second__1.jpg");
  });

  it("previews mirror paths with per-directory class folders", () => {
    const rows = buildDestinationPreview(
      [image("train/cats/one.jpg")],
      ["cats"],
      "mirror",
    );
    expect(rows[0].destinations[0].destPath).toBe("train/cats/cats/one.jpg");
  });

  it("limits the number of preview rows", () => {
    const images = Array.from({ length: 20 }, (_, index) =>
      image(`dir/photo-${index}.jpg`),
    );
    expect(buildDestinationPreview(images, ["cats"], "flat", 6)).toHaveLength(6);
    expect(buildDestinationPreview(images, ["cats"], "flat", 2)).toHaveLength(2);
  });
});

describe("formatting and errors", () => {
  it("formats bytes at sensible units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1000)).toMatch(/1000 B|1.0 KB/);
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  it("maps known DOM exceptions to friendly messages", () => {
    expect(errorMessage(new DOMException("x", "AbortError"))).toContain("cancelled");
    expect(errorMessage(new DOMException("x", "NotAllowedError"))).toContain("permission");
    expect(errorMessage(new DOMException("x", "QuotaExceededError"))).toContain("full");
    expect(errorMessage(new Error("plain message"))).toBe("plain message");
    expect(errorMessage("something")).toBe("something");
  });
});
