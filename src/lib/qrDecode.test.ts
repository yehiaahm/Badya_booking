import { describe, expect, it } from "vitest";
import QR from "qrcode";
import { cameraError, decodePixels } from "./qrDecode";

/**
 * The ticket's QR code drawn the way `QrCode.tsx` draws it — touching modules
 * with rounded corners, hand-drawn finder patterns, the brand mark in the
 * middle and only a 2-module white margin — on a dark phone screen, at `px`
 * pixels per module.
 */
function ticketPixels(text: string, px = 6, gap = 0) {
  // Drawn at 4× and averaged down, so edges are anti-aliased like a real screen seen by a camera.
  const ss = 4;
  const hi = drawTicket(text, px * ss, gap, 12 * ss);
  const size = hi.width / ss;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) sum += hi.data[((y * ss + dy) * hi.width + x * ss + dx) * 4];
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(sum / (ss * ss));
      data[i + 3] = 255;
    }
  return { data, width: size, height: size };
}

function drawTicket(text: string, px: number, gap: number, margin: number) {
  const q = QR.create(text, { errorCorrectionLevel: "H" });
  const n = q.modules.size;
  const pad = 2;
  // A whole number of low-resolution pixels, so averaging down never splits one.
  const size = 4 * Math.ceil((Math.ceil((n + pad * 2) * px) + margin * 2) / 4);
  const data = new Uint8ClampedArray(size * size * 4);
  const set = (x: number, y: number, v: number) => {
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  };
  /** A rounded rectangle in module units, sampled at pixel centres. */
  const fill = (mx: number, my: number, mw: number, mh: number, v: number, r = 0) => {
    for (let y = Math.floor(my * px); y < Math.ceil((my + mh) * px); y++)
      for (let x = Math.floor(mx * px); x < Math.ceil((mx + mw) * px); x++) {
        const ux = (x + 0.5) / px;
        const uy = (y + 0.5) / px;
        if (ux < mx || ux > mx + mw || uy < my || uy > my + mh) continue;
        const cx = Math.min(Math.max(ux, mx + r), mx + mw - r);
        const cy = Math.min(Math.max(uy, my + r), my + mh - r);
        if ((ux - cx) ** 2 + (uy - cy) ** 2 <= r * r + 1e-9) set(margin + x, margin + y, v);
      }
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, 24);
  fill(0, 0, n + pad * 2, n + pad * 2, 255);
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  const c0 = n / 2 - n * 0.12;
  const c1 = n / 2 + n * 0.12;
  const inCenter = (x: number, y: number) => x >= c0 && x <= c1 && y >= c0 && y <= c1;
  const cell = 1 - gap * 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.data[y * n + x] && !inFinder(x, y) && !inCenter(x, y)) fill(x + pad + gap, y + pad + gap, cell, cell, 28, 0.2);
  for (const [fx, fy] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ]) {
    fill(fx + pad, fy + pad, 7, 1, 28);
    fill(fx + pad, fy + pad + 6, 7, 1, 28);
    fill(fx + pad, fy + pad, 1, 7, 28);
    fill(fx + pad + 6, fy + pad, 1, 7, 28);
    fill(fx + pad + 2, fy + pad + 2, 3, 3, 28, 0.9);
  }
  const logo = n * 0.2;
  const mid = (n + pad * 2) / 2;
  fill(mid - logo / 2 - 0.6, mid - logo / 2 - 0.6, logo + 1.2, logo + 1.2, 255, logo * 0.28);
  fill(mid - logo / 2 + logo * 0.08, mid - logo / 2 + logo * 0.1, logo * 0.84, logo * 0.8, 130);
  return { data, width: size, height: size };
}

/** A token shaped like the server's: base64url(JSON payload) + "." + 22-character signature. */
const token = `${Buffer.from(JSON.stringify({ b: "BK-2026-000123", u: "u_6f3a2b1c4d5e", f: "f_billiards", s: "2026-10-01T10:00:00.000Z", w: 58755760 })).toString("base64url")}.Zm9vYmFyYmF6cXV4cXV1eA`;

describe("reading ticket QR codes without BarcodeDetector (iPhone, desktop Chrome on Windows)", () => {
  it("reads the ticket's own style off a dark screen, from arm's length to close up", async () => {
    // The spaced-out dots this replaced failed at 11 of these 18 sizes.
    for (const px of [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10, 11, 12, 14, 16]) {
      const { data, width, height } = ticketPixels(token, px);
      expect(await decodePixels(data, width, height), `${px} px per module`).toBe(token);
    }
  });

  it("reads it when shown light-on-dark", async () => {
    const { data, width, height } = ticketPixels(token, 6);
    for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255 - data[i];
    expect(await decodePixels(data, width, height)).toBe(token);
  });

  it("returns nothing for a picture without a code", async () => {
    const data = new Uint8ClampedArray(200 * 200 * 4).fill(200);
    expect(await decodePixels(data, 200, 200)).toBeNull();
  });

  it("tells apart why the camera couldn't start", () => {
    expect(cameraError({ name: "NotAllowedError" })).toBe("denied");
    expect(cameraError({ name: "SecurityError" })).toBe("denied");
    expect(cameraError({ name: "NotFoundError" })).toBe("no_camera");
    expect(cameraError({ name: "NotReadableError" })).toBe("busy");
    expect(cameraError(new Error("?"))).toBe("failed");
    expect(cameraError(null)).toBe("failed");
  });
});
