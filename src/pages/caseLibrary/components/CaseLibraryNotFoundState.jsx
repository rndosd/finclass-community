import React from "react";
import { Button } from "../../../components/ui";

export default function CaseLibraryNotFoundState({ onBack }) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm">
      <p className="text-lg font-bold text-slate-700">
        해당 운영사례를 찾을 수 없습니다.
      </p>
      <Button tone="blue" className="mt-4" onClick={onBack}>
        목록으로 돌아가기
      </Button>
    </div>
  );
}
