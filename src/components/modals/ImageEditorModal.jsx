import { appAlert, appConfirm } from "../../utils/appDialogs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Brush,
  ChevronDown,
  Columns2,
  Eraser,
  PencilLine,
  RectangleHorizontal,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";

const PREVIEW_MAX_WIDTH = 740;
const PREVIEW_MAX_HEIGHT = 560;
const DEFAULT_BLUR_STRENGTH = 18;
const DEFAULT_BRUSH_SIZE = 28;
const RECT_BLUR_PADDING_RATIO = 0.75;
const WRAP_LAYOUT_DEFAULT_WIDTH = 320;
const INLINE_LAYOUT_DEFAULT_WIDTH = 320;
const DEFAULT_DRAW_STROKE_COLOR = "#ef4444";
const DEFAULT_DRAW_STROKE_OPACITY = 0.94;

const getToolFamily = (toolId) => {
  if (toolId === "rect" || toolId === "brush") return "blur";
  if (toolId === "pen" || toolId === "outline") return "mark";
  return "erase";
};

const MIME_EXTENSION_MAP = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const fitWithin = (width, height, maxWidth, maxHeight) => {
  if (!width || !height) {
    return { width: 0, height: 0 };
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
};

const getDefaultDisplaySize = (width, height) => {
  if (!width || !height) {
    return { width: 0, height: 0 };
  }

  if (width <= 800) {
    return { width, height };
  }

  const ratio = 800 / width;
  return {
    width: 800,
    height: Math.max(1, Math.round(height * ratio)),
  };
};

const applyWrapFriendlySize = (displaySize, alignment) => {
  if (!displaySize?.width || !displaySize?.height) {
    return displaySize;
  }

  if (alignment === "inline") {
    if (displaySize.width <= INLINE_LAYOUT_DEFAULT_WIDTH) {
      return displaySize;
    }

    const ratio = displaySize.height / displaySize.width;
    return {
      width: INLINE_LAYOUT_DEFAULT_WIDTH,
      height: Math.max(1, Math.round(INLINE_LAYOUT_DEFAULT_WIDTH * ratio)),
    };
  }

  if (alignment !== "left" && alignment !== "right") {
    return displaySize;
  }

  if (displaySize.width <= WRAP_LAYOUT_DEFAULT_WIDTH) {
    return displaySize;
  }

  const ratio = displaySize.height / displaySize.width;
  return {
    width: WRAP_LAYOUT_DEFAULT_WIDTH,
    height: Math.max(1, Math.round(WRAP_LAYOUT_DEFAULT_WIDTH * ratio)),
  };
};

const fileNameWithEditedSuffix = (fileName, outputType) => {
  const safeName = String(fileName || "image").trim() || "image";
  const extension = MIME_EXTENSION_MAP[outputType] || "jpg";
  const withoutExtension = safeName.replace(/\.[^.]+$/, "");
  const baseName = withoutExtension.endsWith("-edited") ? withoutExtension : `${withoutExtension}-edited`;
  return `${baseName}.${extension}`;
};

const strokePath = (ctx, points, size) => {
  if (!points.length) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 1) {
    ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
  } else {
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
  }

  ctx.stroke();
};

const normalizeRect = (start, end) => {
  if (!start || !end) return null;

  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.max(1, Math.abs(end.x - start.x));
  const height = Math.max(1, Math.abs(end.y - start.y));

  return { x: left, y: top, width, height };
};

const getRectBlurPadding = (blurStrength) => Math.max(2, Math.round(blurStrength * RECT_BLUR_PADDING_RATIO));

const expandRectForBlur = (rect, blurStrength, maxWidth, maxHeight) => {
  if (!rect) return null;

  const padding = getRectBlurPadding(blurStrength);
  const left = Math.max(0, rect.x - padding);
  const top = Math.max(0, rect.y - padding);
  const right = Math.min(maxWidth, rect.x + rect.width + padding);
  const bottom = Math.min(maxHeight, rect.y + rect.height + padding);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
};

