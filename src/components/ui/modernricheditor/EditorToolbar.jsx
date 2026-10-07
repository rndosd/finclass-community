import React from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BarChart3,
  Bold,
  ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo,
  Unlink,
} from "lucide-react";
import Spinner from "../Spinner";

const COLOR_SWATCHES = [
  { label: "기본 색상", value: null, className: "text-slate-700" },
  { label: "파란색", value: "#2563eb", className: "bg-blue-600" },
  { label: "초록색", value: "#059669", className: "bg-emerald-600" },
  { label: "주황색", value: "#ea580c", className: "bg-orange-600" },
  { label: "분홍색", value: "#db2777", className: "bg-pink-600" },
];

const ToolbarButton = ({ onClick, isActive, children, title, disabled }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    aria-label={title}
    className={`rounded-lg p-2 transition-colors ${
      isActive ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
    } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    title={title}
  >
    {children}
  </button>
);

const ToolbarDivider = ({ itemKey }) => <div key={itemKey} className="mx-1 h-6 w-px bg-slate-300" />;

const ToolbarColorButton = ({ color, label, isActive, onClick, disabled }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`flex h-7 w-7 items-center justify-center rounded-full border transition ${
      isActive
        ? "border-indigo-400 bg-indigo-50 shadow-sm"
        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
    } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
  >
    {color ? (
      <span className={`h-3.5 w-3.5 rounded-full ${label === "기본 색상" ? "" : color ? "" : ""} ${color ? "" : ""}`} style={{ backgroundColor: color }} />
    ) : (
      <span className="text-[11px] font-bold leading-none text-slate-700">A</span>
    )}
  </button>
);

const getHeadingValue = (editor) => {
  if (!editor) return 0;
  if (editor.isActive("heading", { level: 1 })) return 1;
  if (editor.isActive("heading", { level: 2 })) return 2;
  if (editor.isActive("heading", { level: 3 })) return 3;
  return 0;
};

const isAlignActive = (editor, value) => {
  try {
    return editor?.isActive({ textAlign: value }) || false;
  } catch {
    return false;
  }
};

const unlink = (editor) => {
  editor?.chain().focus().extendMarkRange("link").unsetLink().run();
};

const EditorToolbar = ({
  editor,
  toolbar = "standard",
  enableImageUpload = false,
  isUploading = false,
  onImageClick,
  onLinkClick,
  onSurveyClick,
  enableSurvey = false,
  readOnly = false,
}) => {
  const canUse = !!editor && !readOnly;
  const currentColor = editor?.getAttributes("textStyle")?.color?.toLowerCase?.() || null;

  const imageUploadButton = enableImageUpload
    ? [
        <ToolbarButton
          key="image"
          onClick={onImageClick}
          isActive={false}
          disabled={isUploading || !canUse}
          title="이미지 추가"
        >
          {isUploading ? (
            <Spinner size="xs" color="current" containerClassName="gap-0" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
        </ToolbarButton>,
        <ToolbarDivider key="divider-image" itemKey="divider-image" />,
      ]
    : [];

  const surveyButton = enableSurvey
    ? [
        <ToolbarButton
          key="survey"
          onClick={onSurveyClick}
          isActive={false}
          disabled={!canUse}
          title="설문 추가"
        >
          <BarChart3 className="h-4 w-4" />
        </ToolbarButton>,
        <ToolbarDivider key="divider-survey" itemKey="divider-survey" />,
      ]
    : [];

  const colorTools = COLOR_SWATCHES.map((swatch) => (
    <ToolbarColorButton
      key={`color-${swatch.label}`}
      color={swatch.value}
      label={swatch.label}
      disabled={!canUse}
      isActive={swatch.value ? currentColor === swatch.value : !currentColor}
      onClick={() => {
        if (!editor) return;
        if (swatch.value) {
          editor.chain().focus().setColor(swatch.value).run();
          return;
        }
        editor.chain().focus().unsetColor().run();
      }}
    />
  ));

  const tools = {
    none: [],
    mini: [
      <ToolbarButton
        key="bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor?.isActive("bold")}
        disabled={!canUse}
        title="굵게"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor?.isActive("italic")}
        disabled={!canUse}
        title="기울임"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor?.isActive("underline")}
        disabled={!canUse}
        title="밑줄"
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarDivider key="divider-mini-1" itemKey="divider-mini-1" />,
      <ToolbarButton
        key="bulletList"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor?.isActive("bulletList")}
        disabled={!canUse}
        title="글머리표"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="orderedList"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor?.isActive("orderedList")}
        disabled={!canUse}
        title="번호 목록"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarDivider key="divider-mini-2" itemKey="divider-mini-2" />,
      <ToolbarButton
        key="link"
        onClick={onLinkClick}
        isActive={editor?.isActive("link")}
        disabled={!canUse}
        title="링크"
      >
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="unlink"
        onClick={() => unlink(editor)}
        isActive={false}
        disabled={!canUse || !editor?.isActive("link")}
        title="링크 제거"
      >
        <Unlink className="h-4 w-4" />
      </ToolbarButton>,
    ],
    simple: [
      <ToolbarButton
        key="bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor?.isActive("bold")}
        disabled={!canUse}
        title="굵게"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor?.isActive("italic")}
        disabled={!canUse}
        title="기울임"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarDivider key="divider-simple" itemKey="divider-simple" />,
      <ToolbarButton
        key="bulletList"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor?.isActive("bulletList")}
        disabled={!canUse}
        title="글머리표"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>,
    ],
    standard: [
      ...imageUploadButton,
      ...surveyButton,
      <ToolbarButton
        key="bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor?.isActive("bold")}
        disabled={!canUse}
        title="굵게"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor?.isActive("italic")}
        disabled={!canUse}
        title="기울임"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="strike"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor?.isActive("strike")}
        disabled={!canUse}
        title="취소선"
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor?.isActive("underline")}
        disabled={!canUse}
        title="밑줄"
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarDivider key="divider-format" itemKey="divider-format" />,
      <div key="colors" className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
        {colorTools}
      </div>,
      <ToolbarDivider key="divider-heading" itemKey="divider-heading" />,
      <select
        key="heading"
        disabled={!canUse}
        onChange={(event) => {
          const level = parseInt(event.target.value, 10);
          if (level === 0) {
            editor.chain().focus().setParagraph().run();
            return;
          }
          editor.chain().focus().toggleHeading({ level }).run();
        }}
        className="rounded-lg border-0 bg-transparent px-2 py-1 text-sm focus:outline-none disabled:opacity-40"
        value={getHeadingValue(editor)}
        aria-label="제목 스타일"
      >
        <option value={0}>본문</option>
        <option value={1}>제목 1</option>
        <option value={2}>제목 2</option>
        <option value={3}>제목 3</option>
      </select>,
      <ToolbarDivider key="divider-align" itemKey="divider-align" />,
      <ToolbarButton
        key="alignLeft"
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        isActive={isAlignActive(editor, "left")}
        disabled={!canUse}
        title="왼쪽 정렬"
      >
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="alignCenter"
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        isActive={isAlignActive(editor, "center")}
        disabled={!canUse}
        title="가운데 정렬"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="alignRight"
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        isActive={isAlignActive(editor, "right")}
        disabled={!canUse}
        title="오른쪽 정렬"
      >
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarDivider key="divider-list" itemKey="divider-list" />,
      <ToolbarButton
        key="bulletList"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor?.isActive("bulletList")}
        disabled={!canUse}
        title="글머리표"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="orderedList"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor?.isActive("orderedList")}
        disabled={!canUse}
        title="번호 목록"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="blockquote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor?.isActive("blockquote")}
        disabled={!canUse}
        title="인용문"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarDivider key="divider-link" itemKey="divider-link" />,
      <ToolbarButton
        key="link"
        onClick={onLinkClick}
        isActive={editor?.isActive("link")}
        disabled={!canUse}
        title="링크"
      >
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="unlink"
        onClick={() => unlink(editor)}
        isActive={false}
        disabled={!canUse || !editor?.isActive("link")}
        title="링크 제거"
      >
        <Unlink className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarDivider key="divider-history" itemKey="divider-history" />,
      <ToolbarButton
        key="undo"
        onClick={() => editor.chain().focus().undo().run()}
        isActive={false}
        disabled={!canUse}
        title="실행 취소"
      >
        <Undo className="h-4 w-4" />
      </ToolbarButton>,
      <ToolbarButton
        key="redo"
        onClick={() => editor.chain().focus().redo().run()}
        isActive={false}
        disabled={!canUse}
        title="다시 실행"
      >
        <Redo className="h-4 w-4" />
      </ToolbarButton>,
    ],
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2">
      {(tools[toolbar] || tools.standard).filter(Boolean)}
    </div>
  );
};

export default EditorToolbar;
