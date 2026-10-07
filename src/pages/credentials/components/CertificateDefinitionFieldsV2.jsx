import { SelectField } from "../../../components/ui";
import { CERTIFICATE_NO_STAGE_ID } from "../CredentialsPage.parts";

export const CERTIFICATE_ISSUE_METHOD_OPTIONS_V2 = [
  { value: "manual", label: "교사 직접 발급" },
  { value: "assignment", label: "과제 조건 충족" },
  { value: "exam", label: "시험 조건 충족" },
  { value: "project", label: "프로젝트 조건 충족" },
];

export default function CertificateDefinitionFieldsV2({
  form,
  isSubmitting,
  certificateCategoryOptions,
  certificateGradeOptions,
  onCategoryChange,
  setField,
}) {
  return (
    <div className="space-y-5 rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
        <p className="text-sm font-semibold text-slate-800">자격증 발급 기준</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          이름과 취득 조건을 기준으로 자격증 카드와 상세 증서를 자동으로 만듭니다.
          카테고리와 선택한 단계는 카드의 색상과 인증 인장에만 반영됩니다.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="카테고리"
          value={form.categoryId || ""}
          onChange={(event) => onCategoryChange(event.target.value)}
          options={
            certificateCategoryOptions.length
              ? certificateCategoryOptions
              : [{ value: "", label: "자격증 설정에서 카테고리를 먼저 추가해 주세요" }]
          }
          disabled={isSubmitting || !certificateCategoryOptions.length}
        />
        <SelectField
          label="단계 (선택)"
          value={form.gradeId || CERTIFICATE_NO_STAGE_ID}
          onChange={(event) => {
            setField("gradeId", event.target.value);
            setField("level", event.target.value);
          }}
          options={certificateGradeOptions}
          disabled={isSubmitting}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-800">발급 방식</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          현재는 발급 화면에 표시되는 기준입니다. 자동 발급 연동은 별도 단계에서 연결합니다.
        </p>
        <div className="mt-3">
          <SelectField
            label="기준"
            value={form.issueMethod || "manual"}
            onChange={(event) => setField("issueMethod", event.target.value)}
            options={CERTIFICATE_ISSUE_METHOD_OPTIONS_V2}
            disabled={isSubmitting}
          />
        </div>
      </div>
    </div>
  );
}
