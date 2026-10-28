import { errorMessage } from "./path";

interface PreviewMessage {
  type: "load";
  id: string;
  file: File;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<PreviewMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = async (event: MessageEvent<PreviewMessage>) => {
  const message = event.data;
  if (message.type !== "load") return;

  try {
    let bitmap = await createImageBitmap(message.file, {
      imageOrientation: "from-image",
    });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest > 2400 && typeof OffscreenCanvas !== "undefined") {
      const scale = 2400 / longest;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (context) {
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, 0, 0, width, height);
        const resized = canvas.transferToImageBitmap();
        bitmap.close();
        bitmap = resized;
      }
    }
    const width = bitmap.width;
    const height = bitmap.height;
    ctx.postMessage({ type: "loaded", id: message.id, bitmap, width, height }, [bitmap]);
  } catch (error) {
    ctx.postMessage({ type: "error", id: message.id, message: errorMessage(error) });
  }
};

export {};