const scaleOperation = (operation, scaleX, scaleY) => {
  if (!operation) return operation;

  if (operation.type === "blurRect") {
    return {
      ...operation,
      x: operation.x * scaleX,
      y: operation.y * scaleY,
      width: operation.width * scaleX,
      height: operation.height * scaleY,
    };
  }

  if (operation.type === "outlineRect") {
    const strokeScale = (scaleX + scaleY) / 2;
    return {
      ...operation,
      x: operation.x * scaleX,
      y: operation.y * scaleY,
      width: operation.width * scaleX,
      height: operation.height * scaleY,
      size: Math.max(1, (operation.size || 4) * strokeScale),
    };
  }

  if (operation.type === "blurStroke" || operation.type === "eraseStroke" || operation.type === "drawStroke") {
    const strokeScale = (scaleX + scaleY) / 2;
    return {
      ...operation,
      size: Math.max(1, operation.size * strokeScale),
      points: (operation.points || []).map((point) => ({
        x: point.x * scaleX,
        y: point.y * scaleY,
      })),
    };
  }

  return operation;
};

const drawMaskOperation = (ctx, operation, blurStrength) => {
  if (!operation) return;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";

  if (operation.type === "eraseStroke") {
    ctx.globalCompositeOperation = "destination-out";
    strokePath(ctx, operation.points || [], operation.size || DEFAULT_BRUSH_SIZE);
    ctx.restore();
    return;
  }

  if (operation.type === "blurStroke") {
    ctx.globalCompositeOperation = "source-over";
    strokePath(ctx, operation.points || [], operation.size || DEFAULT_BRUSH_SIZE);
    ctx.restore();
    return;
  }

  if (operation.type === "blurRect" && operation.width > 0 && operation.height > 0) {
    ctx.globalCompositeOperation = "source-over";
    const expandedRect = expandRectForBlur(operation, blurStrength, ctx.canvas.width, ctx.canvas.height);
    if (expandedRect) {
      ctx.fillRect(expandedRect.x, expandedRect.y, expandedRect.width, expandedRect.height);
    }
  }

  ctx.restore();
};

const drawOverlayOperation = (ctx, operation) => {
  if (!operation) return;

  ctx.save();

  if (operation.type === "eraseStroke") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000";
    strokePath(ctx, operation.points || [], operation.size || DEFAULT_BRUSH_SIZE);
    ctx.restore();
    return;
  }

  if (operation.type === "drawStroke") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = operation.color || DEFAULT_DRAW_STROKE_COLOR;
    ctx.globalAlpha =
      typeof operation.opacity === "number" && Number.isFinite(operation.opacity)
        ? operation.opacity
        : DEFAULT_DRAW_STROKE_OPACITY;
    strokePath(ctx, operation.points || [], operation.size || DEFAULT_BRUSH_SIZE);
  }

  if (operation.type === "outlineRect" && operation.width > 0 && operation.height > 0) {
    const strokeWidth = Math.max(2, operation.size || 4);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha =
      typeof operation.opacity === "number" && Number.isFinite(operation.opacity)
        ? operation.opacity
        : DEFAULT_DRAW_STROKE_OPACITY;
    ctx.strokeStyle = operation.color || DEFAULT_DRAW_STROKE_COLOR;
    ctx.lineWidth = strokeWidth;
    ctx.strokeRect(
      operation.x + strokeWidth / 2,
      operation.y + strokeWidth / 2,
      Math.max(1, operation.width - strokeWidth),
      Math.max(1, operation.height - strokeWidth),
    );
  }

  ctx.restore();
};

const buildMaskCanvas = (width, height, operations, blurStrength) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return canvas;
  }

  operations.forEach((operation) => {
    drawMaskOperation(ctx, operation, blurStrength);
  });

  return canvas;
};

const buildOverlayCanvas = (width, height, operations) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return canvas;
  }

  operations.forEach((operation) => {
    drawOverlayOperation(ctx, operation);
  });

  return canvas;
};

