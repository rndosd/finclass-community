import React from "react";
import { PlusCircle, X } from "lucide-react";
import { Button } from "../ui";

export default function QuestionEditor({
  question,
  onChange,
  onAddOption,
  onRemoveOption,
}) {
  const updateField = (key, value) => onChange({ ...question, [key]: value });
  const isMC = question.type === "multiple_choice";
  const isText = question.type === "text";
  const isRating = question.type === "rating";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <label className="mb-1 block text-sm font-semibold text-slate-800">
            질문 내용
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="질문을 입력하세요"
            value={question.question || ""}
            onChange={(e) => updateField("question", e.target.value)}
          />

          {isText && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                입력 힌트
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="응답 입력 안내 문구를 입력하세요"
                value={question.placeholder || ""}
                onChange={(e) => updateField("placeholder", e.target.value)}
              />
            </div>
          )}

          {isRating && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                최대 점수
              </label>
              <input
                type="number"
                min={3}
                max={10}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={question.maxScore ?? 5}
                onChange={(e) =>
                  updateField("maxScore", Number(e.target.value) || 5)
                }
              />
              <p className="mt-1 text-xs text-slate-500">
                점수 범위는 1점부터 최대 점수까지 자동으로 표시됩니다.
              </p>
            </div>
          )}
        </section>

        <aside className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              질문 유형
            </label>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              value={question.type || "multiple_choice"}
              onChange={(e) => updateField("type", e.target.value)}
            >
              <option value="multiple_choice">객관식</option>
              <option value="text">주관식</option>
              <option value="rating">평점</option>
            </select>
          </div>

          <label
            htmlFor={`required-${question.id}`}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <input
              type="checkbox"
              id={`required-${question.id}`}
              checked={!!question.required}
              onChange={(e) => updateField("required", e.target.checked)}
            />
            <span className="text-sm text-slate-700">필수 질문</span>
          </label>

          {isMC && (
            <label
              htmlFor={`allowMultiple-${question.id}`}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <input
                type="checkbox"
                id={`allowMultiple-${question.id}`}
                checked={!!question.allowMultiple}
                onChange={(e) => updateField("allowMultiple", e.target.checked)}
              />
              <span className="text-sm text-slate-700">복수 선택 허용</span>
            </label>
          )}
        </aside>
      </div>

      {isMC && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="mb-2 block text-sm font-semibold text-slate-800">
            보기 옵션
          </label>
          <div className="space-y-2">
            {(question.options || []).map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder={`보기 ${idx + 1}`}
                  value={opt}
                  onChange={(e) => {
                    const newOpts = [...(question.options || [])];
                    newOpts[idx] = e.target.value;
                    updateField("options", newOpts);
                  }}
                />
                <Button variant="ghost" kind="ghost"
                  type="button"
                  onClick={() => onRemoveOption(idx)}
                  title="삭제"
                  disabled={(question.options || []).length <= 2}
                  className="rounded-md border border-slate-200 p-2 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <Button variant="ghost" kind="ghost"
            type="button"
            onClick={onAddOption}
            className="mt-3 inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            <PlusCircle className="mr-1 h-4 w-4" />
            보기 추가
          </Button>
        </section>
      )}
    </div>
  );
}
