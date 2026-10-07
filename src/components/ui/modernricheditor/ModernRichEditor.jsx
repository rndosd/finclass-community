import { appAlert, appConfirm } from "../../../utils/appDialogs";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import { TextAlign } from "@tiptap/extension-text-align";
import { Link as TiptapLink } from "@tiptap/extension-link";
import TiptapImage from "@tiptap/extension-image";
import { Plugin } from "@tiptap/pm/state";
import {
  Bold,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  Strikethrough,
  Underline as UnderlineIcon,
  Unlink,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import EditorToolbar from "./EditorToolbar";
import ImageEditorModal from "../../modals/ImageEditorModal";
import SurveyExtension from "../../survey/SurveyExtension";
import SurveyNode from "../../survey/SurveyNode";
import { Modal, Spinner } from "../../ui";
import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { getPreferredImageUploadOutputType, optimizeImageForUpload } from "../../../utils/imageUtils";
import { deleteFromR2, uploadToR2 } from "../../../utils/uploadToR2";
import { UPLOAD_CONFIGS, inferMimeTypeFromFile, validateNewsImageUpload } from "../../../utils/uploadConfig";

const EMPTY_UPLOAD_BATCH = { current: 0, total: 0 };
const INLINE_IMAGE_GROUP_LIMIT = 3;
const EMPTY_IMAGE_EDITOR_STATE = {
  isOpen: false,
  sourceFile: null,
  sourceUrl: "",
  outputFileName: "image",
  outputType: "image/jpeg",
  initialWidth: null,
  initialHeight: null,
  initialAlignment: "center",
  allowDelete: false,
};

const normalizeImageUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") return "";

  try {
    const url = new URL(rawUrl, "http://localhost");
    url.hash = "";
    return url.toString();
  } catch {
    return String(rawUrl).trim();
  }
};

const getManagedImageObjectKey = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  try {
    const url = new URL(rawUrl, "http://localhost");
    const cleanPath = decodeURIComponent(url.pathname || "").replace(/^\/+/, "");
    const folderPrefix = `${UPLOAD_CONFIGS.newsImage.folder}/`;
    const folderIndex = cleanPath.indexOf(folderPrefix);
    if (folderIndex === -1) return null;
    return cleanPath.slice(folderIndex);
  } catch {
    return null;
  }
};

const extractManagedImageUrlsFromHtml = (rawHtml) => {
  if (typeof rawHtml !== "string" || !rawHtml.trim() || typeof DOMParser === "undefined") {
    return new Set();
  }

  try {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    return new Set(
      Array.from(doc.querySelectorAll("img[src]"))
        .map((image) => normalizeImageUrl(image.getAttribute("src")))
        .filter((url) => Boolean(getManagedImageObjectKey(url))),
    );
  } catch {
    return new Set();
  }
};

const createEditorStats = (rawHtml, plainText = "") => {
  const html = typeof rawHtml === "string" ? rawHtml : "";
  const textFromEditor = typeof plainText === "string" ? plainText : "";

  if (typeof DOMParser === "undefined") {
    const fallbackTextLength = textFromEditor.replace(/\s+/g, " ").trim().length;
    return { textLength: fallbackTextLength, imageCount: 0, linkCount: 0 };
  }

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const textContent = (textFromEditor || doc.body?.textContent || "").replace(/\s+/g, " ").trim();

    return {
      textLength: textContent.length,
      imageCount: doc.querySelectorAll("img[src]").length,
      linkCount: doc.querySelectorAll("a[href]").length,
    };
  } catch {
    const fallbackTextLength = textFromEditor.replace(/\s+/g, " ").trim().length;
    return { textLength: fallbackTextLength, imageCount: 0, linkCount: 0 };
  }
};

const getSelectionText = (editor) => {
  if (!editor) return "";
  const { from, to, empty } = editor.state.selection;
  if (empty) return "";
  return editor.state.doc.textBetween(from, to, " ").trim();
};

const replaceSelectionWithLinkText = (editor, text, linkAttributes) => {
  if (!editor) return false;

  const { state, view } = editor;
  const { from, to, empty } = state.selection;
  const linkMarkType = state.schema.marks.link;
  if (empty || !linkMarkType) return false;

  const preservedMarks =
    state.selection.$from.marksAcross(state.selection.$to)?.filter((mark) => mark.type !== linkMarkType) ||
    state.selection.$from.marks().filter((mark) => mark.type !== linkMarkType);

  const nextText = String(text || "");
  const nextNode = state.schema.text(nextText, [...preservedMarks, linkMarkType.create(linkAttributes)]);

  view.dispatch(state.tr.replaceWith(from, to, nextNode).scrollIntoView());
  return true;
};

const escapeCssContent = (text) =>
  String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\A ");

