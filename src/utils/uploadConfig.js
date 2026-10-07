// utils/uploadConfig.js

export const IMAGE_INPUT_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/avif-sequence",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
];

const IMAGE_EXTENSION_MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export const UPLOAD_CONFIGS = {
  newsImage: {
    accept: IMAGE_INPUT_MIME_TYPES,
    maxSize: 1 * 1024 * 1024,
    maxGifSize: 2 * 1024 * 1024,
    folder: "news/images",
  },

  newsAttachment: {
    accept: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/haansofthwp",
    ],
    maxSize: 20 * 1024 * 1024,
    folder: "news/attachments",
  },

  profileImage: {
    accept: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 2 * 1024 * 1024,
    folder: "profiles",
  },

  video: {
    accept: ["video/mp4", "video/webm"],
    maxSize: 100 * 1024 * 1024,
    folder: "videos",
  },

  signatureImage: {
    accept: ["image/png"],
    maxSize: 1 * 1024 * 1024,
    folder: "signatures",
  },
};

export const inferMimeTypeFromFile = (file) => {
  const rawType = typeof file?.type === "string" ? file.type.trim().toLowerCase() : "";
  if (rawType) {
    return rawType === "image/jpg" ? "image/jpeg" : rawType;
  }

  const lowerName = String(file?.name || "").trim().toLowerCase();
  const matchedExtension = Object.keys(IMAGE_EXTENSION_MIME_MAP).find((extension) => lowerName.endsWith(extension));
  return matchedExtension ? IMAGE_EXTENSION_MIME_MAP[matchedExtension] : "";
};

export const validateFile = (file, configType) => {
  const config = UPLOAD_CONFIGS[configType];
  const fileType = inferMimeTypeFromFile(file);

  if (!config.accept.includes(fileType)) {
    throw new Error(`Unsupported file type. (${fileType || "unknown"})`);
  }

  if (file.size > config.maxSize) {
    const maxMB = (config.maxSize / 1024 / 1024).toFixed(0);
    throw new Error(`File size must be ${maxMB}MB or smaller.`);
  }

  return true;
};

export const validateNewsImageUpload = (file) => {
  const config = UPLOAD_CONFIGS.newsImage;
  const fileType = inferMimeTypeFromFile(file);

  if (!config.accept.includes(fileType)) {
    throw new Error(`Unsupported image type. (${fileType || "unknown"})`);
  }

  const sizeLimit = fileType === "image/gif" ? config.maxGifSize : config.maxSize;
  if (file.size > sizeLimit) {
    const maxMB = (sizeLimit / 1024 / 1024).toFixed(0);
    throw new Error(`Image size must be ${maxMB}MB or smaller.`);
  }

  return true;
};
