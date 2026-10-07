import { appAlert } from "../../../utils/appDialogs";
import React, { useEffect, useState, useMemo } from "react";
import {
  DocumentTextIcon,
  ListBulletIcon,
} from "@heroicons/react/24/outline";
import { Button } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { buildLoanQuote } from "../utils/bankUtils";
import { formatBankMoney } from "../../../utils/bankMoney";
import loanProductAsset from "../../../assets/bank/loan-product-v1.png";

/** 클래스 합치기 헬퍼 */
const cx = (...classes) => classes.filter(Boolean).join(" ");
const APPROVED_LOAN_STATUSES = new Set(["ongoing", "active"]);

const getLoanOutstandingAmount = (loan) => {
  const status = String(loan?.status || "");
  if (status === "pending") {
    return Number(loan?.principal ?? loan?.amount ?? 0);
  }
  return Number(loan?.amountLeft ?? loan?.principal ?? loan?.amount ?? 0);
};

function BankLoanTab({
  isMyBankPage,
  bankSettings,
  loanAmount,
  setLoanAmount,
  selectedLoanProductId,
  setSelectedLoanProductId, // 🚀 훅에서 온 함수
  handleOpenLoanConfirmModal, // 🚀 모달을 여는 핵심 열쇠
  setShowLoanHistoryModal,
  studentInfo,
  currencyUnit: propCurrencyUnit,
  currentRateModifiers,
  isSubmitting,
  tierCriteria = [],
  isLoading,
  historyBadgeCount = 0,
  loans = [],
  onOpenLoanContractsModal,
  uid,
}) {
  const { classData, isTeacher, isAdmin } = useUser();
  const isManager = isTeacher || isAdmin;
  const [selectedProduct, setSelectedProduct] = useState(null);

  const currencyUnit = propCurrencyUnit || classData?.currencyUnit || "마로";

  // 1. 학생 신용 점수 및 등급 정보 계산
  const myScore = useMemo(
    () => Number(studentInfo?.creditScore || 0),
    [studentInfo],
  );

  const myCurrentTier = useMemo(() => {
    const tiers = Array.isArray(tierCriteria) ? tierCriteria : [];
    return tiers
      .filter((t) => myScore >= Number(t.minScore))
      .sort((a, b) => Number(b.minScore) - Number(a.minScore))[0];
  }, [myScore, tierCriteria]);

  // 💰 [보정치] 이미 알맹이 데이터이므로 바로 참조
  const baseLoanModifier = useMemo(() => {
    if (currentRateModifiers?.loanRateModifier !== undefined) {
      return Number(currentRateModifiers.loanRateModifier);
    }
    return Number(myCurrentTier?.loanRateModifier || 0);
  }, [currentRateModifiers, myCurrentTier]);

  // 2. 가입 자격 라벨 생성
  const getTierLabel = (requiredScore) => {
    if (!requiredScore || Number(requiredScore) === 0) return "누구나 가능";
    const tiers = Array.isArray(tierCriteria) ? tierCriteria : [];
    const matched = tiers.find(
      (t) => Number(t.minScore) === Number(requiredScore),
    );
    return matched ? `${matched.name} 이상` : `${requiredScore}점 이상`;
  };

  const isStudentEligibility = (product) => {
    const hasAllowedStudents =
      Array.isArray(product?.allowedStudentUids) &&
      product.allowedStudentUids.length > 0;
    return (
      product?.eligibilityMode === "students" ||
      (product?.eligibilityMode === "both" && hasAllowedStudents)
    );
  };

  const isStudentAllowed = (product) => {
    if (!isStudentEligibility(product)) return true;
    const allowedStudentUids = Array.isArray(product.allowedStudentUids)
      ? product.allowedStudentUids.map((value) => String(value))
      : [];
    return allowedStudentUids.includes(String(uid || ""));
  };

  const getEligibilityLabel = (product) => {
    if (isStudentEligibility(product)) {
      const count = Array.isArray(product.allowedStudentUids)
        ? product.allowedStudentUids.length
        : 0;
      return `지정 학생 ${count}명`;
    }
    return getTierLabel(product?.minCreditScore);
  };

  const isEligible = (product) => {
    if (!product) return false;
    const matchesStudent = isStudentAllowed(product);
    const matchesTier =
      !product.minCreditScore || myScore >= Number(product.minCreditScore);
    if (isStudentEligibility(product)) return matchesStudent;
    return matchesTier;
  };

  const currentProductLoanAmount = useMemo(() => {
    if (!selectedProduct) return 0;

    return (loans || []).reduce((total, loan) => {
      if (String(loan?.productId) !== String(selectedProduct.id)) return total;
      if (!APPROVED_LOAN_STATUSES.has(String(loan?.status || ""))) return total;
      return total + getLoanOutstandingAmount(loan);
    }, 0);
  }, [loans, selectedProduct]);

  const loanRatioLimit = useMemo(() => {
    if (!bankSettings?.isLoanLimitRatioEnabled) return Infinity;

    const ratio =
      studentInfo?.loanLimitRatio ?? bankSettings?.defaultLoanLimitRatio ?? 0.5;
    const assets = studentInfo?.assets || {};
    const netAssets = Number(assets.totalNetWorth || 0);

    return netAssets * ratio;
  }, [bankSettings, studentInfo]);

  // 🚀 [본질] 신청 버튼 클릭 시 모달 오픈 로직
  const handleApplyProcess = () => {
    const amount = Number(loanAmount);
    const minRequiredScore = selectedProduct?.minCreditScore
      ? Number(selectedProduct.minCreditScore)
      : 0;
    const maxLimit = selectedProduct?.maxLoanProductLimit
      ? Number(selectedProduct.maxLoanProductLimit)
      : Infinity;

    if (amount <= 0 || isNaN(amount))
      return appAlert("신청할 금액을 입력해주세요.");
    if (!selectedLoanProductId) return appAlert("대출 상품을 선택해주세요.");

    if (isStudentEligibility(selectedProduct) && !isStudentAllowed(selectedProduct))
      return appAlert("이 대출 상품은 지정된 학생만 신청할 수 있습니다.");
    if (!isStudentEligibility(selectedProduct) && myScore < minRequiredScore)
      return appAlert(
        `신청 자격이 부족합니다. (${getTierLabel(minRequiredScore)} 필요)`,
      );
    if (maxLimit > 0 && currentProductLoanAmount + amount > maxLimit)
      return appAlert(
        `이 상품은 현재 이용 중 금액을 포함해 최대 ${formatBankMoney(maxLimit)}${currencyUnit}까지만 신청할 수 있습니다.`,
      );
    if (
      bankSettings?.isLoanLimitRatioEnabled &&
      Number(studentInfo?.assets?.loan || 0) + amount > loanRatioLimit
    ) {
      return appAlert(
        `대출 가능 한도는 현재 대출 기준 최대 ${formatBankMoney(loanRatioLimit, { fractionDigits: 0 })}${currencyUnit}입니다.`,
      );
    }

    // ✅ 모든 검증 통과 시 훅의 모달 오픈 함수 실행
    handleOpenLoanConfirmModal();
  };

  const activeLoanProducts = useMemo(
    () => bankSettings?.loanProducts?.filter((p) => p.active) || [],
    [bankSettings],
  );

  useEffect(() => {
    // ID 비교 시 타입을 일치시키기 위해 String 처리
    const product = activeLoanProducts.find(
      (p) => String(p.id) === String(selectedLoanProductId),
    );
    setSelectedProduct(product || null);
  }, [selectedLoanProductId, activeLoanProducts]);

  if (!isMyBankPage && !isManager)
    return (
      <div className="p-10 text-center text-slate-500">
        접근 권한이 없습니다.
      </div>
    );
  if (isLoading || !bankSettings)
    return (
      <div className="p-10 text-center text-slate-400 font-bold italic animate-pulse">
        데이터 로딩 중...
      </div>
    );

  const enteredAmount = Math.max(0, Number(loanAmount) || 0);
  const selectedQuote = selectedProduct
    ? buildLoanQuote({
        principal: enteredAmount,
        baseRate: Number(selectedProduct.periodRate || 0),
        weeklyModifier: baseLoanModifier,
        productDays: selectedProduct.days || 0,
      })
    : null;
  const totalRepayment =
    enteredAmount + Number(selectedQuote?.totalEstimatedInterest || 0);
  const repaymentDate = selectedProduct
    ? new Date(Date.now() + Number(selectedProduct.days || 0) * 86400000)
    : null;
  const productRemainingLimit = selectedProduct?.maxLoanProductLimit
    ? Math.max(
        0,
        Number(selectedProduct.maxLoanProductLimit) - currentProductLoanAmount,
      )
    : Infinity;
  const ratioRemainingLimit = Number.isFinite(loanRatioLimit)
    ? Math.max(
        0,
        loanRatioLimit -
          Number(studentInfo?.assets?.loan || 0),
      )
    : Infinity;
  const availableLoanLimit = Math.min(
    productRemainingLimit,
    ratioRemainingLimit,
  );
  const canApply =
    Boolean(selectedLoanProductId) &&
    enteredAmount > 0 &&
    !isSubmitting &&
    isEligible(selectedProduct) &&
    (!Number.isFinite(availableLoanLimit) ||
      enteredAmount <= availableLoanLimit);

  const addAmount = (amount) => {
    setLoanAmount(String(Math.max(0, enteredAmount + amount)));
  };

  return (
    <div className="space-y-4 text-left animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,0.36fr)_minmax(0,0.64fr)]">
        <section
          data-tour="bank-loan-products"
          className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5"
        >
          <div className="mb-4 flex flex-col items-start gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-900">상품 선택</h3>
              <p className="mt-1 text-xs font-medium text-slate-500">
                내 적용 이율과 상환 기간을 함께 비교하세요.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => setShowLoanHistoryModal(true)}
                tone="slate"
                kind="outline"
                rounded="xl"
                className="relative gap-2"
              >
                <ListBulletIcon className="h-4 w-4" />
                대출 내역
                {historyBadgeCount > 0 ? (
                  <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                    {historyBadgeCount > 99 ? "99+" : historyBadgeCount}
                  </span>
                ) : null}
              </Button>
              {onOpenLoanContractsModal ? (
                <Button
                  type="button"
                  onClick={onOpenLoanContractsModal}
                  tone="slate"
                  kind="outline"
                  rounded="xl"
                  className="gap-2"
                >
                  <DocumentTextIcon className="h-4 w-4" />
                  계약서함
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-2.5">
            {activeLoanProducts.map((product) => {
              const eligible = isEligible(product);
              const isSelected =
                String(selectedLoanProductId) === String(product.id);
              const quote = buildLoanQuote({
                principal: 1000,
                baseRate: Number(product.periodRate || 0),
                weeklyModifier: baseLoanModifier,
                productDays: product.days || 0,
              });

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={!eligible}
                  onClick={() => setSelectedLoanProductId?.(product.id)}
                  className={cx(
                    "w-full rounded-2xl border p-4 text-left transition",
                    isSelected
                      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-100"
                      : eligible
                        ? "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"
                        : "cursor-not-allowed border-slate-200 bg-slate-50",
                  )}
                >
                  <span className="flex items-start gap-3">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-50">
                      <img
                        src={loanProductAsset}
                        alt=""
                        aria-hidden="true"
                        className={cx(
                          "h-12 w-12 object-contain transition",
                          !eligible
                            ? "grayscale opacity-35"
                            : isSelected
                              ? "scale-105 opacity-100"
                              : "opacity-85",
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <strong className="truncate text-lg font-black text-slate-900">
                          {product.label}
                        </strong>
                        {isSelected ? (
                          <span className="text-xs font-bold text-blue-600">
                            선택됨
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs font-medium text-slate-500">
                        {product.days}일 ·{" "}
                        {getEligibilityLabel(product)}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
                        <span className="text-slate-500">
                          기본 {formatBankMoney(product.periodRate || 0)}%
                        </span>
                        <span className="text-slate-300">→</span>
                        <span
                          className={
                            eligible ? "text-rose-600" : "text-slate-500"
                          }
                        >
                          내 적용 {formatBankMoney(quote.finalRate)}%
                        </span>
                      </span>
                      {product.maxLoanProductLimit ||
                      Number(product.overdueRate || 0) > 0 ? (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {product.maxLoanProductLimit ? (
                            <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                              한도{" "}
                              {formatBankMoney(product.maxLoanProductLimit)}
                              {currencyUnit}
                            </span>
                          ) : null}
                          {Number(product.overdueRate || 0) > 0 ? (
                            <span className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
                              연체 하루 {formatBankMoney(product.overdueRate)}%
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      {!eligible ? (
                        <span className="mt-2 block text-xs font-bold text-rose-600">
                          신청 제한 · {getEligibilityLabel(product)}{" "}
                          필요
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-xs font-medium leading-5 text-amber-800">
            대출은 이율뿐 아니라 총상환액과 상환일을 꼭 함께 확인하세요.
          </div>
        </section>

        <section
          data-tour="bank-loan-form"
          className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"
        >
          {!selectedProduct ? (
            <div className="flex min-h-[430px] flex-col items-center justify-center text-center">
              <img
                src={loanProductAsset}
                alt=""
                aria-hidden="true"
                className="h-20 w-20 object-contain opacity-80"
              />
              <h3 className="mt-4 text-base font-bold text-slate-800">
                상품을 먼저 선택해 주세요
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                선택하면 총상환액과 상환일을 바로 계산해 드려요.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5">
                <div>
                  <p className="text-xs font-semibold text-slate-500">
                    선택한 상품
                  </p>
                  <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                    {selectedProduct.label}
                  </h3>
                  <p className="mt-2 text-sm font-medium text-slate-500">
                    {selectedProduct.days}일 · 기본{" "}
                    {formatBankMoney(selectedProduct.periodRate || 0)}% ·{" "}
                    <strong className="text-rose-600">
                      내 적용 {formatBankMoney(selectedQuote?.finalRate || 0)}%
                    </strong>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-600">
                      상품 한도{" "}
                      <strong className="text-slate-800">
                        {selectedProduct.maxLoanProductLimit
                          ? formatBankMoney(
                              selectedProduct.maxLoanProductLimit,
                            ) + currencyUnit
                          : "무제한"}
                      </strong>
                    </span>
                    <span
                      className={
                        "rounded-lg px-2.5 py-1.5 font-bold " +
                        (Number(selectedProduct.overdueRate || 0) > 0
                          ? "bg-amber-50 text-amber-800"
                          : "bg-emerald-50 text-emerald-700")
                      }
                    >
                      연체 하루{" "}
                      {formatBankMoney(selectedProduct.overdueRate || 0)}%
                    </span>
                    <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-blue-700">
                      신청 조건{" "}
                      <strong>
                        {getEligibilityLabel(selectedProduct)}
                      </strong>
                    </span>
                  </div>
                </div>
                <span
                  className={
                    "rounded-xl px-3 py-2 text-xs font-bold " +
                    (isEligible(selectedProduct)
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700")
                  }
                >
                  {isEligible(selectedProduct)
                    ? "신청 가능"
                    : getEligibilityLabel(selectedProduct) + " 필요"}
                </span>
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)]">
                <div>
                  <label
                    className="text-sm font-bold text-slate-700"
                    htmlFor="loan-amount"
                  >
                    대출 금액
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="loan-amount"
                      type="number"
                      value={loanAmount}
                      onChange={(event) => setLoanAmount(event.target.value)}
                      placeholder="0"
                      className="h-14 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 pr-16 text-lg font-bold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                      {currencyUnit}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {[100, 500, 1000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => addAmount(amount)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        +{formatBankMoney(amount)}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={!Number.isFinite(availableLoanLimit)}
                      onClick={() =>
                        Number.isFinite(availableLoanLimit) &&
                        setLoanAmount(String(Math.floor(availableLoanLimit)))
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      최대
                    </button>
                  </div>
                  <p className="mt-3 text-xs font-medium text-slate-500">
                    남은 한도{" "}
                    {Number.isFinite(availableLoanLimit)
                      ? formatBankMoney(availableLoanLimit) + " " + currencyUnit
                      : "상품별 한도 적용"}
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <p className="text-lg font-bold leading-8 text-slate-900">
                    <strong className="text-blue-600">
                      {formatBankMoney(enteredAmount)}
                      {currencyUnit}
                    </strong>
                    를 빌리면
                    <br />
                    {selectedProduct.days}일 뒤{" "}
                    <strong className="text-rose-600">
                      {formatBankMoney(totalRepayment)}
                      {currencyUnit}
                    </strong>
                    를 갚아요.
                  </p>
                  <dl className="mt-5 divide-y divide-slate-100 rounded-xl bg-slate-50 px-4">
                    <div className="flex items-center justify-between py-3">
                      <dt className="text-xs font-semibold text-slate-500">
                        예상 이자
                      </dt>
                      <dd className="text-sm font-bold text-rose-600">
                        {formatBankMoney(
                          selectedQuote?.totalEstimatedInterest || 0,
                        )}{" "}
                        {currencyUnit}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <dt className="text-xs font-semibold text-slate-500">
                        상환일
                      </dt>
                      <dd className="text-sm font-bold text-slate-800">
                        {repaymentDate?.toLocaleDateString("ko-KR")}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <dt className="text-xs font-semibold text-slate-500">
                        하루 연체 벌금
                      </dt>
                      <dd className="text-sm font-bold text-amber-700">
                        {formatBankMoney(selectedProduct.overdueRate || 0)}%
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-5">
                <Button
                  type="button"
                  onClick={handleApplyProcess}
                  disabled={!canApply}
                  tone="blue"
                  size="lg"
                  rounded="lg"
                  className="w-full"
                >
                  {isSubmitting ? "처리 중..." : "대출 신청하기"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default BankLoanTab;
