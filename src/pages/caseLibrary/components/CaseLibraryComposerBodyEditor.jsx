import React from "react";
import { ModernRichEditor } from "../../../components/ui";

export default function CaseLibraryComposerBodyEditor({
  content,
  isUploading,
  onChange,
  onUploadStateChange,
}) {
  return (
    <div className="border-t border-slate-200 pt-4">
      <ModernRichEditor
        value={content}
        onChange={onChange}
        onUploadStateChange={onUploadStateChange}
        placeholder="화면 캡처와 설명을 본문에 바로 작성해 보세요."
        height="520px"
        enableImageUpload={true}
        enableSurvey={false}
      />

      {isUploading ? (
        <p className="mt-3 text-xs font-medium text-slate-500">
          이미지 업로드가 끝나면 이어서 작성할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
