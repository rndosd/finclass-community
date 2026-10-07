import React from "react";
import { Badge } from "../../../components/ui";

export default function CaseLibraryApplyModeSelector({ classLabel, pageMeta }) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={pageMeta.tone}>{pageMeta.label}</Badge>
          <Badge tone="slate">현재 학급</Badge>
        </div>
        <Badge tone="emerald">삭제 없이 불러오기</Badge>
      </div>

      <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-800">
        {classLabel}
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        기존 설정은 남겨두고, 같은 항목만 갱신되거나 새 항목이 추가됩니다.
      </p>
    </div>
  );
}
