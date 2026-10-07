import { Send } from "lucide-react";

import {
  Badge,
  Button,
  InputField,
  Modal,
  SelectField,
  StudentSelector,
} from "../../../components/ui";
import TitleCategoryBadge from "./TitleCategoryBadge";

const TITLE_SOURCE_OPTIONS = [
  { value: "manual", label: "교사 직접 지급" },
  { value: "random_box", label: "랜덤 박스" },
  { value: "event", label: "이벤트 지급" },
  { value: "mission", label: "과제 완료" },
  { value: "claim_request", label: "학생 요청 승인" },
];

const CERTIFICATE_LEVEL_TONES = {
  basic: "emerald",
  intermediate: "blue",
  advanced: "violet",
};

export default function IssueModal({
  open,
  type,
  item,
  roster,
  selectedUids,
  onSelectedUidsChange,
  sourceType,
  onSourceTypeChange,
  sourceRefId,
  onSourceRefIdChange,
  expiresAt,
  onExpiresAtChange,
  onClose,
  onSubmit,
  isSubmitting,
}) {
  if (!open || !item) return null;

  const isTitle = type === "title";
  const gradeTone = isTitle
    ? item.gradeTone || "slate"
    : item.gradeTone || CERTIFICATE_LEVEL_TONES[item.level] || "blue";
  const gradeLabel = item.gradeLabel || (isTitle ? item.level || "등급" : "");

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title={isTitle ? "칭호 지급" : "자격증 발급"}
      size="lg"
    >
      <div className="space-y-6">
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {gradeLabel ? <Badge tone={gradeTone}>{gradeLabel}</Badge> : null}
	            {item.categoryLabel ? (
	              <TitleCategoryBadge
	                label={item.categoryLabel}
	                iconKey={item.categoryIconKey}
	                colorKey={item.categoryColorKey}
	              />
            ) : null}
            <p className="text-base font-bold text-slate-900">{item.name}</p>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {item.description || "설명이 없습니다."}
          </p>
        </div>

        <StudentSelector
          label={isTitle ? "지급 대상 학생" : "발급 대상 학생"}
          selectedUids={selectedUids}
          onChange={onSelectedUidsChange}
          multiple
          allStudents={roster}
          disabled={isSubmitting}
        />

        {isTitle ? (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">지급 설정</Badge>
              <TitleCategoryBadge
                label={item.categoryLabel}
                iconKey={item.categoryIconKey}
                colorKey={item.categoryColorKey}
              />
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              지급 출처와 기록 메모를 함께 남기면 나중에 지급 이력을 더 쉽게 확인할
              수 있습니다.
            </p>
            <div className="mt-4 grid gap-4">
              <SelectField
                label="지급 출처"
                value={sourceType || "manual"}
                onChange={(event) => onSourceTypeChange(event.target.value)}
                options={TITLE_SOURCE_OPTIONS}
                disabled={isSubmitting}
              />
              <InputField
                label="출처 기록"
                value={sourceRefId}
                onChange={(event) => onSourceRefIdChange(event.target.value)}
                placeholder="예: 예금과제-3차시-우수참여"
                disabled={isSubmitting}
              />
            </div>
          </div>
        ) : item.expiresEnabled ? (
	          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
	            <div className="mb-4 flex flex-wrap items-center gap-2">
	              <Badge tone="blue">
	                {item.issueMethod === "manual" ? "교사 수동 발급" : item.issueMethod || "자격증 발급"}
	              </Badge>
	              {item.categoryLabel ? (
	                <TitleCategoryBadge
	                  label={item.categoryLabel}
	                  iconKey={item.categoryIconKey}
	                  colorKey={item.categoryColorKey}
	                />
	              ) : null}
	            </div>
            <InputField
              label="만료일"
              type="date"
              value={expiresAt}
              onChange={(event) => onExpiresAtChange(event.target.value)}
              disabled={isSubmitting}
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              만료일을 설정하면 해당 날짜 이후에는 학생 화면에서 만료 상태로
              표시됩니다.
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            onClick={onSubmit}
            isLoading={isSubmitting}
            disabled={selectedUids.length === 0}
            icon={Send}
          >
            {isTitle ? "선택 학생에게 지급" : "선택 학생에게 발급"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
