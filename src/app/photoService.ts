/**
 * Photo intake: compress an uploaded image and hand back a Blob ready to store
 * (spec §5 — max 512px, target ≤50KB JPEG). The compressor is injectable so the
 * pipeline is testable without a real canvas/browser.
 */

export interface CompressOptions {
  maxWidthOrHeight: number;
  maxSizeMB: number;
  mimeType: string;
}

export const DEFAULT_COMPRESS: CompressOptions = {
  maxWidthOrHeight: 512,
  maxSizeMB: 0.05, // ~50KB target
  mimeType: 'image/jpeg',
};

export type Compressor = (file: Blob, options: CompressOptions) => Promise<Blob>;

/** Production compressor using browser-image-compression (lazy-loaded). */
export const browserCompressor: Compressor = async (file, options) => {
  const mod = await import('browser-image-compression');
  const imageCompression = mod.default;
  const result = await imageCompression(file as File, {
    maxWidthOrHeight: options.maxWidthOrHeight,
    maxSizeMB: options.maxSizeMB,
    fileType: options.mimeType,
    useWebWorker: true,
  });
  return result;
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // reject absurdly large files early

/**
 * Validate and compress an image file. Throws user-facing errors for bad input
 * (validate at boundaries — security rules).
 */
export async function preparePhoto(
  file: Blob,
  compressor: Compressor = browserCompressor,
  options: CompressOptions = DEFAULT_COMPRESS,
): Promise<{ blob: Blob; mime: string }> {
  if (!file || file.size === 0) {
    throw new Error('That file appears to be empty.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That image is too large. Please choose a smaller photo.');
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  const blob = await compressor(file, options);
  return { blob, mime: options.mimeType };
}
