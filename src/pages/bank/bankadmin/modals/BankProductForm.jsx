import React, { useEffect, useId, useMemo, useState } from "react";
import {
  DocumentTextIcon,
  ClockIcon,
  ChartBarIcon,
  StarIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { StudentSelector, ToggleSwitch, Tabs } from "../../../../components/ui";
import { formatBankMoney } from "../../../../utils/bankMoney";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const formatNumber = (value) => {
  if (value === null || value === undefined || value === "") return "";
  return formatBankMoney(value);
};

const parseNumber = (value) => {
  const cleaned = String(value).replace(/,/g, "").trim();
  return cleaned === ""
    ? null
    : isFinite(Number(cleaned))
      ? Number(cleaned)
      : null;
};

export default function BankProductForm({
  product,
  onChange,
  type = "deposit",
  tiers = [],
  students = [],
  currencyUnit = "단위",
}) {
  const formId = useId();
  const isDeposit = type === "deposit";
  const isTierRateAdjustmentEnabled = product.useTierRateAdjustment !== false;
  const isEarlyTerminationBlocked = product.earlyTerminationBlocked === true;
  const tierRateAdjustmentTitle = "신용등급 금리 조정";
  const tierRateAdjustmentDescription = isDeposit
    ? "학생 등급별 예금금리 조정 적용"
    : "학생 등급별 대출금리 조정 적용";
  const selectedStudentUids =
    product.eligibilityMode === "students" && Array.isArray(product.allowedStudentUids)
    ? product.allowedStudentUids
    : [];
  const hasTierSelection =
    product.eligibilityMode !== "students" &&
    product.minCreditScore !== null &&
    product.minCreditScore !== "";
  const [eligibilityTab, setEligibilityTab] = useState(
    product.eligibilityMode === "students" ? "students" : "tier",
  );

  useEffect(() => {
    setEligibilityTab(product.eligibilityMode === "students" ? "students" : "tier");
  }, [product.id, product.eligibilityMode]);

  const handleChange = (field, value) =>
    onChange({ ...product, [field]: value });
  const selectEligibilityTab = (tab) => {
    setEligibilityTab(tab);
    onChange({
      ...product,
      eligibilityMode: tab,
      ...(tab === "tier"
        ? { allowedStudentUids: [] }
        : { minCreditScore: null }),
    });
  };

  const updateEligibilityField = (field, value) => {
    const isStudentMode = field === "allowedStudentUids";
    onChange({
      ...product,
      [field]: value,
      eligibilityMode: isStudentMode ? "students" : "tier",
      ...(isStudentMode ? { minCreditScore: null } : { allowedStudentUids: [] }),
    });
  };

  // 💡 실시간 환산 로직
  const totalRate = Number(isDeposit ? product.rate : product.periodRate) || 0;
  const days = Number(product.days) || 1;
  const overdueRate = Number(product.overdueRate) || 0;

  const dailyRate = useMemo(
    () => (totalRate / days).toFixed(2),
    [totalRate, days],
  );

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm antialiased text-slate-800">
      {/* 윗부분: 타입 표시 및 활성화 상태 */}
      <div
        className={cx(
          "px-4 sm:px-6 py-3 flex flex-wrap gap-3 items-center justify-between border-b",
          isDeposit ? "bg-emerald-50" : "bg-rose-50",
        )}
      >
        <div className="flex items-center gap-2">
          <div
            className={cx(
              "p-1.5 rounded-lg",
              isDeposit
                ? "bg-emerald-500 text-white"
                : "bg-rose-500 text-white",
            )}
          >
            <ChartBarIcon className="w-4 h-4 font-bold" />
          </div>
          <span
            className={cx(
              "text-sm font-bold",
              isDeposit ? "text-emerald-700" : "text-rose-700",
            )}
          >
            {isDeposit ? "예금 상품 관리" : "대출 상품 관리"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-600 er">
            상품 활성화
          </span>
          <ToggleSwitch
            checked={!!product.active}
            onChange={(value) => handleChange("active", value)}
            tone={isDeposit ? "emerald" : "rose"}
            srLabel="상품 활성화"
          />
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* 1층: 이름과 기간 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1">
            <label htmlFor={`${formId}-name`} className="text-xs font-bold text-slate-600 ml-1">
              상품 명칭
            </label>
            <div className="relative">
              <input
                id={`${formId}-name`}
                type="text"
                value={product.label || ""}
                onChange={(e) => handleChange("label", e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-blue-50/50 border border-blue-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                placeholder="상품 이름을 입력하세요"
              />
              <DocumentTextIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${formId}-days`} className="text-xs font-bold text-slate-600 ml-1">
              운영 기간
            </label>
            <div className="relative">
              <input
                id={`${formId}-days`}
                type="number"
                value={product.days || ""}
                onChange={(e) => handleChange("days", Number(e.target.value))}
                className="w-full pl-10 pr-10 py-2.5 bg-blue-50/50 border border-blue-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <ClockIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-600">
                일
              </span>
            </div>
          </div>
        </div>

        {/* 2층: 이율과 한도 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-200 space-y-2">
            <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1">
              <label className="text-xs font-bold text-blue-700 ">
                약정 이율 (전체 기간)
              </label>
              <span className="text-xs font-bold text-blue-600">
                하루 평균 {dailyRate}%
              </span>
            </div>
            <div className="relative">
              <input
                aria-label="약정 이율 (전체 기간)"
                type="number"
                step="0.01"
                value={isDeposit ? product.rate : product.periodRate}
                onChange={(e) =>
                  handleChange(
                    isDeposit ? "rate" : "periodRate",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className="w-full px-0 py-1 bg-transparent border-none text-xl tabular-nums font-bold text-blue-700 focus:ring-2 focus:ring-blue-500/20 outline-none"
                placeholder="0.00"
              />
              <span className="absolute right-0 bottom-2 text-sm font-bold text-blue-600">
                %
              </span>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
            <label className="text-xs font-bold text-slate-600 ">
              가입 한도 금액
            </label>
            <div className="relative">
              <input
                aria-label="가입 한도 금액"
                type="text"
                value={formatNumber(
                  isDeposit
                    ? product.maxDepositProductLimit
                    : product.maxLoanProductLimit,
                )}
                onChange={(e) =>
                  handleChange(
                    isDeposit
                      ? "maxDepositProductLimit"
                      : "maxLoanProductLimit",
                    parseNumber(e.target.value),
                  )
                }
                className="w-full px-0 py-1 bg-transparent border-none text-xl tabular-nums font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20 outline-none"
                placeholder="무제한"
              />
              <span className="absolute right-0 bottom-2 text-sm font-bold text-slate-500">
                {currencyUnit}
              </span>
            </div>
          </div>
        </div>

        {/* 3층: 가입 자격 */}
        <div
          className={cx(
            "rounded-2xl border p-4",
            isDeposit
              ? "border-emerald-100 bg-emerald-50/70"
              : "border-rose-100 bg-rose-50/70",
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <label
                className={cx(
                  "flex items-center gap-2 text-xs font-bold",
                  isDeposit ? "text-emerald-600" : "text-rose-600",
                )}
              >
                <ShieldCheckIcon className="h-4 w-4" /> 가입 자격
              </label>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl border border-white bg-white/70">
            <div className="p-1.5">
              <Tabs
                tabs={[
                  { id: "tier", label: hasTierSelection ? "가입 등급 · 설정됨" : "가입 등급" },
                  { id: "students", label: selectedStudentUids.length > 0 ? `가입 가능한 학생 · ${selectedStudentUids.length}명` : "가입 가능한 학생" },
                ]}
                activeTab={eligibilityTab}
                onTabChange={selectEligibilityTab}
                variant="pills"
                idPrefix="bank-product-eligibility"
                size="sm"
                fullWidth
                wrapLabels
              />
            </div>

            <div className="p-3">
              {eligibilityTab === "tier" ? (
                <div className="relative">
                  <select
                    aria-label="가입 등급"
                    value={product.minCreditScore ?? ""}
                    onChange={(e) =>
                      updateEligibilityField(
                        "minCreditScore",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    className="h-[46px] w-full appearance-none rounded-xl border-none bg-blue-50/50 pl-10 pr-10 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">모든 학생 가능</option>
                    {tiers.map((t) => (
                      <option key={t.id} value={t.minScore}>
                        {t.name} 이상 ({t.minScore}점+)
                      </option>
                    ))}
                  </select>
                  <ShieldCheckIcon className="pointer-events-none absolute bottom-3.5 left-3.5 h-4 w-4 text-slate-500" />
                  <div className="pointer-events-none absolute bottom-3.5 right-3.5 text-slate-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m7 9 5 5 5-5" />
                    </svg>
                  </div>
                </div>
              ) : (
                <StudentSelector
                  hideLabel
                  selectedUids={selectedStudentUids}
                  onChange={(nextUids) =>
                    updateEligibilityField("allowedStudentUids", nextUids)
                  }
                  multiple
                  includeTeacher={false}
                  allowGroupSelect={false}
                  allStudents={students}
                  className="rounded-xl border border-slate-100 bg-white p-3"
                />
              )}
            </div>
          </div>
        </div>

        {/* 4층: 상품별 추가 조건 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            className={cx(
              "h-full rounded-2xl border p-4",
              isDeposit
                ? "border-emerald-100 bg-emerald-50/70"
                : "border-rose-100 bg-rose-50/70",
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="space-y-1">
                <label
                  className={cx(
                    "flex items-center gap-2 text-xs font-bold",
                    isDeposit ? "text-emerald-600" : "text-rose-600",
                  )}
                >
                  <StarIcon className="h-4 w-4" />
                  {tierRateAdjustmentTitle}
                </label>
                <p className="text-xs leading-5 font-medium text-slate-600">
                  {tierRateAdjustmentDescription}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                <span className="text-xs font-bold text-slate-500">
                  {isTierRateAdjustmentEnabled ? "사용" : "미사용"}
                </span>
                <ToggleSwitch
                  checked={isTierRateAdjustmentEnabled}
                  onChange={(value) => handleChange("useTierRateAdjustment", value)}
                  tone={isDeposit ? "emerald" : "rose"}
                  srLabel="등급별 금리 조정"
                />
              </div>
            </div>
          </div>

          {isDeposit ? (
            <div
              className={cx(
                "h-full rounded-2xl border p-4 transition-colors",
                isEarlyTerminationBlocked
                  ? "border-rose-100 bg-rose-50/70"
                  : "border-slate-100 bg-slate-50",
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="space-y-1">
                  <label
                    className={cx(
                      "flex items-center gap-2 text-xs font-bold",
                      isEarlyTerminationBlocked ? "text-rose-600" : "text-slate-500",
                    )}
                  >
                    <ShieldCheckIcon className="h-4 w-4" /> 중도해지 제한
                  </label>
                  <p className="text-xs leading-5 font-medium text-slate-600">
                    만기 전 해지 제한
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                  <span className="text-xs font-bold text-slate-500">
                    {isEarlyTerminationBlocked ? "제한" : "허용"}
                  </span>
                  <ToggleSwitch
                    checked={isEarlyTerminationBlocked}
                    onChange={(value) => handleChange("earlyTerminationBlocked", value)}
                    tone="rose"
                    srLabel="중도해지 제한"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
              <label className="flex items-center gap-1 text-xs font-bold text-amber-600">
                <ExclamationTriangleIcon className="h-4 w-4" /> 일일 연체 벌금 이율
              </label>
              <div className="relative mt-3">
                <input
                  aria-label="일일 연체 벌금 이율"
                  type="number"
                  step="0.1"
                  value={product.overdueRate || ""}
                  onChange={(e) => handleChange("overdueRate", Number(e.target.value))}
                  className="h-[46px] w-full rounded-xl border-none bg-blue-50/50 pl-10 pr-12 text-sm font-bold text-amber-700 outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="0.0"
                />
                <ArrowPathIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-300" />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-amber-700">
                  %/일
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 요약 바: 공간 활용 및 줄 맞춤 최적화 */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-slate-100 pt-5 px-1">
          {/* 1. 일일 정상 이자 */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-600 ">
              일일 정상 이자
            </span>
            <span className="text-sm font-bold text-slate-700">
              {dailyRate}%
            </span>
          </div>

          {/* 2. 일일 연체 벌금 (대출일 때만 노출, 아닐 땐 빈 공간 확보로 균등 유지) */}
          <div className="flex flex-col gap-1">
            {!isDeposit ? (
              <>
                <span className="text-xs font-bold text-amber-700 ">
                  일일 연체 벌금
                </span>
                <span className="text-sm font-bold text-amber-600">
                  {overdueRate}%
                </span>
              </>
            ) : (
              <>
                <span className="text-xs font-bold text-emerald-700 ">
                  최종 예상 이율
                </span>
                <span className="text-sm font-bold text-emerald-600">
                  {totalRate}%
                </span>
              </>
            )}
          </div>

          {/* 3. 벌금 강도 또는 수익성 */}
          <div className="flex flex-col gap-1">
            {!isDeposit ? (
              <>
                <span className="text-xs font-bold text-rose-700 ">
                  벌금 체감 강도
                </span>
                <span className="text-sm font-bold text-rose-500">
                  {dailyRate > 0 ? (overdueRate / dailyRate).toFixed(1) : 0}배
                  무거움
                </span>
              </>
            ) : (
              <>
                <span className="text-xs font-bold text-emerald-700 ">
                  상품 수익성
                </span>
                <span className="text-sm font-bold text-emerald-500">
                  {dailyRate > 0.5 ? "매우 높음" : "보통"}
                </span>
              </>
            )}
          </div>

          {/* 4. 필요 신용점수 (오른쪽 정렬을 제거하고 균등 배치) */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-600 ">
              필요 신용점수
            </span>
            <span className="text-sm font-bold text-blue-700">
              {product.minCreditScore || 0}점↑
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