const sanitizeLinkUrl = (rawUrl) => {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value)) {
    return value;
  }

  return `https://${value}`;
};

const extractImageFiles = (list) =>
  Array.from(list || []).filter((file) => {
    const mimeType = inferMimeTypeFromFile(file);
    return file && mimeType.startsWith("image/");
  });

const hasImageTransfer = (dataTransfer) => {
  if (!dataTransfer) return false;

  const itemHasImage = Array.from(dataTransfer.items || []).some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );

  if (itemHasImage) return true;
  return extractImageFiles(dataTransfer.files).length > 0;
};

const getClipboardImageFiles = (event) => {
  const clipboardItems = Array.from(event?.clipboardData?.items || []);
  const itemFiles = clipboardItems
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return extractImageFiles(event?.clipboardData?.files);
};

const getEditableImageOutputType = (rawType) => {
  return getPreferredImageUploadOutputType(rawType);
};

const getImageFileNameFromUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "image";
  }

  try {
    const url = new URL(rawUrl, "http://localhost");
    const fileName = decodeURIComponent(url.pathname.split("/").pop() || "").trim();
    return fileName || "image";
  } catch {
    return "image";
  }
};

const getEditableImageOutputTypeFromUrl = (rawUrl) => {
  return "image/webp";
};

const parseImageDimension = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? Math.round(value) : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
};

const parseInlineGroupMeta = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
};

const collectInlineImageGroupUpdates = (doc) => {
  const updates = [];

  const pushUpdateIfNeeded = (entry, groupSize, groupIndex) => {
    const currentGroupSize = parseInlineGroupMeta(entry.node?.attrs?.inlineGroupSize);
    const currentGroupIndex = parseInlineGroupMeta(entry.node?.attrs?.inlineGroupIndex);
    const desiredGroupSize = groupSize > 1 ? groupSize : null;
    const desiredGroupIndex = groupSize > 1 ? groupIndex : null;

    if (currentGroupSize === desiredGroupSize && currentGroupIndex === desiredGroupIndex) {
      return;
    }

    updates.push({
      pos: entry.pos,
      attrs: {
        ...entry.node.attrs,
        inlineGroupSize: desiredGroupSize,
        inlineGroupIndex: desiredGroupIndex,
      },
    });
  };

  const flushInlineGroup = (group) => {
    if (!group.length) return;

    for (let startIndex = 0; startIndex < group.length; startIndex += INLINE_IMAGE_GROUP_LIMIT) {
      const chunk = group.slice(startIndex, startIndex + INLINE_IMAGE_GROUP_LIMIT);
      const chunkSize = chunk.length;

      chunk.forEach((entry, chunkIndex) => {
        pushUpdateIfNeeded(entry, chunkSize, chunkIndex);
      });
    }
  };

  const walkNode = (node, basePos = 0) => {
    let currentInlineGroup = [];

    node.forEach((child, offset) => {
      const childPos = basePos + offset;
      const isInlineImage = child.type?.name === "image" && child.attrs?.align === "inline";

      if (isInlineImage) {
        currentInlineGroup.push({ node: child, pos: childPos });
      } else {
        flushInlineGroup(currentInlineGroup);
        currentInlineGroup = [];

        if (child.type?.name === "image") {
          pushUpdateIfNeeded({ node: child, pos: childPos }, null, null);
        }
      }

      if (child.childCount > 0) {
        walkNode(child, childPos + 1);
      }
    });

    flushInlineGroup(currentInlineGroup);
  };

  walkNode(doc);
  return updates;
};

const syncInlineImageGroupMetadata = (editor) => {
  if (!editor?.state || !editor?.view) {
    return false;
  }

  const updates = collectInlineImageGroupUpdates(editor.state.doc);
  if (!updates.length) {
    return false;
  }

  const transaction = editor.state.tr;
  updates.forEach(({ pos, attrs }) => {
    transaction.setNodeMarkup(pos, undefined, attrs);
  });

  if (!transaction.docChanged) {
    return false;
  }

  editor.view.dispatch(transaction);
  return true;
};

