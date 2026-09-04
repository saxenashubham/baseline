/**
 * Image helpers.
 *
 * Photos from a modern phone are 3–5 MB, which is wasteful to send to a vision
 * model and slow to keep in IndexedDB. Everything is downscaled and re-encoded
 * before it goes anywhere. Progress photos are downscaled too, but they are
 * only ever written to the local database.
 */

const urls = new Set();

/** Track object URLs so a view can revoke every one it created on destroy. */
export function objectURL(blob) {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  return url;
}

export function revokeAll(list) {
  for (const url of list || urls) {
    URL.revokeObjectURL(url);
    urls.delete(url);
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    // `imageOrientation: 'from-image'` respects EXIF rotation on iOS.
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}

function drawScaled(bitmap, maxEdge) {
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function toBlob(file, { maxEdge = 1400, quality = 0.82 } = {}) {
  const bitmap = await loadBitmap(file);
  const canvas = drawScaled(bitmap, maxEdge);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Base64 (no data: prefix) for the Anthropic image content block. */
export async function toBase64(file, { maxEdge = 1024, quality = 0.78 } = {}) {
  const bitmap = await loadBitmap(file);
  const canvas = drawScaled(bitmap, maxEdge);
  if (bitmap.close) bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', dataUrl };
}

/** Small square thumbnail kept alongside a food entry for the timeline. */
export async function toThumbDataURL(file, size = 160) {
  const bitmap = await loadBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const min = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - min) / 2, (bitmap.height - min) / 2, min, min,
    0, 0, size, size
  );
  if (bitmap.close) bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}
