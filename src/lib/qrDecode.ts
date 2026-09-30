/**
 * Reading ticket QR codes from the camera or a photo on any phone. The
 * browser's own BarcodeDetector is used where it exists (Chrome on Android,
 * macOS); everywhere else — Safari and every other browser on iPhone, desktop
 * Chrome on Windows — the codes are decoded in JavaScript with jsQR.
 *
 * Decoding only reads the code: whether a ticket is genuine, current and
 * for this facility is decided by the server.
 */

type JsQR = typeof import("jsqr").default;

/** Anything the decoder can look at. */
export type QrSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

interface NativeDetector {
  detect(source: QrSource): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorClass {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface QrDecoder {
  engine: "native" | "js";
  /** The text of the first QR code found, or null. */
  decode(source: QrSource): Promise<string | null>;
}

/* ───────────── Camera availability ───────────── */

/** Why the live camera can't be offered at all here — or null when it can. */
export type CameraBlock = "insecure" | "unsupported";

export function cameraBlock(): CameraBlock | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  // Browsers only give pages served over https (or localhost) a camera.
  if (window.isSecureContext === false) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  return null;
}

/** Why opening the camera failed, from the DOMException getUserMedia rejects with. */
export type CameraError = "denied" | "no_camera" | "busy" | "failed";

export function cameraError(e: unknown): CameraError {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no_camera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "failed";
}

/** The back camera if there is one, at a size that's sharp enough without being slow. */
export async function openCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    // Some laptops and older phones reject the size hints — any camera will do.
    if ((e as { name?: string } | null)?.name === "OverconstrainedError") return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    throw e;
  }
}

/* ───────────── Decoding ───────────── */

let jsqr: Promise<JsQR> | null = null;
const loadJsQR = () => (jsqr ??= import("jsqr").then((m) => m.default));

/** Decode raw RGBA pixels. Codes shown light-on-dark are read too. */
export async function decodePixels(data: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  const read = await loadJsQR();
  return read(data, width, height, { inversionAttempts: "attemptBoth" })?.data || null;
}

const sizeOf = (s: QrSource): [number, number] =>
  s instanceof HTMLVideoElement ? [s.videoWidth, s.videoHeight] : s instanceof HTMLImageElement ? [s.naturalWidth, s.naturalHeight] : [s.width, s.height];

/** Draw the source into the canvas, scaled so its longer side is at most `maxSide`, and read its pixels. */
function pixelsOf(canvas: HTMLCanvasElement, source: QrSource, maxSide: number): ImageData | null {
  const [w0, h0] = sizeOf(source);
  if (!w0 || !h0) return null;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function nativeDecoder(): Promise<QrDecoder | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    // Some platforms define BarcodeDetector but can't read QR codes with it.
    const formats = (await Detector.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    const d = new Detector({ formats: ["qr_code"] });
    return { engine: "native", decode: async (s) => (await d.detect(s))[0]?.rawValue || null };
  } catch {
    return null;
  }
}

/**
 * A decoder for live video frames. Frames are scaled down to `maxSide`
 * pixels first — plenty for a phone screen held up to the camera, and quick
 * even on older iPhones.
 */
export async function createDecoder(maxSide = 800): Promise<QrDecoder> {
  const native = await nativeDecoder();
  if (native) return native;
  await loadJsQR();
  const canvas = document.createElement("canvas");
  return {
    engine: "js",
    decode: async (s) => {
      const img = pixelsOf(canvas, s, maxSide);
      return img ? decodePixels(img.data, img.width, img.height) : null;
    },
  };
}

async function imageOf(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* older Safari: fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Read the QR code in a photo (the fallback when the live camera can't be
 * used). Phone photos are large, so they're tried at a couple of sizes.
 */
export async function decodeImageFile(file: Blob): Promise<string | null> {
  const image = await imageOf(file);
  try {
    const native = await nativeDecoder();
    if (native) {
      const hit = await native.decode(image).catch(() => null);
      if (hit) return hit;
    }
    const canvas = document.createElement("canvas");
    for (const side of [1000, 1600, 600]) {
      const img = pixelsOf(canvas, image, side);
      const hit = img && (await decodePixels(img.data, img.width, img.height));
      if (hit) return hit;
    }
    return null;
  } finally {
    if ("close" in image) image.close();
  }
}