const BubbleActionButton = ({ onClick, isActive = false, children, title, disabled = false }) => (
  <button
    type="button"
    onMouseDown={(event) => event.preventDefault()}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    aria-label={title}
    title={title}
    className={`rounded-lg p-2 transition-colors ${
      isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
    } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
  >
    {children}
  </button>
);

const ModernRichEditor = forwardRef((props, ref) => {
  const {
    id,
    label,
    value = "",
    onChange,
    placeholder = "내용을 입력해 주세요.",
    height = "200px",
    disabled = false,
    readOnly = false,
    required = false,
    error = "",
    className = "",
    toolbar = "standard",
    enableImageUpload = false,
    enableSurvey = false,
    onUploadStateChange = null,
    ...restProps
  } = props;

  const { userData, classId } = useUser();
  const fileInputRef = useRef(null);
  const imageEditorResolverRef = useRef(null);
  const managedImageUrlsRef = useRef(new Set());
  const deletingImageUrlsRef = useRef(new Set());
  const dragDepthRef = useRef(0);
  const bubbleMenuIdRef = useRef(`modern-rich-editor-bubble-${Math.random().toString(36).slice(2, 8)}`);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadBatch, setUploadBatch] = useState(EMPTY_UPLOAD_BATCH);
  const [imageEditorState, setImageEditorState] = useState(EMPTY_IMAGE_EDITOR_STATE);
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [editingSurvey, setEditingSurvey] = useState(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState({
    url: "",
    text: "",
    openInNewTab: true,
    allowTextInput: false,
  });
  const [editorStats, setEditorStats] = useState(() =>
    createEditorStats(typeof value === "string" ? value : ""),
  );
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const isReadOnly = disabled || readOnly || typeof onChange !== "function";
  const showEditorChrome = toolbar !== "none" && !isReadOnly;

  const updateEditorStats = (nextHtml, plainText = "") => {
    setEditorStats(createEditorStats(nextHtml, plainText));
  };

  const deleteManagedImage = async (rawUrl) => {
    const normalizedUrl = normalizeImageUrl(rawUrl);
    const objectKey = getManagedImageObjectKey(normalizedUrl);
    if (!objectKey || deletingImageUrlsRef.current.has(normalizedUrl)) return;

    deletingImageUrlsRef.current.add(normalizedUrl);

    try {
      await deleteFromR2(objectKey);
    } catch (uploadError) {
      console.error("Failed to delete uploaded image from R2:", uploadError);
    } finally {
      deletingImageUrlsRef.current.delete(normalizedUrl);
    }
  };

  const resetImageEditor = () => {
    setImageEditorState(EMPTY_IMAGE_EDITOR_STATE);
  };

  const resolveImageEditorDialog = (result = null) => {
    const resolver = imageEditorResolverRef.current;
    imageEditorResolverRef.current = null;
    resetImageEditor();

    if (typeof resolver === "function") {
      resolver(result);
    }
  };

  const openImageEditor = ({
    sourceFile = null,
    sourceUrl = "",
    outputFileName = "image",
    outputType,
    initialWidth = null,
    initialHeight = null,
    initialAlignment = "center",
    allowDelete = false,
  }) =>
    new Promise((resolve) => {
      if (typeof imageEditorResolverRef.current === "function") {
        imageEditorResolverRef.current(null);
      }

      imageEditorResolverRef.current = resolve;
      setImageEditorState({
        isOpen: true,
        sourceFile,
        sourceUrl,
        outputFileName,
        outputType: getEditableImageOutputType(outputType || sourceFile?.type),
        initialWidth,
        initialHeight,
        initialAlignment,
        allowDelete,
      });
    });

  const prepareOptimizedImageFileForUpload = async (originalFile) => {
    const mimeType = inferMimeTypeFromFile(originalFile);

    if (!mimeType?.startsWith("image/")) {
      throw new Error("Only image files can be uploaded here.");
    }

    if (mimeType === "image/gif") {
      validateNewsImageUpload(originalFile);
      return originalFile;
    }

    const uploadFile = await optimizeImageForUpload(originalFile);
    validateNewsImageUpload(uploadFile);
    return uploadFile;
  };

  const buildImageNodeAttrs = (node, { src, width, height, alignment }) => ({
    ...node.attrs,
    ...(src ? { src } : {}),
    width: width ? `${Math.max(1, Math.round(width))}px` : null,
    height: height ? `${Math.max(1, Math.round(height))}px` : null,
    align: alignment || node?.attrs?.align || "center",
  });

  const updateExistingImageNode = ({ view, node, nodePos, src, width, height, alignment }) => {
    view.dispatch(view.state.tr.setNodeMarkup(nodePos, null, buildImageNodeAttrs(node, { src, width, height, alignment })));
    return true;
  };

  const deleteExistingImageNode = async ({ view, node, nodePos }) => {
    const confirmed = (await appConfirm("이미지를 삭제할까요?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
    if (!confirmed) {
      return false;
    }

    try {
      view.dispatch(view.state.tr.delete(nodePos, nodePos + node.nodeSize));
      await deleteManagedImage(node?.attrs?.src || "");
      return true;
    } catch (error) {
      console.error("Image delete failed:", error);
      return false;
    }
  };

  const replaceExistingImageWithFile = async ({ view, node, nodePos, editedFile, width, height, alignment }) => {
    if (!(editedFile instanceof File)) {
      return updateExistingImageNode({ view, node, nodePos, width, height, alignment });
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadBatch({ current: 1, total: 1 });

    try {
      const uploadFile = await prepareOptimizedImageFileForUpload(editedFile);
      const { fileUrl } = await uploadToR2(uploadFile, "newsImage", (percent) => {
        setUploadProgress(percent);
      });

      return updateExistingImageNode({
        view,
        node,
        nodePos,
        src: fileUrl,
        width,
        height,
        alignment,
      });
    } catch (uploadError) {
      console.error("Edited image upload error:", uploadError);
      appAlert(uploadError.message || "편집한 이미지를 업로드하지 못했습니다.");
      return false;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadBatch(EMPTY_UPLOAD_BATCH);
    }
  };

  const handleExistingImageEdit = async ({ node, nodePos, view, imgElement }) => {
    const width = parseImageDimension(node?.attrs?.width) || parseImageDimension(imgElement?.width);
    const height = parseImageDimension(node?.attrs?.height) || parseImageDimension(imgElement?.height);
    const alignment = node?.attrs?.align || "center";

    const editResult = await openImageEditor({
      sourceUrl: node?.attrs?.src || "",
      outputFileName: getImageFileNameFromUrl(node?.attrs?.src || ""),
      outputType: getEditableImageOutputTypeFromUrl(node?.attrs?.src || ""),
      initialWidth: width,
      initialHeight: height,
      initialAlignment: alignment,
      allowDelete: true,
    });

    if (!editResult) {
      return false;
    }

    if (editResult.action === "delete") {
      return deleteExistingImageNode({ view, node, nodePos });
    }

    return replaceExistingImageWithFile({
      view,
      node,
      nodePos,
      editedFile: editResult.file,
      width: editResult.width || width,
      height: editResult.height || height,
      alignment: editResult.alignment || alignment,
    });
  };

  const editor = useEditor({
    classId,
    userId: userData?.uid,
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
      }),
      TextStyle,
      Color,
      Underline,
      SurveyNode,
      TiptapLink.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-600 underline hover:text-blue-800",
        },
      }),
      TiptapImage.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            align: {
              default: "center",
              parseHTML: (element) => element.getAttribute("data-align") || "center",
              renderHTML: (attributes) => ({ "data-align": attributes.align || "center" }),
            },
            width: {
              default: null,
              parseHTML: (element) => element.getAttribute("width"),
              renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {}),
            },
            height: {
              default: null,
              parseHTML: (element) => element.getAttribute("height"),
              renderHTML: (attributes) => (attributes.height ? { height: attributes.height } : {}),
            },
            inlineGroupSize: {
              default: null,
              parseHTML: (element) => parseInlineGroupMeta(element.getAttribute("data-inline-group-size")),
              renderHTML: (attributes) =>
                attributes.align === "inline" && Number.isFinite(attributes.inlineGroupSize)
                  ? { "data-inline-group-size": String(attributes.inlineGroupSize) }
                  : {},
            },
            inlineGroupIndex: {
              default: null,
              parseHTML: (element) => parseInlineGroupMeta(element.getAttribute("data-inline-group-index")),
              renderHTML: (attributes) =>
                attributes.align === "inline" && Number.isFinite(attributes.inlineGroupIndex)
                  ? { "data-inline-group-index": String(attributes.inlineGroupIndex) }
                  : {},
            },
          };
        },
        addProseMirrorPlugins() {
          return [
            new Plugin({
              appendTransaction: (transactions, _oldState, newState) => {
                if (!transactions.some((transaction) => transaction.docChanged)) {
                  return null;
                }

                const updates = collectInlineImageGroupUpdates(newState.doc);
                if (!updates.length) {
                  return null;
                }

                const transaction = newState.tr;
                updates.forEach(({ pos, attrs }) => {
                  transaction.setNodeMarkup(pos, undefined, attrs);
                });

                return transaction.docChanged ? transaction : null;
              },
            }),
          ];
        },
      }).configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: "rounded-lg my-2",
        },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
    ],
    content: typeof value === "string" ? value : "",
    editable: !isReadOnly,
    onCreate: ({ editor: createdEditor }) => {
      syncInlineImageGroupMetadata(createdEditor);
    },
    onUpdate: ({ editor: nextEditor }) => {
      const html = nextEditor.getHTML();
      const nextManagedUrls = extractManagedImageUrlsFromHtml(html);
      const previousManagedUrls = managedImageUrlsRef.current;
      managedImageUrlsRef.current = nextManagedUrls;

      previousManagedUrls.forEach((url) => {
        if (!nextManagedUrls.has(url)) {
          void deleteManagedImage(url);
        }
      });

      updateEditorStats(html, nextEditor.getText());

      if (onChange) {
        onChange(html);
      }
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none p-3 focus:outline-none",
        style: `min-height: ${height}; max-height: 400px; overflow-y: auto;`,
      },
      handleClickOn(view, _pos, node, nodePos, event) {
        if (node.type.name === "image" && event?.target instanceof HTMLImageElement) {
          void handleExistingImageEdit({
            imgElement: event.target,
            view,
            node,
            nodePos,
          });
          return true;
        }

        return false;
      },
      handlePaste(view, event) {
        if (!enableImageUpload || isReadOnly) return false;

        const imageFiles = getClipboardImageFiles(event);
        if (imageFiles.length === 0) return false;

        void uploadImageFiles(imageFiles, { position: view.state.selection.from });
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);

        if (!enableImageUpload || isReadOnly || moved) return false;

        const imageFiles = extractImageFiles(event.dataTransfer?.files);
        if (imageFiles.length === 0) return false;

        const dropPosition =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;

        void uploadImageFiles(imageFiles, { position: dropPosition });
        return true;
      },
      handleDOMEvents: {
        dragenter: (_view, event) => {
          if (!enableImageUpload || isReadOnly || !hasImageTransfer(event.dataTransfer)) {
            return false;
          }

          dragDepthRef.current += 1;
          setIsDraggingFiles(true);
          return false;
        },
        dragover: (_view, event) => {
          if (!enableImageUpload || isReadOnly || !hasImageTransfer(event.dataTransfer)) {
            return false;
          }

          event.preventDefault();
          return false;
        },
        dragleave: (_view, event) => {
          if (!enableImageUpload || isReadOnly || !hasImageTransfer(event.dataTransfer)) {
            return false;
          }

          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setIsDraggingFiles(false);
          }

          return false;
        },
        drop: () => {
          dragDepthRef.current = 0;
          setIsDraggingFiles(false);
          return false;
        },
      },
    },
  });

  async function insertUploadedImage(fileUrl, imageAttrs = {}) {
    return new Promise((resolve) => {
      const image = new Image();

      const runInsert = (naturalWidth = 0, naturalHeight = 0) => {
        if (!editor) {
          resolve();
          return;
        }

        const attrs = {
          src: fileUrl,
          align: imageAttrs.alignment || "center",
        };

        let widthPx = parseImageDimension(imageAttrs.width);
        let heightPx = parseImageDimension(imageAttrs.height);

        if ((!widthPx || !heightPx) && naturalWidth && naturalHeight) {
          const maxWidth = 800;
          widthPx = naturalWidth;
          heightPx = naturalHeight;

          if (widthPx > maxWidth) {
            const ratio = maxWidth / widthPx;
            widthPx = maxWidth;
            heightPx = Math.round(heightPx * ratio);
          }
        }

        if (widthPx) {
          attrs.width = `${widthPx}px`;
        }

        if (heightPx) {
          attrs.height = `${heightPx}px`;
        }

        editor.chain().focus().setImage(attrs).run();
        resolve();
      };

      image.onload = () => {
        runInsert(image.naturalWidth, image.naturalHeight);
      };

      image.onerror = () => {
        runInsert();
      };

      image.src = fileUrl;
    });
  }

  async function uploadImageFiles(rawFiles, { position = null } = {}) {
    if (!editor || isReadOnly || !enableImageUpload) return false;

    const imageFiles = extractImageFiles(rawFiles);
    if (imageFiles.length === 0) return false;

    const filesToUpload = imageFiles.map((originalFile) => ({
      file: originalFile,
      width: null,
      height: null,
      alignment: "center",
    }));

    if (filesToUpload.length === 0) {
      return false;
    }

    if (typeof position === "number") {
      editor.chain().focus().setTextSelection(position).run();
    } else {
      editor.chain().focus().run();
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadBatch({ current: 1, total: filesToUpload.length });

    try {
      for (let index = 0; index < filesToUpload.length; index += 1) {
        const uploadTarget = filesToUpload[index];
        const uploadFile = await prepareOptimizedImageFileForUpload(uploadTarget.file);

        setUploadBatch({ current: index + 1, total: filesToUpload.length });

        const { fileUrl } = await uploadToR2(uploadFile, "newsImage", (percent) => {
          const totalPercent = Math.round(((index + percent / 100) / filesToUpload.length) * 100);
          setUploadProgress(totalPercent);
        });

        await insertUploadedImage(fileUrl, uploadTarget);
      }

      return true;
    } catch (uploadError) {
      console.error("Image upload error:", uploadError);
      appAlert(uploadError.message || "이미지를 업로드하지 못했습니다. 다시 시도해 주세요.");
      return true;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadBatch(EMPTY_UPLOAD_BATCH);
      setIsDraggingFiles(false);
      dragDepthRef.current = 0;

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  const closeLinkModal = () => {
    setLinkModalOpen(false);
    setLinkDraft({
      url: "",
      text: "",
      openInNewTab: true,
      allowTextInput: false,
    });
  };

  const openLinkModal = () => {
    if (!editor || isReadOnly) return;

    const isEditingExistingLink = editor.isActive("link");
    if (isEditingExistingLink) {
      editor.chain().focus().extendMarkRange("link").run();
    }

    const selectionEmpty = editor.state.selection.empty;
    const linkAttributes = editor.getAttributes("link");

    setLinkDraft({
      url: linkAttributes.href || "",
      text: selectionEmpty ? "" : getSelectionText(editor),
      openInNewTab: linkAttributes.target === "_blank" || !linkAttributes.href,
      allowTextInput: selectionEmpty || isEditingExistingLink,
    });
    setLinkModalOpen(true);
  };

  const handleLinkSubmit = (event) => {
    event.preventDefault();
    if (!editor) return;

    const normalizedUrl = sanitizeLinkUrl(linkDraft.url);
    if (!normalizedUrl) return;

    editor.chain().focus().run();

    const linkAttributes = linkDraft.openInNewTab
      ? {
          href: normalizedUrl,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        }
      : {
          href: normalizedUrl,
        };

    const selectionEmpty = editor.state.selection.empty;
    const isEditingExistingLink = editor.isActive("link");

    if (isEditingExistingLink) {
      const nextText = linkDraft.text.trim() || getSelectionText(editor) || normalizedUrl;
      const replaced = replaceSelectionWithLinkText(editor, nextText, linkAttributes);
      if (!replaced) {
        editor.chain().focus().extendMarkRange("link").setLink(linkAttributes).run();
      }
    } else if (!selectionEmpty) {
      editor.chain().focus().extendMarkRange("link").setLink(linkAttributes).run();
    } else {
      const text = linkDraft.text.trim() || normalizedUrl;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text,
          marks: [{ type: "link", attrs: linkAttributes }],
        })
        .run();
    }

    closeLinkModal();
  };

  const handleLinkRemove = () => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    closeLinkModal();
  };

  useEffect(() => {
    if (!editor) return;

    editor.setOptions({
      classId,
      userId: userData?.uid,
    });
    editor.setEditable(!isReadOnly);
  }, [editor, classId, userData?.uid, isReadOnly]);

  useImperativeHandle(ref, () => ({
    insertContent: (text) => {
      if (!editor) return;
      editor.chain().focus().insertContent(text).run();
    },
    getEditor: () => editor,
  }));

  useEffect(() => {
    const handleEditSurvey = async (event) => {
      try {
        const { surveyId } = event.detail || {};
        if (!surveyId || !classId) return;

        const surveyRef = doc(db, `classes/${classId}/surveys/${surveyId}`);
        const surveySnapshot = await getDoc(surveyRef);
        if (!surveySnapshot.exists()) return;

        const surveyData = surveySnapshot.data() || {};
        setEditingSurvey({ id: surveyId, ...surveyData });
        setSurveyModalOpen(true);
      } catch (surveyError) {
        console.error("Failed to load survey for editor:", surveyError);
      }
    };

    document.addEventListener("editSurvey", handleEditSurvey);

    return () => {
      document.removeEventListener("editSurvey", handleEditSurvey);
    };
  }, [classId]);

  useEffect(() => {
    if (!editor) return;

    const incomingValue = typeof value === "string" ? value : "";
    managedImageUrlsRef.current = extractManagedImageUrlsFromHtml(incomingValue);
    updateEditorStats(incomingValue);

    if (incomingValue !== editor.getHTML()) {
      editor.commands.setContent(incomingValue, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (typeof onUploadStateChange === "function") {
      onUploadStateChange(isUploading);
    }
  }, [isUploading, onUploadStateChange]);

  useEffect(
    () => () => {
      if (typeof imageEditorResolverRef.current === "function") {
        imageEditorResolverRef.current(null);
      }
    },
    [],
  );

  if (!editor) {
    return null;
  }

  const openFilePicker = () => {
    if (isReadOnly) return;
    fileInputRef.current?.click();
  };

  const handleImageClick = () => {
    openFilePicker();
  };

  const handleImageUploadInput = (event) => {
    void uploadImageFiles(event.target.files);
  };

  const handleSurveyClick = () => {
    setEditingSurvey(null);
    setSurveyModalOpen(true);
  };

  const handleSurveyInsert = (surveyInfo) => {
    try {
      if (!surveyInfo?.surveyId) return;

      editor
        .chain()
        .focus()
        .insertContent([{ type: "survey", attrs: { surveyId: surveyInfo.surveyId } }, { type: "paragraph" }])
        .run();
    } catch (surveyError) {
      console.error("Failed to insert survey block:", surveyError);
    }
  };

  const handleSurveyModalClose = () => {
    setSurveyModalOpen(false);
    setEditingSurvey(null);
  };

  const selectionIsLink = editor.isActive("link");
  const uploadLabel =
    uploadBatch.total > 1 ? `${uploadBatch.current} / ${uploadBatch.total} 이미지 업로드 중` : "이미지 업로드 중";

  return (
    <div className={`space-y-1 ${className}`} {...restProps}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}

      {enableImageUpload && (
        <input
          ref={fileInputRef}
          type="file"
          accept={UPLOAD_CONFIGS.newsImage.accept.join(",")}
          onChange={handleImageUploadInput}
          className="hidden"
          multiple
        />
      )}

      {isUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex min-w-[220px] flex-col items-center gap-3 rounded-2xl bg-white p-6 shadow-xl">
            <Spinner tone="indigo" />
            <p className="text-sm font-semibold text-slate-700">{uploadLabel}</p>
            <p className="text-xs text-slate-500">{uploadProgress}%</p>
          </div>
        </div>
      )}

      <div
        className={`overflow-hidden rounded-lg border ${
          error ? "border-red-300 ring-2 ring-red-100" : "border-slate-300"
        }`}
      >
        {showEditorChrome && (
          <EditorToolbar
            editor={editor}
            toolbar={toolbar}
            enableImageUpload={enableImageUpload}
            enableSurvey={enableSurvey}
            isUploading={isUploading}
            onImageClick={handleImageClick}
            onLinkClick={openLinkModal}
            onSurveyClick={handleSurveyClick}
            readOnly={isReadOnly}
          />
        )}

        {showEditorChrome && (
          <BubbleMenu
            editor={editor}
            pluginKey={bubbleMenuIdRef.current}
            shouldShow={({ editor: activeEditor, state }) =>
              activeEditor.isEditable && !state.selection.empty && !activeEditor.isActive("image")
            }
            tippyOptions={{ duration: 120, placement: "top", maxWidth: "none" }}
            className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur"
          >
            <BubbleActionButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive("bold")}
              title="굵게"
            >
              <Bold className="h-4 w-4" />
            </BubbleActionButton>
            <BubbleActionButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive("italic")}
              title="기울임"
            >
              <Italic className="h-4 w-4" />
            </BubbleActionButton>
            <BubbleActionButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive("underline")}
              title="밑줄"
            >
              <UnderlineIcon className="h-4 w-4" />
            </BubbleActionButton>
            <BubbleActionButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive("strike")}
              title="취소선"
            >
              <Strikethrough className="h-4 w-4" />
            </BubbleActionButton>
            <div className="mx-1 h-5 w-px bg-slate-200" />
            <BubbleActionButton onClick={openLinkModal} isActive={selectionIsLink} title="링크">
              <LinkIcon className="h-4 w-4" />
            </BubbleActionButton>
            <BubbleActionButton
              onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
              title="링크 제거"
              disabled={!selectionIsLink}
            >
              <Unlink className="h-4 w-4" />
            </BubbleActionButton>
          </BubbleMenu>
        )}

        <div className={`relative bg-white ${disabled ? "opacity-60" : ""}`}>
          {enableImageUpload && !isReadOnly && isDraggingFiles && (
            <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50/90 text-sm font-semibold text-blue-700">
              <div className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4" />
                이미지를 여기로 놓으면 바로 첨부됩니다.
              </div>
            </div>
          )}
          <EditorContent editor={editor} className="min-h-0" />
        </div>

        {showEditorChrome && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-3">
              <span>글자 {editorStats.textLength}</span>
              <span>이미지 {editorStats.imageCount}</span>
              <span>링크 {editorStats.linkCount}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-slate-400">
              <span>이미지를 클릭하면 가리기와 크기 조절을 한 번에 다시 편집할 수 있습니다.</span>
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      <Modal isOpen={linkModalOpen} onClose={closeLinkModal} title="링크 추가" size="sm">
        <form className="space-y-4" onSubmit={handleLinkSubmit}>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700" htmlFor={`${id || "editor"}-link-url`}>
              URL
            </label>
            <input
              id={`${id || "editor"}-link-url`}
              type="text"
              value={linkDraft.url}
              onChange={(event) => setLinkDraft((prev) => ({ ...prev, url: event.target.value }))}
              placeholder="https://example.com"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {linkDraft.allowTextInput && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700" htmlFor={`${id || "editor"}-link-text`}>
                표시 텍스트
              </label>
              <input
                id={`${id || "editor"}-link-text`}
                type="text"
                value={linkDraft.text}
                onChange={(event) => setLinkDraft((prev) => ({ ...prev, text: event.target.value }))}
                placeholder="링크에 표시할 문구"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={linkDraft.openInNewTab}
              onChange={(event) => setLinkDraft((prev) => ({ ...prev, openInNewTab: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            새 탭에서 열기
          </label>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleLinkRemove}
              disabled={!editor.isActive("link")}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              링크 제거
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeLinkModal}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={!sanitizeLinkUrl(linkDraft.url)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                적용
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={surveyModalOpen}
        onClose={handleSurveyModalClose}
        title={editingSurvey ? "설문 수정" : "설문 추가"}
        size="xl"
      >
        <SurveyExtension
          onInsertSurvey={handleSurveyInsert}
          editingSurvey={editingSurvey}
          classId={classId}
          userId={userData?.uid}
          onClose={handleSurveyModalClose}
        />
      </Modal>

      <ImageEditorModal
        isOpen={imageEditorState.isOpen}
        onClose={() => resolveImageEditorDialog(null)}
        onDelete={imageEditorState.allowDelete ? () => resolveImageEditorDialog({ action: "delete" }) : null}
        onApply={(result) => resolveImageEditorDialog(result)}
        sourceFile={imageEditorState.sourceFile}
        sourceUrl={imageEditorState.sourceUrl}
        outputFileName={imageEditorState.outputFileName}
        outputType={imageEditorState.outputType}
        initialWidth={imageEditorState.initialWidth}
        initialHeight={imageEditorState.initialHeight}
        initialAlignment={imageEditorState.initialAlignment}
      />

      <style>{`
        .ProseMirror {
          outline: none;
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          content: "${escapeCssContent(placeholder)}";
          float: left;
          color: #9ca3af;
          pointer-events: none;
          height: 0;
          white-space: pre-wrap;
        }

        .ProseMirror h1 {
          margin: 0.5rem 0;
          font-size: 1.5rem;
          font-weight: bold;
        }

        .ProseMirror h2 {
          margin: 0.5rem 0;
          font-size: 1.25rem;
          font-weight: bold;
        }

        .ProseMirror h3 {
          margin: 0.5rem 0;
          font-size: 1.125rem;
          font-weight: bold;
        }

        .ProseMirror ul,
        .ProseMirror ol {
          margin: 0.5rem 0;
          padding-left: 1.5rem;
        }

        .ProseMirror li {
          margin: 0.25rem 0;
        }

        .ProseMirror blockquote {
          margin: 0.5rem 0;
          border-left: 4px solid #e5e7eb;
          padding-left: 1rem;
          color: #6b7280;
          font-style: italic;
        }

        .ProseMirror img {
          display: block !important;
          max-width: 100% !important;
          height: auto !important;
        }

        .ProseMirror img[data-align="center"] {
          clear: both;
          margin: 0.5rem auto !important;
        }

        .ProseMirror img[data-align="left"] {
          float: left;
          clear: left;
          display: block !important;
          max-width: min(42%, 320px) !important;
          margin: 0.4rem 1rem 0.75rem 0 !important;
        }

        .ProseMirror img[data-align="right"] {
          float: right;
          clear: right;
          display: block !important;
          max-width: min(42%, 320px) !important;
          margin: 0.4rem 0 0.75rem 1rem !important;
        }

        .ProseMirror img[data-align="inline"] {
          clear: none;
          display: inline-block !important;
          vertical-align: top;
          width: min(100%, 320px);
          max-width: min(100%, 320px) !important;
          margin: 0.5rem 0.75rem 0.75rem 0 !important;
        }

        .ProseMirror img[data-align="inline"][data-inline-group-size="2"] {
          width: calc((100% - 0.75rem) / 2) !important;
          max-width: calc((100% - 0.75rem) / 2) !important;
        }

        .ProseMirror img[data-align="inline"][data-inline-group-size="3"] {
          width: calc((100% - 1.5rem) / 3) !important;
          max-width: calc((100% - 1.5rem) / 3) !important;
        }

        .ProseMirror img[data-align="inline"][data-inline-group-size="2"][data-inline-group-index="1"],
        .ProseMirror img[data-align="inline"][data-inline-group-size="3"][data-inline-group-index="2"] {
          margin-right: 0 !important;
        }

        .ProseMirror img.ProseMirror-selectednode {
          outline: 3px solid #3b82f6;
          outline-offset: 2px;
        }

        @media (max-width: 640px) {
          .ProseMirror img[data-align="left"],
          .ProseMirror img[data-align="right"],
          .ProseMirror img[data-align="inline"] {
            float: none;
            clear: both;
            display: block !important;
            max-width: 100% !important;
            margin: 0.75rem auto !important;
          }
        }
      `}</style>
    </div>
  );
});

ModernRichEditor.displayName = "ModernRichEditor";

export default ModernRichEditor;