const renderComposite = ({ ctx, image, width, height, operations, blurStrength, blurredCanvas }) => {
  const imageWidth = image?.naturalWidth || width;
  const imageHeight = image?.naturalHeight || height;
  const scaleX = imageWidth ? width / imageWidth : 1;
  const scaleY = imageHeight ? height / imageHeight : 1;
  const scaledOperations =
    scaleX !== 1 || scaleY !== 1 ? operations.map((operation) => scaleOperation(operation, scaleX, scaleY)) : operations;
  const blurOperations = scaledOperations.filter(
    (operation) =>
      operation?.type === "blurRect" || operation?.type === "blurStroke" || operation?.type === "eraseStroke",
  );
  const overlayOperations = scaledOperations.filter(
    (operation) =>
      operation?.type === "drawStroke" || operation?.type === "outlineRect" || operation?.type === "eraseStroke",
  );

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  if (!scaledOperations.length) {
    return;
  }

  if (blurOperations.length > 0) {
    const maskCanvas = buildMaskCanvas(width, height, blurOperations, blurStrength);
    const layerCanvas = document.createElement("canvas");
    layerCanvas.width = width;
    layerCanvas.height = height;
    const layerCtx = layerCanvas.getContext("2d");

    if (layerCtx) {
      if (blurredCanvas) {
        layerCtx.drawImage(blurredCanvas, 0, 0);
      } else {
        layerCtx.filter = `blur(${blurStrength}px)`;
        layerCtx.drawImage(image, 0, 0, width, height);
        layerCtx.filter = "none";
      }

      layerCtx.globalCompositeOperation = "destination-in";
      layerCtx.drawImage(maskCanvas, 0, 0);
      ctx.drawImage(layerCanvas, 0, 0);
    }
  }

  if (overlayOperations.length > 0) {
    const overlayCanvas = buildOverlayCanvas(width, height, overlayOperations);
    ctx.drawImage(overlayCanvas, 0, 0);
  }
};

const canvasToBlob = (canvas, outputType) =>
  new Promise((resolve, reject) => {
    const quality = outputType === "image/jpeg" || outputType === "image/webp" ? 0.92 : undefined;
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("편집한 이미지를 저장하지 못했습니다."));
      },
      outputType,
      quality,
    );
  });

