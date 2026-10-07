import React from "react";
import { Badge, Button } from "../../../components/ui";

export default function CaseLibraryEmptyState({
  actionLabel = "필터 초기화",
  description = "검색어나 카테고리를 조금만 바꿔 보면 원하는 글을 더 쉽게 찾을 수 있어요.",
  onAction,
  onReset,
  title = "조건에 맞는 운영사례가 아직 없어요.",
}) {
  const handleAction = onAction || onReset;

  return (
    <section className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
      <div className="mx-auto max-w-xl">
        <Badge tone="slate">아직 비어 있어요</Badge>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-900">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
        {handleAction ? (
          <div className="mt-6 flex justify-center">
            <Button tone="blue" onClick={handleAction}>
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
