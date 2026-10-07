import React from "react";
import { Badge, ToggleSwitch } from "../../../components/ui";

function ScopeRow({ checked, disabled, label, onToggle }) {
  return (
    <label
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
        checked
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="text-sm font-semibold">{label}</span>
      {disabled ? <Badge tone="slate">필수</Badge> : null}
    </label>
  );
}

export default function CaseLibraryComposerTemplateAttachment({
  attachTemplate,
  pageMeta,
  selectedScopes,
  scopeOptions,
  templateRuntimeSupported,
  templateSupported,
  onAttachTemplateChange,
  onToggleScope,
}) {
  const pageLabel = pageMeta?.label || "이 페이지";
  const templateAvailable = templateSupported && templateRuntimeSupported;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">
            {pageLabel} 템플릿 첨부
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            현재 학급에서 작성한 {pageLabel} 설정 내용을 이 글과 함께 공유합니다.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            학생 개인정보와 학급 운영 기록은 템플릿에 포함되지 않습니다.
          </p>
        </div>

        <ToggleSwitch
          checked={attachTemplate}
          onChange={onAttachTemplateChange}
          disabled={!templateAvailable}
          tone="slate"
          inactiveClassName="bg-slate-300"
          srLabel={`${pageLabel} 템플릿 첨부`}
        />
      </div>

      {!templateSupported ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500">
          이 페이지는 템플릿 첨부 없이 일반 운영사례 글만 작성할 수 있습니다.
        </div>
      ) : null}

      {templateSupported && !templateRuntimeSupported ? (
        <div className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
          이 페이지는 아직 템플릿 첨부를 지원하지 않습니다.
        </div>
      ) : null}

      {templateAvailable && attachTemplate ? (
        <div className="mt-4 space-y-3">
          {scopeOptions.map((scope) => (
            <ScopeRow
              key={scope.id}
              checked={selectedScopes.includes(scope.id)}
              disabled={scope.required}
              label={scope.label}
              onToggle={() => onToggleScope(scope.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
