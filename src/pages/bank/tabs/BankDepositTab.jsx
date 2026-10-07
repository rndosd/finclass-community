import { appAlert } from "../../../utils/appDialogs";
import React, { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  ListBulletIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useUser } from "../../../contexts/UserContext";
import { Button } from "../../../components/ui";
import { db } from "../../../firebase";
import { buildDepositQuote } from "../utils/bankUtils";
import { formatBankMoney } from "../../../utils/bankMoney";
import depositProductAsset from "../../../assets/bank/deposit-product-v1.png";

const OPEN_SAVING_STATUSES = new Set(["pending", "active"]);

function BankDepositTab({
  bankSettings,
  classId,
  depositAmount,
  setDepositAmount,
  selectedDepositProductId,
  setSelectedDepositProductId,
  handleOpenDepositConfirmModal,
  setShowDepositHistoryModal,
  studentInfo,
  currencyUnit: propCurrencyUnit,
  currentRateModifiers,
  studentTierName,
  isSubmitting,
  tierCriteria = [],
  isLoading,
  historyBadgeCount = 0,
  savings = [],
  uid,
}) {
  const { classData } = useUser();
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductSavings, setSelectedProductSavings] = useState([]);
  const [isSelectedProductSavingsReady, setIsSelectedProductSavingsReady] =
    useState(false);

  const currencyUnit = propCurrencyUnit || classData?.currencyUnit || "마로";
  const weeklyBonusBase = Number(
    currentRateModifiers?.depositRateModifier || 0,
  );
  const myScore = Number(studentInfo?.creditScore || 0);
  const myCash = Number(studentInfo?.assets?.cash || 0);

  const getTierLabel = (requiredScore) => {
    if (
      requiredScore === undefined ||
      requiredScore === null ||
      requiredScore === ""
    )
      return "모든 등급";
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

  useEffect(() => {
    if (!classId || !uid || !selectedProduct?.id) {
      setSelectedProductSavings([]);
      setIsSelectedProductSavingsReady(!selectedProduct?.id);
      return undefined;
    }

    setIsSelectedProductSavingsReady(false);

    const selectedProductSavingsRef = query(
      collection(db, `classes/${classId}/students/${uid}/savings`),
      where("productId", "==", String(selectedProduct.id)),
    );

    const unsubscribe = onSnapshot(
      selectedProductSavingsRef,
      (snapshot) => {
        setSelectedProductSavings(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })),
        );
        setIsSelectedProductSavingsReady(true);
      },
      (error) => {
        console.error(
          "[BankDepositTab] selected product savings subscribe error:",
          error,
        );
        setSelectedProductSavings([]);
        setIsSelectedProductSavingsReady(true);
      },
    );

    return () => unsubscribe();
  }, [classId, selectedProduct?.id, uid]);

  const selectedProductSavingsSource = useMemo(() => {
    if (isSelectedProductSavingsReady) return selectedProductSavings;
    return savings;
  }, [isSelectedProductSavingsReady, savings, selectedProductSavings]);

  const currentProductAmount = useMemo(() => {
    if (!selectedProduct) return 0;

    return (selectedProductSavingsSource || []).reduce((total, saving) => {
      if (String(saving?.productId) !== String(selectedProduct.id))
        return total;
      if (!OPEN_SAVING_STATUSES.has(String(saving?.status || ""))) return total;
      return total + Number(saving?.amount || 0);
    }, 0);
  }, [selectedProduct, selectedProductSavingsSource]);

  const isSelectedProductAmountLoading =
    !!selectedProduct?.id && !isSelectedProductSavingsReady;

  const handleApplyProcess = () => {
    const amount = Number(depositAmount);
    const minRequiredScore = selectedProduct?.minCreditScore
      ? Number(selectedProduct.minCreditScore)
      : 0;
    const maxLimit = selectedProduct?.maxDepositProductLimit
      ? Number(selectedProduct.maxDepositProductLimit)
      : Infinity;

    if (amount <= 0) return appAlert("가입할 금액을 입력해주세요.");
    if (amount > myCash)
      return appAlert(
        `잔액이 부족합니다. (현재 보유: ${formatBankMoney(myCash)}${currencyUnit})`,
      );
    if (maxLimit > 0 && isSelectedProductAmountLoading) {
      return appAlert(
        "현재 가입 중 금액을 확인하는 중입니다. 잠시만 기다려주세요.",
      );
    }
    if (isStudentEligibility(selectedProduct) && !isStudentAllowed(selectedProduct))
      return appAlert("이 예금 상품은 지정된 학생만 가입할 수 있습니다.");
    if (!isStudentEligibility(selectedProduct) && myScore < minRequiredScore)
      return appAlert(
        `가입 자격이 부족합니다. (${getTierLabel(minRequiredScore)} 필요)`,
      );
    if (maxLimit > 0 && currentProductAmount + amount > maxLimit)
      return appAlert(
        `이 상품은 현재 가입 중 금액을 포함해 최대 ${formatBankMoney(maxLimit)}${currencyUnit}까지만 가입할 수 있습니다.`,
      );

    handleOpenDepositConfirmModal();
  };

  const activeDepositProducts = useMemo(
    () => bankSettings?.depositProducts?.filter((p) => p.active) || [],
    [bankSettings],
  );

  useEffect(() => {
    const product = activeDepositProducts.find(
      (p) => p.id === selectedDepositProductId,
    );
    setSelectedProduct(product || null);
  }, [selectedDepositProductId, activeDepositProducts]);

  // 로딩 중일 때 null을 리턴하면 버튼이 안 보일 수 있으므로 로딩 처리를 세밀하게 하거나 제거
  if (isLoading && !bankSettings)
    return (
      <div className="p-10 text-center text-slate-400">
        데이터를 불러오는 중...
      </div>
    );

  const enteredAmount = Math.max(0, Number(depositAmount) || 0);
  const selectedQuote = selectedProduct
    ? buildDepositQuote({
        principal: enteredAmount,
        baseRate: Number(selectedProduct.rate || 0),
        weeklyModifier: weeklyBonusBase,
        productDays: selectedProduct.days || 0,
      })
    : null;
  const maturityAmount =
    enteredAmount + Number(selectedQuote?.totalEstimatedInterest || 0);
  const maturityDate = selectedProduct
    ? new Date(Date.now() + Number(selectedProduct.days || 0) * 86400000)
    : null;
  const canApply =
    Boolean(selectedDepositProductId) &&
    enteredAmount > 0 &&
    !isSubmitting &&
    isEligible(selectedProduct) &&
    !isSelectedProductAmountLoading;

  const addAmount = (amount) => {
    setDepositAmount(String(Math.max(0, enteredAmount + amount)));
  };

  return (
    <div className="space-y-4 text-left animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,0.36fr)_minmax(0,0.64fr)]">
        <section
          data-tour="bank-deposit-products"
          className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-900">상품 선택</h3>
              <p className="mt-1 text-xs font-medium text-slate-500">
                기간과 내 적용 이율을 함께 비교하세요.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setShowDepositHistoryModal(true)}
              tone="slate"
              kind="outline"
              rounded="xl"
              className="relative shrink-0 gap-2"
            >
              <ListBulletIcon className="h-4 w-4" />
              예금 내역
              {historyBadgeCount > 0 ? (
                <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {historyBadgeCount > 99 ? "99+" : historyBadgeCount}
                </span>
              ) : null}
            </Button>
          </div>

          <div className="space-y-2.5">
            {activeDepositProducts.map((product) => {
              const eligible = isEligible(product);
              const isSelected =
                String(selectedDepositProductId) === String(product.id);
              const quote = buildDepositQuote({
                principal: 1000,
                baseRate: Number(product.rate || 0),
                weeklyModifier: weeklyBonusBase,
                productDays: product.days || 0,
              });

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={!eligible}
                  onClick={() => setSelectedDepositProductId(product.id)}
                  className={
                    "w-full rounded-2xl border p-4 text-left transition " +
                    (isSelected
                      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-100"
                      : eligible
                        ? "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"
                        : "cursor-not-allowed border-slate-200 bg-slate-50")
                  }
                >
                  <span className="flex items-start gap-3">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-50">
                      <img
                        src={depositProductAsset}
                        alt=""
                        aria-hidden="true"
                        className={
                          "h-12 w-12 object-contain transition " +
                          (!eligible
                            ? "grayscale opacity-35"
                            : isSelected
                              ? "scale-105 opacity-100"
                              : "opacity-85")
                        }
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
                          기본 {formatBankMoney(product.rate || 0)}%
                        </span>
                        <span className="text-slate-300">→</span>
                        <span
                          className={
                            eligible ? "text-emerald-600" : "text-slate-500"
                          }
                        >
                          내 적용 {formatBankMoney(quote.finalRate)}%
                        </span>
                      </span>
                      {product.maxDepositProductLimit ||
                      product.earlyTerminationBlocked === true ? (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {product.maxDepositProductLimit ? (
                            <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                              한도{" "}
                              {formatBankMoney(product.maxDepositProductLimit)}
                              {currencyUnit}
                            </span>
                          ) : null}
                          {product.earlyTerminationBlocked === true ? (
                            <span className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
                              중도해지 불가
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      {!eligible ? (
                        <span className="mt-2 block text-xs font-bold text-rose-600">
                          가입 제한 · {getEligibilityLabel(product)}{" "}
                          필요
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs font-medium leading-5 text-slate-500">
            <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />내 적용
            이율은 현재 신용등급과 상품 기간에 따라 계산됩니다.
          </div>
        </section>

        <section
          data-tour="bank-deposit-form"
          className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"
        >
          {!selectedProduct ? (
            <div className="flex min-h-[430px] flex-col items-center justify-center text-center">
              <img
                src={depositProductAsset}
                alt=""
                aria-hidden="true"
                className="h-20 w-20 object-contain opacity-80"
              />
              <h3 className="mt-4 text-base font-bold text-slate-800">
                상품을 먼저 선택해 주세요
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                선택하면 예상 이자와 만기 금액을 바로 계산해 드려요.
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
                    {formatBankMoney(selectedProduct.rate || 0)}% ·{" "}
                    <strong className="text-emerald-600">
                      내 적용 {formatBankMoney(selectedQuote?.finalRate || 0)}%
                    </strong>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-600">
                      가입 한도{" "}
                      <strong className="text-slate-800">
                        {selectedProduct.maxDepositProductLimit
                          ? formatBankMoney(
                              selectedProduct.maxDepositProductLimit,
                            ) + currencyUnit
                          : "무제한"}
                      </strong>
                    </span>
                    <span
                      className={
                        "rounded-lg px-2.5 py-1.5 font-bold " +
                        (selectedProduct.earlyTerminationBlocked === true
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700")
                      }
                    >
                      중도해지{" "}
                      {selectedProduct.earlyTerminationBlocked === true
                        ? "불가"
                        : "가능"}
                    </span>
                    <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-blue-700">
                      가입 조건{" "}
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
                    ? "가입 가능"
                    : getEligibilityLabel(selectedProduct) + " 필요"}
                </span>
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)]">
                <div>
                  <label
                    className="text-sm font-bold text-slate-700"
                    htmlFor="deposit-amount"
                  >
                    예금 금액
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="deposit-amount"
                      type="number"
                      value={depositAmount}
                      onChange={(event) => setDepositAmount(event.target.value)}
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
                      onClick={() =>
                        setDepositAmount(String(Math.max(0, myCash)))
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      최대
                    </button>
                  </div>
                  <p className="mt-3 text-xs font-medium text-slate-500">
                    사용 가능 현금 {formatBankMoney(myCash)} {currencyUnit}
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <p className="text-lg font-bold leading-8 text-slate-900">
                    <strong className="text-blue-600">
                      {formatBankMoney(enteredAmount)}
                      {currencyUnit}
                    </strong>
                    를 맡기면
                    <br />
                    {selectedProduct.days}일 뒤{" "}
                    <strong className="text-blue-600">
                      {formatBankMoney(maturityAmount)}
                      {currencyUnit}
                    </strong>
                    를 받아요.
                  </p>
                  <dl className="mt-5 divide-y divide-slate-100 rounded-xl bg-slate-50 px-4">
                    <div className="flex items-center justify-between py-3">
                      <dt className="text-xs font-semibold text-slate-500">
                        예상 이자
                      </dt>
                      <dd className="text-sm font-bold text-emerald-600">
                        {formatBankMoney(
                          selectedQuote?.totalEstimatedInterest || 0,
                        )}{" "}
                        {currencyUnit}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <dt className="text-xs font-semibold text-slate-500">
                        만기일
                      </dt>
                      <dd className="text-sm font-bold text-slate-800">
                        {maturityDate?.toLocaleDateString("ko-KR")}
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
                  {isSubmitting ? "처리 중" : "예금 가입하기"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default BankDepositTab;
