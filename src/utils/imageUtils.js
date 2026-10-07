import { inferMimeTypeFromFile } from "./uploadConfig";

const GIF_MIME_TYPE = "image/gif";
const DEFAULT_OUTPUT_MIME_TYPE = "image/webp";
const CONVERTIBLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/avif-sequence",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const SCREENSHOT_FRIENDLY_TYPES = new Set([
  "image/png",
  "image/avif",
  "image/avif-sequence",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const MIME_EXTENSION_MAP = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const inferExtensionFromMimeType = (mimeType) => MIME_EXTENSION_MAP[mimeType] || "webp";

const replaceFileExtension = (fileName, mimeType) => {
  const baseName = String(fileName || "image").trim() || "image";
  const safeBaseName = baseName.replace(/\.[^.]+$/, "") || "image";
  return `${safeBaseName}.${inferExtensionFromMimeType(mimeType)}`;
};

const loadImageFromFile = (file, mimeType) =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({ image, objectUrl });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);

      if (mimeType.includes("heic") || mimeType.includes("heif")) {
        reject(new Error("This browser could not read the HEIC/HEIF image. Please convert it to PNG, JPG, or WebP and try again."));
        return;
      }

      reject(new Error("This image format could not be processed in the editor."));
    };

    image.src = objectUrl;
  });

const drawImageToCanvas = (image, width, height) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas is not available for image processing.");
  }

  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const requestCanvasBlob = (canvas, mimeType, quality) =>
  new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob || null);
      },
      mimeType,
      quality,
    );
  });

const canvasToBlob = async (canvas, mimeType, quality) => {
  const primaryBlob = await requestCanvasBlob(canvas, mimeType, quality);
  if (primaryBlob) {
    return primaryBlob;
  }

  if (mimeType !== "image/jpeg") {
    const fallbackBlob = await requestCanvasBlob(canvas, "image/jpeg", quality);
    if (fallbackBlob) {
      return fallbackBlob;
    }
  }

  throw new Error("Failed to encode the image.");
};

const buildFileFromBlob = (blob, originalFile, mimeType = blob.type || DEFAULT_OUTPUT_MIME_TYPE) =>
  new File([blob], replaceFileExtension(originalFile.name, mimeType), {
    type: mimeType,
    lastModified: Date.now(),
  });

const normalizeFileMimeType = (file, mimeType) => {
  if (!file) return file;
  if (file.type === mimeType) {
    return file;
  }

  return new File([file], file.name, {
    type: mimeType,
    lastModified: file.lastModified || Date.now(),
  });
};

const fitWithinDimension = (width, height, maxDimension) => {
  if (!width || !height || Math.max(width, height) <= maxDimension) {
    return { width, height };
  }

  if (width >= height) {
    const ratio = maxDimension / width;
    return {
      width: maxDimension,
      height: Math.max(1, Math.round(height * ratio)),
    };
  }

  const ratio = maxDimension / height;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: maxDimension,
  };
};

export const getPreferredImageUploadOutputType = (fileOrMimeType) => {
  const mimeType =
    typeof fileOrMimeType === "string" ? fileOrMimeType.toLowerCase() : inferMimeTypeFromFile(fileOrMimeType);

  if (!mimeType || mimeType === GIF_MIME_TYPE) {
    return mimeType || DEFAULT_OUTPUT_MIME_TYPE;
  }

  return DEFAULT_OUTPUT_MIME_TYPE;
};

export const optimizeImageForUpload = async (
  file,
  {
    targetMaxBytes = 700 * 1024,
    hardMaxBytes = 1024 * 1024,
    maxDimension = 1800,
    preserveSmallImageBelow = 1200,
    minDimension = 1200,
  } = {},
) => {
  const mimeType = inferMimeTypeFromFile(file);
  if (!mimeType.startsWith("image/")) {
    throw new Error("Only image files can be uploaded here.");
  }

  if (mimeType === GIF_MIME_TYPE) {
    return normalizeFileMimeType(file, mimeType);
  }

  if (!CONVERTIBLE_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image type. (${mimeType})`);
  }

  const { image, objectUrl } = await loadImageFromFile(file, mimeType);

  try {
    const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const isSmallEnoughToKeep =
      largestSide <= preserveSmallImageBelow &&
      file.size <= targetMaxBytes &&
      (mimeType === "image/jpeg" || mimeType === "image/jpg" || mimeType === "image/webp");

    if (isSmallEnoughToKeep) {
      return normalizeFileMimeType(file, mimeType);
    }

    let { width, height } = fitWithinDimension(image.naturalWidth, image.naturalHeight, maxDimension);
    let canvas = drawImageToCanvas(image, width, height);

    const prefersHigherQuality = SCREENSHOT_FRIENDLY_TYPES.has(mimeType);
    const qualityStart = prefersHigherQuality ? 0.92 : 0.86;
    const minQuality = prefersHigherQuality ? 0.78 : 0.7;
    const qualityStep = prefersHigherQuality ? 0.04 : 0.06;

    let bestBlob = null;
    let quality = qualityStart;

    while (quality >= minQuality) {
      const blob = await canvasToBlob(canvas, DEFAULT_OUTPUT_MIME_TYPE, quality);
      bestBlob = blob;

      if (blob.size <= targetMaxBytes) {
        return buildFileFromBlob(blob, file);
      }

      if (blob.size <= hardMaxBytes && quality <= minQuality + 0.001) {
        return buildFileFromBlob(blob, file);
      }

      quality -= qualityStep;
    }

    while (bestBlob && bestBlob.size > hardMaxBytes && Math.max(width, height) > minDimension) {
      const largestDimension = Math.max(width, height);
      const nextLargestDimension = Math.max(minDimension, Math.round(largestDimension * 0.9));
      const resizeRatio = nextLargestDimension / largestDimension;

      width = Math.max(1, Math.round(width * resizeRatio));
      height = Math.max(1, Math.round(height * resizeRatio));
      canvas = drawImageToCanvas(image, width, height);

      quality = Math.max(qualityStart - 0.02, minQuality);
      while (quality >= minQuality) {
        const blob = await canvasToBlob(canvas, DEFAULT_OUTPUT_MIME_TYPE, quality);
        bestBlob = blob;

        if (blob.size <= hardMaxBytes) {
          return buildFileFromBlob(blob, file);
        }

        quality -= qualityStep;
      }
    }

    if (!bestBlob) {
      throw new Error("Failed to optimize the image.");
    }

    return buildFileFromBlob(bestBlob, file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const compressImage = async (file, _maxSizeMB = 1, _outputType = DEFAULT_OUTPUT_MIME_TYPE) =>
  optimizeImageForUpload(file);