export default function ImageEditorModal({
  isOpen,
  onClose,
  onApply,
  onDelete = null,
  sourceFile = null,
  sourceUrl = "",
  outputFileName = "image",
  outputType = "image/jpeg",
  initialWidth = null,
  initialHeight = null,
  initialAlignment = "center",
}) {
  const canvasRef = useRef(null);
  const previewFrameRef = useRef(null);
  const sourceImageRef = useRef(null);
  const objectUrlRef = useRef("");
  const blurredPreviewCanvasRef = useRef(null);
  const pointerStartRef = useRef(null);
  const activePointerIdRef = useRef(null);

  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [tool, setTool] = useState("rect");
  const [blurStrength, setBlurStrength] = useState(DEFAULT_BLUR_STRENGTH);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [previewMaxWidth, setPreviewMaxWidth] = useState(PREVIEW_MAX_WIDTH);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [baseDisplaySize, setBaseDisplaySize] = useState({ width: 0, height: 0 });
  const [alignment, setAlignment] = useState(initialAlignment);
  const [maintainRatio, setMaintainRatio] = useState(true);
  const [expandedToolFamily, setExpandedToolFamily] = useState("blur");
  const [operations, setOperations] = useState([]);
  const [draftOperation, setDraftOperation] = useState(null);
  const [cursorPoint, setCursorPoint] = useState(null);

  const previewScaleX = previewSize.width && imageSize.width ? previewSize.width / imageSize.width : 1;
  const previewScaleY = previewSize.height && imageSize.height ? previewSize.height / imageSize.height : 1;
  const aspectRatio = displaySize.width && displaySize.height ? displaySize.width / displaySize.height : 1;
  const allOperations = useMemo(
    () => (draftOperation ? [...operations, draftOperation] : operations),
    [operations, draftOperation],
  );

  useEffect(() => {
    if (!isOpen || typeof ResizeObserver === "undefined") return undefined;

    const frame = previewFrameRef.current;
    if (!frame) return undefined;

    const updatePreviewMaxWidth = () => {
      const styles = window.getComputedStyle(frame);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft || "0") + Number.parseFloat(styles.paddingRight || "0");
      const nextWidth = Math.max(240, Math.floor(frame.clientWidth - horizontalPadding));
      setPreviewMaxWidth(Math.min(PREVIEW_MAX_WIDTH, nextWidth));
    };

    updatePreviewMaxWidth();

    const observer = new ResizeObserver(() => {
      updatePreviewMaxWidth();
    });

    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!imageSize.width || !imageSize.height) return;

    setPreviewSize(fitWithin(imageSize.width, imageSize.height, previewMaxWidth, PREVIEW_MAX_HEIGHT));
  }, [imageSize, previewMaxWidth]);

  useEffect(() => {
    if (!isOpen) return undefined;

    let cancelled = false;
    const image = new Image();

    const cleanupObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    };

      const handleLoaded = () => {
        if (cancelled) return;

      const nextDisplaySize =
        initialWidth && initialHeight
          ? { width: Number(initialWidth), height: Number(initialHeight) }
          : getDefaultDisplaySize(image.naturalWidth, image.naturalHeight);
      const normalizedDisplaySize = applyWrapFriendlySize(
        nextDisplaySize,
        initialAlignment || "center",
      );

      sourceImageRef.current = image;
      blurredPreviewCanvasRef.current = null;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setDisplaySize(normalizedDisplaySize);
      setBaseDisplaySize(normalizedDisplaySize);
      setAlignment(initialAlignment || "center");
      setMaintainRatio(true);
      setTool("rect");
      setExpandedToolFamily("blur");
      setBlurStrength(DEFAULT_BLUR_STRENGTH);
      setBrushSize(DEFAULT_BRUSH_SIZE);
      setOperations([]);
      setDraftOperation(null);
      setCursorPoint(null);
      setLoadError("");
      setIsLoading(false);
    };

    const handleError = () => {
      if (cancelled) return;
      sourceImageRef.current = null;
      blurredPreviewCanvasRef.current = null;
      setImageSize({ width: 0, height: 0 });
      setPreviewSize({ width: 0, height: 0 });
      setDisplaySize({ width: 0, height: 0 });
      setBaseDisplaySize({ width: 0, height: 0 });
      setOperations([]);
      setDraftOperation(null);
      setCursorPoint(null);
      setIsLoading(false);
      setLoadError("이미지를 불러오지 못했습니다. 다시 시도해 주세요.");
    };

    cleanupObjectUrl();
    setIsLoading(true);
    setLoadError("");

    image.onload = handleLoaded;
    image.onerror = handleError;

    if (sourceFile instanceof File) {
      const objectUrl = URL.createObjectURL(sourceFile);
      objectUrlRef.current = objectUrl;
      image.src = objectUrl;
    } else if (sourceUrl) {
      image.crossOrigin = "anonymous";
      image.src = sourceUrl;
    } else {
      handleError();
    }

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      cleanupObjectUrl();
    };
  }, [isOpen, sourceFile, sourceUrl, initialWidth, initialHeight, initialAlignment]);

  useEffect(() => {
    const image = sourceImageRef.current;
    const canvas = canvasRef.current;
    if (!isOpen || !image || !canvas || !previewSize.width || !previewSize.height) {
      return;
    }

    canvas.width = previewSize.width;
    canvas.height = previewSize.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (
      !blurredPreviewCanvasRef.current ||
      blurredPreviewCanvasRef.current.width !== previewSize.width ||
      blurredPreviewCanvasRef.current.height !== previewSize.height ||
      blurredPreviewCanvasRef.current.dataset.blurStrength !== String(blurStrength)
    ) {
      const previewBlurCanvas = document.createElement("canvas");
      previewBlurCanvas.width = previewSize.width;
      previewBlurCanvas.height = previewSize.height;
      const blurCtx = previewBlurCanvas.getContext("2d");

      if (blurCtx) {
        blurCtx.filter = `blur(${blurStrength}px)`;
        blurCtx.drawImage(image, 0, 0, previewSize.width, previewSize.height);
        blurCtx.filter = "none";
        previewBlurCanvas.dataset.blurStrength = String(blurStrength);
        blurredPreviewCanvasRef.current = previewBlurCanvas;
      }
    }

    renderComposite({
      ctx,
      image,
      width: previewSize.width,
      height: previewSize.height,
      operations: allOperations,
      blurStrength,
      blurredCanvas: blurredPreviewCanvasRef.current,
    });
  }, [isOpen, previewSize, allOperations, blurStrength]);

  const closeModal = () => {
    if (isSaving) return;
    onClose?.();
  };

  const handleDelete = () => {
    if (isSaving || typeof onDelete !== "function") return;
    onDelete();
  };

  const getImagePointFromEvent = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSize.width || !imageSize.height) return null;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const clientX = event.clientX ?? event.nativeEvent?.clientX;
    const clientY = event.clientY ?? event.nativeEvent?.clientY;
    if (typeof clientX !== "number" || typeof clientY !== "number") return null;

    return {
      x: Math.max(0, Math.min(imageSize.width, ((clientX - rect.left) / rect.width) * imageSize.width)),
      y: Math.max(0, Math.min(imageSize.height, ((clientY - rect.top) / rect.height) * imageSize.height)),
    };
  };

  const getOutlineStrokeSize = () => Math.max(3, Math.round(brushSize / 6));

  const createRectOperation = (mode, start, end) => {
    const rect = normalizeRect(start, end);
    if (!rect) return null;

    if (mode === "outline") {
      return {
        type: "outlineRect",
        ...rect,
        size: getOutlineStrokeSize(),
        color: DEFAULT_DRAW_STROKE_COLOR,
        opacity: DEFAULT_DRAW_STROKE_OPACITY,
      };
    }

    return { type: "blurRect", ...rect };
  };

  const beginStroke = (point, mode) => ({
    type: mode === "erase" ? "eraseStroke" : mode === "pen" ? "drawStroke" : "blurStroke",
    size: brushSize,
    points: [point],
    color: mode === "pen" ? DEFAULT_DRAW_STROKE_COLOR : undefined,
    opacity: mode === "pen" ? DEFAULT_DRAW_STROKE_OPACITY : undefined,
  });

  const handlePointerDown = (event) => {
    if (isLoading || isSaving || !sourceImageRef.current) return;

    event.preventDefault();

    const point = getImagePointFromEvent(event);
    if (!point) return;

    pointerStartRef.current = point;
    activePointerIdRef.current = event.pointerId ?? null;
    setCursorPoint(point);

    if (typeof event.currentTarget?.setPointerCapture === "function" && typeof event.pointerId === "number") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures and continue with local pointer events.
      }
    }

    if (tool === "rect" || tool === "outline") {
      setDraftOperation(createRectOperation(tool, point, point));
      return;
    }

    setDraftOperation(beginStroke(point, tool));
  };

  const handlePointerMove = (event) => {
    const point = getImagePointFromEvent(event);
    if (point) {
      setCursorPoint(point);
    }

    if (
      activePointerIdRef.current !== null &&
      typeof event.pointerId === "number" &&
      event.pointerId !== activePointerIdRef.current
    ) {
      return;
    }

    const startPoint = pointerStartRef.current;
    if (!startPoint || !point) return;

    if (tool === "rect" || tool === "outline") {
      setDraftOperation(createRectOperation(tool, startPoint, point));
      return;
    }

    setDraftOperation((prev) => {
      if (!prev) return beginStroke(startPoint, tool);
      return {
        ...prev,
        points: [...(prev.points || []), point],
      };
    });
  };

  const handlePointerUp = (event) => {
    if (
      activePointerIdRef.current !== null &&
      typeof event.pointerId === "number" &&
      event.pointerId !== activePointerIdRef.current
    ) {
      return;
    }

    const startPoint = pointerStartRef.current;
    pointerStartRef.current = null;
    activePointerIdRef.current = null;

    if (typeof event.currentTarget?.releasePointerCapture === "function" && typeof event.pointerId === "number") {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures and complete the stroke.
      }
    }

    if (!startPoint) return;

    const point = getImagePointFromEvent(event) || startPoint;
    setCursorPoint(point);

    if (tool === "rect" || tool === "outline") {
      const rectOperation = createRectOperation(tool, startPoint, point);
      if (rectOperation) {
        setOperations((prev) => [...prev, rectOperation]);
      }
      setDraftOperation(null);
      return;
    }

    setDraftOperation((prev) => {
      if (!prev) return null;
      const nextOperation = {
        ...prev,
        points: [...(prev.points || []), point],
      };
      setOperations((existing) => [...existing, nextOperation]);
      return null;
    });
  };

  const handlePointerCancel = (event) => {
    if (!pointerStartRef.current) return;
    handlePointerUp(event);
  };

  const handlePointerLeave = () => {
    if (!pointerStartRef.current) {
      setCursorPoint(null);
    }
  };

  const handleUndo = () => {
    setOperations((prev) => prev.slice(0, -1));
    setDraftOperation(null);
    pointerStartRef.current = null;
    activePointerIdRef.current = null;
  };

  const handleClear = async () => {
    if (operations.length === 0 && !draftOperation) {
      return;
    }

    const confirmed = (await appConfirm("가리기 작업을 모두 지울까요?"));
    if (!confirmed) {
      return;
    }

    setOperations([]);
    setDraftOperation(null);
    pointerStartRef.current = null;
    activePointerIdRef.current = null;
    setCursorPoint(null);
  };

  const syncDisplayPercent = (nextWidth) => {
    if (!baseDisplaySize.width) return 100;
    return Math.max(10, Math.min(200, Math.round((nextWidth / baseDisplaySize.width) * 100)));
  };

  const handleDisplayPercentChange = (event) => {
    const nextPercent = Number(event.target.value) || 100;
    const nextWidth = Math.max(1, Math.round((baseDisplaySize.width * nextPercent) / 100));
    const nextHeight = Math.max(1, Math.round((baseDisplaySize.height * nextPercent) / 100));
    setDisplaySize(applyWrapFriendlySize({ width: nextWidth, height: nextHeight }, alignment));
  };

  const handleDisplayWidthChange = (event) => {
    const nextWidth = Math.max(1, Number(event.target.value) || 0);
    if (!maintainRatio) {
      setDisplaySize((prev) => applyWrapFriendlySize({ ...prev, width: nextWidth }, alignment));
      return;
    }

    setDisplaySize(
      applyWrapFriendlySize(
        {
          width: nextWidth,
          height: Math.max(1, Math.round(nextWidth / aspectRatio)),
        },
        alignment,
      ),
    );
  };

  const handleDisplayHeightChange = (event) => {
    const nextHeight = Math.max(1, Number(event.target.value) || 0);
    if (!maintainRatio) {
      setDisplaySize((prev) => applyWrapFriendlySize({ ...prev, height: nextHeight }, alignment));
      return;
    }

    setDisplaySize(
      applyWrapFriendlySize(
        {
          width: Math.max(1, Math.round(nextHeight * aspectRatio)),
          height: nextHeight,
        },
        alignment,
      ),
    );
  };

  const handleAlignmentChange = (nextAlignment) => {
    setAlignment(nextAlignment);
    setDisplaySize((currentSize) => applyWrapFriendlySize(currentSize, nextAlignment));
  };

  const handleApply = async () => {
    const image = sourceImageRef.current;
    if (!image) return;

    setIsSaving(true);

    try {
      let resultFile = null;

      if (operations.length > 0) {
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = image.naturalWidth;
        exportCanvas.height = image.naturalHeight;
        const ctx = exportCanvas.getContext("2d");

        if (!ctx) {
          throw new Error("이미지 편집 캔버스를 준비하지 못했습니다.");
        }

        renderComposite({
          ctx,
          image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          operations,
          blurStrength,
          blurredCanvas: null,
        });

        const blob = await canvasToBlob(exportCanvas, outputType);
        resultFile = new File([blob], fileNameWithEditedSuffix(outputFileName, outputType), {
          type: outputType,
          lastModified: Date.now(),
        });
      } else if (sourceFile instanceof File) {
        resultFile = sourceFile;
      }

      onApply?.({
        file: resultFile,
        width: displaySize.width,
        height: displaySize.height,
        alignment,
      });
    } catch (error) {
      console.error("Failed to apply image editor:", error);
      appAlert(error?.message || "이미지 편집 결과를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const toolOptions = {
    rect: {
      id: "rect",
      label: "사각 블러",
      Icon: RectangleHorizontal,
      family: "blur",
    },
    brush: {
      id: "brush",
      label: "붓 블러",
      Icon: Brush,
      family: "blur",
    },
    pen: {
      id: "pen",
      label: "빨간펜",
      Icon: PencilLine,
      family: "mark",
    },
    outline: {
      id: "outline",
      label: "강조 테두리",
      Icon: Square,
      family: "mark",
    },
    erase: {
      id: "erase",
      label: "지우개",
      Icon: Eraser,
      family: "erase",
    },
  };

  const toolFamilies = [
    {
      id: "blur",
      label: "블러 도구",
      Icon: Brush,
      tools: ["rect", "brush"],
    },
    {
      id: "mark",
      label: "표시 도구",
      Icon: PencilLine,
      tools: ["pen", "outline"],
    },
    {
      id: "erase",
      label: "정리 도구",
      Icon: Eraser,
      tools: ["erase"],
    },
  ];

  const alignmentButtons = [
    {
      value: "left",
      label: "왼쪽 배열",
      Icon: AlignLeft,
    },
    {
      value: "center",
      label: "일반 삽입",
      Icon: AlignCenter,
    },
    {
      value: "right",
      label: "오른쪽 배열",
      Icon: AlignRight,
    },
    {
      value: "inline",
      label: "나란히",
      Icon: Columns2,
    },
  ];

  const activeTool = toolOptions[tool] || toolOptions.rect;
  const activeToolFamily = getToolFamily(tool);
  const displayPercent = syncDisplayPercent(displaySize.width);
  const canApply = !isLoading && !isSaving && (sourceImageRef.current || sourceFile);
  const showBrushCursor = tool !== "rect" && tool !== "outline" && cursorPoint && previewScaleX && previewScaleY;
  const brushCursorClassName =
    tool === "pen"
      ? "border-rose-500/90 bg-rose-300/10"
      : tool === "erase"
        ? "border-slate-500/70 bg-white/20"
        : "border-sky-500/80 bg-sky-300/10";
  const draftRectPreview =
    draftOperation?.type === "blurRect"
      ? expandRectForBlur(
          scaleOperation(draftOperation, previewScaleX, previewScaleY),
          blurStrength,
          previewSize.width,
          previewSize.height,
        )
      : null;
  const draftOutlinePreview =
    draftOperation?.type === "outlineRect"
      ? scaleOperation(draftOperation, previewScaleX, previewScaleY)
      : null;
  const sizeControlLabel =
    tool === "erase"
      ? "지우개 크기"
      : tool === "pen"
        ? "펜 굵기"
        : tool === "outline"
          ? "테두리 굵기"
          : "블러 붓 크기";
  const showsBrushSizeControl = ["brush", "pen", "outline", "erase"].includes(tool);
  const selectTool = (nextTool) => {
    setTool(nextTool);
    setExpandedToolFamily(getToolFamily(nextTool));
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="이미지 편집" size="xl" zIndexBase={11000}>
      <div className="space-y-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div
              ref={previewFrameRef}
              className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-100 p-4"
            >
              <div
                className="relative mx-auto select-none"
                style={{ width: previewSize.width || "100%", minHeight: previewSize.height || 320 }}
              >
                {isLoading ? (
                  <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">
                    이미지를 불러오는 중입니다...
                  </div>
                ) : loadError ? (
                  <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-rose-300">
                    {loadError}
                  </div>
                ) : (
                  <>
                    <canvas
                      ref={canvasRef}
                      className="block max-w-full rounded-2xl border border-slate-200 bg-white shadow-sm"
                    />
                    <div
                      className="absolute inset-0 cursor-crosshair"
                      style={{ width: previewSize.width, height: previewSize.height, touchAction: "none" }}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerCancel}
                      onPointerLeave={handlePointerLeave}
                    />
                    {draftRectPreview ? (
                      <div
                        className="pointer-events-none absolute rounded-xl border-2 border-sky-300 bg-sky-200/10"
                        style={{
                          left: `${draftRectPreview.x}px`,
                          top: `${draftRectPreview.y}px`,
                          width: `${draftRectPreview.width}px`,
                          height: `${draftRectPreview.height}px`,
                        }}
                      />
                    ) : null}
                    {draftOutlinePreview ? (
                      <div
                        className="pointer-events-none absolute rounded-[1.1rem] border-4 border-rose-400/90 bg-transparent"
                        style={{
                          left: `${draftOutlinePreview.x}px`,
                          top: `${draftOutlinePreview.y}px`,
                          width: `${draftOutlinePreview.width}px`,
                          height: `${draftOutlinePreview.height}px`,
                        }}
                      />
                    ) : null}
                    {showBrushCursor ? (
                      <div
                        className={`pointer-events-none absolute rounded-full border ${brushCursorClassName}`}
                        style={{
                          left: `${cursorPoint.x * previewScaleX - (brushSize * previewScaleX) / 2}px`,
                          top: `${cursorPoint.y * previewScaleY - (brushSize * previewScaleY) / 2}px`,
                          width: `${brushSize * previewScaleX}px`,
                          height: `${brushSize * previewScaleY}px`,
                          boxShadow: "0 0 0 1px rgba(255,255,255,0.6)",
                        }}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1.5">편집 작업 {operations.length}개</span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5">
                원본 {imageSize.width || 0} x {imageSize.height || 0}
              </span>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-800">본문 크기</label>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-600">
                    {displayPercent}%
                  </span>
                </div>

                <input
                  type="range"
                  min="10"
                  max="200"
                  value={displayPercent}
                  onChange={handleDisplayPercentChange}
                  className="w-full accent-blue-500"
                  disabled={isLoading || isSaving || !baseDisplaySize.width}
                />

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">너비(px)</span>
                    <input
                      type="number"
                      value={displaySize.width || ""}
                      onChange={handleDisplayWidthChange}
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">높이(px)</span>
                    <input
                      type="number"
                      value={displaySize.height || ""}
                      onChange={handleDisplayHeightChange}
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                </div>

                <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={maintainRatio}
                    onChange={(event) => setMaintainRatio(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  가로세로 비율 유지
                </label>
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <label className="block text-sm font-semibold text-slate-800">배치 방식</label>
                  </div>
                  <span className="text-xs text-slate-500">네이버 블로그처럼 글과 함께 배치</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {alignmentButtons.map((button) => (
                    <button
                      key={button.value}
                      type="button"
                      onClick={() => handleAlignmentChange(button.value)}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        alignment === button.value
                          ? "border-blue-400 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`shrink-0 rounded-xl p-2 ${
                            alignment === button.value ? "bg-white text-blue-600" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          <button.Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 text-sm font-semibold break-keep">{button.label}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-800">편집 도구</label>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {activeTool.label}
                </span>
              </div>

              <div className="space-y-2">
                {toolFamilies.map((family) => {
                  const isExpanded = expandedToolFamily === family.id;
                  const isActiveFamily = activeToolFamily === family.id;

                  return (
                    <div
                      key={family.id}
                      className={`rounded-[1.5rem] border transition ${
                        isActiveFamily ? "border-slate-300 bg-slate-50/80" : "border-slate-200 bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedToolFamily((prev) => (prev === family.id ? "" : family.id))}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left"
                      >
                        <div
                          className={`rounded-2xl p-2 ${
                            isActiveFamily ? "bg-white text-slate-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          <family.Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{family.label}</div>
                        <ChevronDown
                          className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>

                      <div
                        className={`grid overflow-hidden px-4 transition-all duration-200 ease-out ${
                          isExpanded ? "max-h-64 gap-2 pb-4 opacity-100" : "max-h-0 gap-0 pb-0 opacity-0"
                        }`}
                        style={{ gridTemplateColumns: family.tools.length > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" }}
                      >
                        {family.tools.map((toolId) => {
                          const option = toolOptions[toolId];
                          const isSelected = tool === toolId;

                          return (
                            <button
                              key={toolId}
                              type="button"
                              onClick={() => selectTool(toolId)}
                              title={option.label}
                              aria-label={option.label}
                              className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-center transition ${
                                isSelected
                                  ? "border-blue-400 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              <div
                                className={`rounded-xl p-2 ${
                                  isSelected ? "bg-white text-blue-600" : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                <option.Icon className="h-4 w-4" />
                              </div>
                              <div className="text-xs font-semibold break-keep">{option.label}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{activeTool.label}</h3>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
                  <activeTool.Icon className="h-5 w-5" />
                </div>
              </div>

              {activeToolFamily === "blur" ? (
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-slate-800">블러 강도</label>
                  <input
                    type="range"
                    min="8"
                    max="32"
                    step="2"
                    value={blurStrength}
                    onChange={(event) => setBlurStrength(Number(event.target.value))}
                    className="w-full accent-blue-500"
                    disabled={isLoading || isSaving}
                  />
                  <p className="mt-2 text-xs text-slate-500">현재 강도: {blurStrength}px</p>
                </div>
              ) : null}

              {showsBrushSizeControl ? (
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-slate-800">{sizeControlLabel}</label>
                  <input
                    type="range"
                    min="10"
                    max="80"
                    step="2"
                    value={brushSize}
                    onChange={(event) => setBrushSize(Number(event.target.value))}
                    className="w-full accent-blue-500"
                    disabled={isLoading || isSaving}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    현재 {tool === "outline" ? "굵기" : "크기"}:{" "}
                    {tool === "outline" ? getOutlineStrokeSize() : brushSize}px
                  </p>
                </div>
              ) : null}

            </div>

            <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">작업 정리</h3>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {operations.length}개
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={isSaving || operations.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RotateCcw className="h-4 w-4" />
                  한 단계 취소
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={isSaving || (operations.length === 0 && !draftOperation)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                  전부 지우기
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <div>
            {typeof onDelete === "function" ? (
              <Button tone="red" kind="soft" onClick={handleDelete} disabled={isSaving}>
                이미지 삭제
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="slate" kind="outline" onClick={closeModal} disabled={isSaving}>
              취소
            </Button>
            <Button tone="blue" onClick={handleApply} disabled={!canApply} isLoading={isSaving}>
              적용
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
