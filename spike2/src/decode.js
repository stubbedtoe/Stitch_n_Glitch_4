// Decode probes. The production decode path is createImageBitmap (off-thread, what the
// engine uses to test a bend); TGA has no browser decoder, so it goes through the
// bundled strict JS decoder — which is what production would ship.

import { decodeTgaStrict } from "./corpus.js";

export async function tryCreateImageBitmap(bytes, mime) {
  try {
    await createImageBitmap(new Blob([bytes], { type: mime }));
    return true;
  } catch {
    return false;
  }
}

export async function tryDecode(format, entry) {
  if (format === "tga") {
    try {
      const r = decodeTgaStrict(entry.bytes);
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  }
  return tryCreateImageBitmap(entry.bytes, entry.mime);
}

// Cross-check: <img>.decode() on a sample, to confirm createImageBitmap isn't
// systematically stricter or looser than the element decode path.
export async function tryImgDecode(bytes, mime) {
  try {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
