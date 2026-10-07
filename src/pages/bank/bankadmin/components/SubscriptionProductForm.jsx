import React from "react";

import {
  InputField,
  Textarea,
  ToggleSwitch,
} from "../../../../components/ui";
import StudentSelector from "../../../../components/ui/StudentSelector";
import { SUBSCRIPTION_TYPE_ASSET_OPTIONS } from "../../../../assets/illustrations/subscriptionTypes";

const CalendarIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="h-3.5 w-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
    />
  </svg>
);

const UserGroupIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="h-4 w-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
    />
  </svg>
);

const toDateInputValue = (value) => {
  if (!value) return "";

  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date?.getTime?.()) ? "" : date.toISOString().split("T")[0];
  } catch {
    return "";
  }
};

export default function SubscriptionProductForm({ value, onChange }) {
  const productData = value || {};
  const { hasInterest = true, weeklyInterestRate = 2 } = productData;
  const earlyTerminationBlocked = productData.earlyTerminationBlocked === true;

  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] border border-blue-50 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="flex-[1.5]">
            <label className="mb-2 ml-1 block text-[11px] font-black uppercase text-blue-600/50">
              상품 이름
            </label>
            <InputField
              value={productData.title || ""}
              onChange={(event) => onChange({ ...productData, title: event.target.value })}
              placeholder="예: 6학년 1반 희망 청약"
              className="border-none !bg-slate-50/50 font-bold"
            />
          </div>
          <div className="flex-[2.5]">
            <label className="mb-2 ml-1 block text-[11px] font-black uppercase text-blue-600/50">
              상품 설명
            </label>
            <Textarea
              value={productData.description || ""}
              onChange={(event) => onChange({ ...productData, description: event.target.value })}
              placeholder="학생들에게 보여줄 간단한 설명을 입력해 주세요."
              rows={3}
              className="min-h-24 resize-y border-none !bg-slate-50/50"
            />
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-blue-50 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h4 className="text-xs font-black text-slate-800">청약 에셋</h4>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            학생 목록에서 상품을 구분하는 그림입니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SUBSCRIPTION_TYPE_ASSET_OPTIONS.map((option) => {
            const isSelected =
              (productData.assetKey || "subscriptionPassbook") === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange({ ...productData, assetKey: option.value })}
                className={
                  "flex flex-col items-center gap-2 rounded-2xl border p-3 text-xs font-black transition " +
                  (isSelected
                    ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                    : "border-slate-100 bg-slate-50 text-slate-500 hover:border-blue-200")
                }
              >
                <img src={option.asset} alt="" aria-hidden="true" className="h-14 w-14 object-contain" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-4 rounded-[2rem] border border-blue-50 bg-white p-6 shadow-sm md:col-span-1">
          <h4 className="flex items-center gap-2 text-xs font-black text-slate-800">
            <CalendarIcon /> 기간 설정
          </h4>
          <div className="space-y-3">
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold text-slate-400">
                시작일
              </label>
              <InputField
                type="date"
                value={toDateInputValue(productData.startDate)}
                onChange={(event) => onChange({ ...productData, startDate: event.target.value })}
                className="border-none !bg-slate-50/50 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold text-slate-400">
                종료일
              </label>
              <InputField
                type="date"
                value={toDateInputValue(productData.endDate)}
                onChange={(event) => onChange({ ...productData, endDate: event.target.value })}
                className="border-none !bg-slate-50/50 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-blue-50 bg-white p-6 shadow-sm md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-xs font-black text-slate-800">
              <UserGroupIcon /> 참여 학생 선택
            </h4>
            <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-500">
              {productData.targetStudents?.length > 0
                ? `${productData.targetStudents.length}명 선택`
                : "전체 학생 대상"}
            </span>
          </div>
          <div className="custom-scrollbar max-h-[160px] overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/30">
            <StudentSelector
              selectedUids={productData.targetStudents || []}
              onChange={(uids) => onChange({ ...productData, targetStudents: uids })}
              multiple
              className="p-2"
            />
          </div>
        </div>
      </div>

      <div
        className={`rounded-[2rem] border p-6 shadow-sm transition-all duration-300 ${
          earlyTerminationBlocked
            ? "border-rose-100 bg-rose-50/60"
            : "border-slate-100 bg-white"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4
              className={`text-xs font-black ${
                earlyTerminationBlocked ? "text-rose-700" : "text-slate-800"
              }`}
            >
              중도해지 제한
            </h4>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              켜두면 학생과 관리자가 만기 전 해지를 할 수 없습니다. 만기 수령은 그대로 가능합니다.
            </p>
          </div>
          <ToggleSwitch
            checked={earlyTerminationBlocked}
            srLabel="중도해지 제한"
            onChange={(nextValue) =>
              onChange({ ...productData, earlyTerminationBlocked: !!nextValue })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
          <h4 className="text-xs font-black text-slate-800">납입 조건</h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold text-slate-400">
                최소 금액
              </label>
              <InputField
                type="number"
                value={productData.minAmount ?? 1000}
                onChange={(event) =>
                  onChange({ ...productData, minAmount: Number(event.target.value) })
                }
                className="!text-sm border-none !bg-slate-50/50"
              />
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold text-slate-400">
                최대 금액
              </label>
              <InputField
                type="number"
                placeholder="제한 없음"
                value={productData.maxAmount ?? ""}
                onChange={(event) =>
                  onChange({
                    ...productData,
                    maxAmount: event.target.value ? Number(event.target.value) : null,
                  })
                }
                className="!text-sm border-none !bg-slate-50/50"
              />
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[10px] font-bold text-slate-400">
                주기(일)
              </label>
              <InputField
                type="number"
                value={productData.paymentCycle ?? 7}
                onChange={(event) =>
                  onChange({ ...productData, paymentCycle: Number(event.target.value) })
                }
                className="!text-sm border-none !bg-slate-50/50"
              />
            </div>
          </div>
        </div>

        <div
          className={`rounded-[2rem] border p-6 transition-all duration-300 ${
            hasInterest
              ? "border-blue-100 bg-blue-50/50"
              : "border-slate-100 bg-slate-50 opacity-60"
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <h4
              className={`text-xs font-black uppercase tracking-widest ${
                hasInterest ? "text-blue-600" : "text-slate-400"
              }`}
            >
              이자 설정
            </h4>
            <ToggleSwitch
              checked={hasInterest}
              onChange={(nextValue) => onChange({ ...productData, hasInterest: !!nextValue })}
            />
          </div>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label
                className={`mb-1 ml-1 block text-[10px] font-bold ${
                  hasInterest ? "text-blue-400" : "text-slate-400"
                }`}
              >
                주간 이율(%)
              </label>
              <InputField
                type="number"
                step="0.1"
                disabled={!hasInterest}
                value={hasInterest ? weeklyInterestRate : 0}
                onChange={(event) =>
                  onChange({
                    ...productData,
                    weeklyInterestRate: Number(event.target.value),
                  })
                }
                className={`border-none font-black transition-all ${
                  hasInterest ? "!bg-white !text-blue-600 shadow-sm" : "!bg-slate-100"
                }`}
              />
            </div>
            {hasInterest ? (
              <div className="pb-1 text-right">
                <p className="text-[10px] font-bold text-blue-300">일할 환산 이율(참고)</p>
                <p className="text-sm font-black text-blue-600">
                  {(weeklyInterestRate / 7).toFixed(2)}%
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
