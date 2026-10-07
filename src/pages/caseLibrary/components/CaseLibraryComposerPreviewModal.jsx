import React from "react";
import { Badge, Button, Modal } from "../../../components/ui";

export default function CaseLibraryComposerPreviewModal({
  attachTemplate,
  bodyPreview,
  isOpen,
  onClose,
  onPublish,
  pageMeta,
  previewTitle,
  publishDisabled,
  scopeOptions,
  selectedScopes,
  teacherNamePublic,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title="게시 전 미리보기">
      <div className="space-y-6">
        <div className="rounded-[28px] bg-slate-50 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={pageMeta.tone}>{pageMeta.label}</Badge>
            {attachTemplate ? (
              <Badge tone="slate">템플릿 포함</Badge>
            ) : (
              <Badge tone="amber">일반 글</Badge>
            )}
            <Badge tone="slate">
              {teacherNamePublic ? "교사명 공개" : "교사명 비공개"}
            </Badge>
          </div>

          <h3 className="mt-4 text-xl font-black tracking-tight text-slate-900">
            {previewTitle}
          </h3>

          <div className="mt-4 rounded-[24px] border border-slate-200 bg-white px-4 py-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              본문 요약
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{bodyPreview}</p>
          </div>

          {attachTemplate ? (
            <>
              <div className="mt-4 rounded-[24px] border border-emerald-100 bg-emerald-50 px-4 py-4">
                <p className="text-sm font-semibold text-emerald-900">
                  현재 학급의 {pageMeta.label} 설정을 이 글과 함께 공유합니다.
                </p>
                <p className="mt-1 text-xs leading-5 text-emerald-700">
                  학생 개인정보와 학급 운영 기록은 템플릿에 포함되지 않습니다.
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedScopes.map((scopeId) => {
                  const scope = scopeOptions.find((item) => item.id === scopeId);
                  return scope ? (
                    <Badge key={scope.id} tone="emerald">
                      {scope.label}
                    </Badge>
                  ) : null;
                })}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex gap-3">
          <Button tone="slate" kind="outline" fullWidth onClick={onClose}>
            닫기
          </Button>
          <Button
            tone="blue"
            fullWidth
            onClick={onPublish}
            disabled={publishDisabled}
          >
            게시하기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
