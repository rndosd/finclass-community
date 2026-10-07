import React from "react";
import { Download, UploadCloud } from "lucide-react";
import { Button, Card, Spinner } from "../../../components/ui";

const ACCEPTED_XLSX =
  ".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TaxExcelPanel = ({
  title,
  description,
  helper = null,
  fileInputRef,
  onFileChange,
  onOpenFilePicker,
  onDownloadSample,
  fileName = "",
  isProcessing = false,
  processingLabel = "파일을 처리하는 중입니다.",
  filePlaceholder = "선택된 파일이 없습니다.",
  selectLabel = "엑셀 파일 선택",
  downloadLabel = "샘플 다운로드",
  children = null,
}) => {
  return (
    <Card
      icon={UploadCloud}
      className="overflow-hidden"
    >
      <Card.Header className="flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <Card.Title>{title}</Card.Title>
          <Card.Description>{description}</Card.Description>
        </div>

        <Button
          kind="ghost"
          tone="slate"
          size="sm"
          icon={Download}
          onClick={onDownloadSample}
          disabled={isProcessing}
        >
          {downloadLabel}
        </Button>
      </Card.Header>

      <Card.Content noPadding className="space-y-5">
        {helper && (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            {helper}
          </div>
        )}

        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:p-5">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_XLSX}
            onChange={onFileChange}
            disabled={isProcessing}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                kind="solid"
                tone="blue"
                icon={UploadCloud}
                onClick={onOpenFilePicker}
                disabled={isProcessing}
              >
                {selectLabel}
              </Button>

              <div
                className="min-h-[1.5rem] max-w-[420px] truncate text-sm text-slate-600"
                title={fileName || filePlaceholder}
              >
                {fileName || filePlaceholder}
              </div>
            </div>

            <span className="text-xs font-medium text-slate-500">
              .xlsx 파일만 지원
            </span>
          </div>

          {isProcessing && (
            <div role="status" aria-live="polite" className="mt-4 flex items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
              <Spinner size="sm" tone="blue" decorative />
              <span>{processingLabel}</span>
            </div>
          )}
        </div>

        {children}
      </Card.Content>
    </Card>
  );
};

export default TaxExcelPanel;
