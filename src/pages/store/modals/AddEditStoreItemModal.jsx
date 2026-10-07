import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import {
  ArchiveBoxIcon,
  BanknotesIcon,
  ClockIcon,
  CurrencyDollarIcon,
  FolderIcon,
  GiftIcon,
  PencilSquareIcon,
  ReceiptPercentIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SparklesIcon,
  TagIcon,
} from "@heroicons/react/24/outline";

import { Button, Modal, ToggleSwitch } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { resolveClassCurrencyUnit } from "../../../utils/currencyUnit";
import {
  getStoreCurrencyUnit,
  MISSION_TOKEN_UNIT,
  normalizeStoreCurrencyType,
} from "../utils/storeCurrency";
import {
  normalizeStoreItemSaleStatus,
  STORE_ITEM_SALE_STATUS,
  STORE_ITEM_SALE_STATUS_OPTIONS,
} from "../utils/storeSaleStatus";
import {
  formatPriceWeeks,
  getBaselineWeeklySalary,
  getStorePriceBand,
} from "../utils/storePriceGuidance";
import {
  buildNewStoreItemWriteData,
  buildStoreItemWriteData,
} from "../utils/storeItemPayload";
import {
  combineKstDateAndTime,
  splitKstDateTime,
} from "../utils/timeSale";
import { isVipLoungeCategory } from "../utils/vipLounge";
import {
  getStoreItemAsset,
  isStoreItemIconHidden,
  STORE_ITEM_ICON_OPTIONS,
} from "../utils/storeItemVisuals";

const INITIAL_FORM_DATA = {
  name: "",
  description: "",
  itemIcon: "auto",
  price: "",
  stock: "",
  saleStatus: STORE_ITEM_SALE_STATUS.FOR_SALE,
  categoryId: "",
  taxType: "inherit",
  customTaxRate: "",
  itemType: "general",
  currencyType: "cash",
  validityHours: "",
  dailyLimit: "",
  weeklyLimit: "",
  totalLimit: "",
  minCreditTierId: "",
  timeSalePrice: "",
  timeSaleStartDate: "",
  timeSaleStartTime: "",
  timeSaleEndDate: "",
  timeSaleEndTime: "",
  isGiftAllowed: true,
};

const VALIDITY_PRESET_OPTIONS = [
  { label: "1일", hours: 24 },
  { label: "3일", hours: 72 },
  { label: "1주일", hours: 168 },
];

const AddEditStoreItemModal = ({
  isOpen,
  onClose,
  selectedCategoryId,
  categories = [],
  itemToEdit = null,
  economyBaseline = {},
}) => {
  const { classId, classData, userData, missionTokenLabel } = useUser();
  const { showFeedback } = useFeedback();
  const { formatClassCurrency } = useNumberFormat();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tierOptions, setTierOptions] = useState([]);
  const [isTimeSaleEnabled, setIsTimeSaleEnabled] = useState(false);
  const [formData, setFormData] = useState({
    ...INITIAL_FORM_DATA,
    categoryId: selectedCategoryId || "",
  });

  const defaultTaxRate =
    classData?.taxRate ?? classData?.settings?.taxRate ?? 10;
  const currencyUnit = resolveClassCurrencyUnit(classData);
  const isEditing = Boolean(itemToEdit);
  const selectedCurrencyUnit = getStoreCurrencyUnit(
    formData.currencyType,
    currencyUnit,
    missionTokenLabel,
  );
  const selectedItemAsset = getStoreItemAsset({
    itemIcon: formData.itemIcon,
    itemType: formData.itemType,
  });
  const isItemIconHidden = isStoreItemIconHidden({
    itemIcon: formData.itemIcon,
  });
  const baselineWeeklySalary = getBaselineWeeklySalary(economyBaseline);
  const priceGuidance = useMemo(
    () =>
      normalizeStoreCurrencyType(formData.currencyType) === "cash"
        ? getStorePriceBand(formData.price, economyBaseline)
        : null,
    [economyBaseline, formData.currencyType, formData.price],
  );
  const pricePresetOptions = useMemo(() => {
    if (!baselineWeeklySalary) return [];

    return [
      { label: "1주", value: Math.round(baselineWeeklySalary) },
      { label: "2주", value: Math.round(baselineWeeklySalary * 2) },
      { label: "4주", value: Math.round(baselineWeeklySalary * 4) },
    ];
  }, [baselineWeeklySalary]);
  const parsedPrice = Number(formData.price);
  const parsedTimeSalePrice = Number(formData.timeSalePrice);
  const normalizedTimeSalePrice = Number.isFinite(parsedTimeSalePrice)
    ? Math.round(parsedTimeSalePrice)
    : null;
  const timeSaleDiscountPreview =
    Number.isFinite(parsedPrice) &&
    normalizedTimeSalePrice !== null &&
    normalizedTimeSalePrice > 0 &&
    normalizedTimeSalePrice < parsedPrice
      ? Math.max(
          0,
          Math.floor(
            ((parsedPrice - normalizedTimeSalePrice) / parsedPrice) * 100,
          ),
        )
      : null;
  const hadExistingPurchaseLimits =
    Number(itemToEdit?.dailyLimit || 0) > 0 ||
    Number(itemToEdit?.weeklyLimit || 0) > 0 ||
    Number(itemToEdit?.totalLimit || 0) > 0;
  const willDisablePurchaseLimits =
    Number(formData.dailyLimit || 0) <= 0 &&
    Number(formData.weeklyLimit || 0) <= 0 &&
    Number(formData.totalLimit || 0) <= 0;
  const willResetPurchaseUsage =
    isEditing && hadExistingPurchaseLimits && willDisablePurchaseLimits;

  useEffect(() => {
    if (!classId || !isOpen) return;
    let isCancelled = false;

    const fetchTierOptions = async () => {
      try {
        const tierRef = doc(db, "classes", classId, "tierCriteria", "default");
        const tierSnap = await getDoc(tierRef);
        const tiers = Array.isArray(tierSnap.data()?.tiers)
          ? [...tierSnap.data().tiers]
          : [];

        tiers.sort((a, b) => Number(b?.minScore ?? 0) - Number(a?.minScore ?? 0));

        if (!isCancelled) {
          setTierOptions(tiers);
        }
      } catch (error) {
        console.error("Tier options load error:", error);
        if (!isCancelled) {
          setTierOptions([]);
        }
      }
    };

    fetchTierOptions();

    return () => {
      isCancelled = true;
    };
  }, [classId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (itemToEdit) {
      const timeSaleStart = splitKstDateTime(itemToEdit.timeSale?.startAt);
      const timeSaleEnd = splitKstDateTime(itemToEdit.timeSale?.endAt);
      setIsTimeSaleEnabled(Boolean(itemToEdit.timeSale));

      setFormData({
        name: itemToEdit.name || "",
        description: itemToEdit.description || "",
        itemIcon: itemToEdit.itemIcon || "auto",
        price: itemToEdit.price || "",
        stock: itemToEdit.stock === -1 ? "" : itemToEdit.stock ?? "",
        saleStatus: normalizeStoreItemSaleStatus(itemToEdit),
        categoryId: itemToEdit.categoryId || selectedCategoryId || "",
        taxType: itemToEdit.customTaxRate !== undefined ? "custom" : "inherit",
        customTaxRate: itemToEdit.customTaxRate ?? "",
        itemType: itemToEdit.itemType || "general",
        currencyType: normalizeStoreCurrencyType(itemToEdit.currencyType),
        validityHours: itemToEdit.validityHours || "",
        dailyLimit: itemToEdit.dailyLimit || "",
        weeklyLimit: itemToEdit.weeklyLimit || "",
        totalLimit: itemToEdit.totalLimit || "",
        minCreditTierId: itemToEdit.minCreditTierId || "",
        timeSalePrice: itemToEdit.timeSale?.salePrice ?? "",
        timeSaleStartDate: timeSaleStart.date,
        timeSaleStartTime: timeSaleStart.time,
        timeSaleEndDate: timeSaleEnd.date,
        timeSaleEndTime: timeSaleEnd.time,
        isGiftAllowed: itemToEdit.isGiftAllowed !== false,
      });
      return;
    }

    setIsTimeSaleEnabled(false);
    setFormData({
      ...INITIAL_FORM_DATA,
      categoryId: selectedCategoryId || "",
    });
  }, [isOpen, itemToEdit, selectedCategoryId]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (!classId) return;

    if (!formData.name.trim()) {
      showFeedback("상품명을 입력해 주세요.", "error");
      return;
    }

    if (!formData.price || Number(formData.price) <= 0) {
      showFeedback("올바른 판매 가격을 입력해 주세요.", "error");
      return;
    }

    if (!formData.categoryId) {
      showFeedback("카테고리를 선택해 주세요.", "error");
      return;
    }

    if (
      formData.validityHours !== "" &&
      (!Number.isFinite(Number(formData.validityHours)) ||
        Number(formData.validityHours) <= 0)
    ) {
      showFeedback("사용기한은 1시간 이상으로 입력해주세요.", "error");
      return;
    }

    const hasAnyTimeSaleInput =
      isTimeSaleEnabled &&
      [
        formData.timeSalePrice,
        formData.timeSaleStartDate,
        formData.timeSaleStartTime,
        formData.timeSaleEndDate,
        formData.timeSaleEndTime,
      ].some((value) => String(value ?? "").trim() !== "");

    let timeSalePayload = null;
    if (hasAnyTimeSaleInput) {
      const isTimeSaleComplete = [
        formData.timeSalePrice,
        formData.timeSaleStartDate,
        formData.timeSaleStartTime,
        formData.timeSaleEndDate,
        formData.timeSaleEndTime,
      ].every((value) => String(value ?? "").trim() !== "");

      if (!isTimeSaleComplete) {
        showFeedback("타임세일을 설정하려면 세일가와 시작/종료 일시를 모두 입력해주세요.", "error");
        return;
      }

      const rawSalePrice = Number(formData.timeSalePrice);
      const salePrice = Number.isFinite(rawSalePrice)
        ? Math.round(rawSalePrice)
        : NaN;
      const basePrice = Number(formData.price);
      if (!Number.isFinite(rawSalePrice) || salePrice <= 0) {
        showFeedback("타임세일 세일가는 0보다 커야 합니다.", "error");
        return;
      }

      if (salePrice >= basePrice) {
        showFeedback("세일가는 판매 가격보다 낮아야 합니다.", "error");
        return;
      }

      const startAt = combineKstDateAndTime(
        formData.timeSaleStartDate,
        formData.timeSaleStartTime,
      );
      const endAt = combineKstDateAndTime(
        formData.timeSaleEndDate,
        formData.timeSaleEndTime,
      );

      if (!startAt || !endAt) {
        showFeedback("타임세일 시작/종료 일시 형식이 올바르지 않습니다.", "error");
        return;
      }

      if (startAt.getTime() >= endAt.getTime()) {
        showFeedback("타임세일 종료 시각은 시작 시각보다 늦어야 합니다.", "error");
        return;
      }

      timeSalePayload = {
        salePrice,
        startAt: Timestamp.fromDate(startAt),
        endAt: Timestamp.fromDate(endAt),
      };
    }

    if (
      willResetPurchaseUsage &&
      typeof window !== "undefined" &&
      !(await appConfirm("구매 제한을 모두 해제하면 기존 사용량이 0으로 초기화됩니다. 이후 다시 제한을 설정해도 이전 사용량은 반영되지 않습니다. 계속할까요?", {"title":"초기화 확인","confirmLabel":"초기화하기","tone":"rose"}))
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      const payloadOptions = {
        formData,
        timeSalePayload,
        tierOptions,
        itemToEdit,
        isEditing,
        teacherUid: userData?.uid,
      };

      if (isEditing) {
        await updateDoc(
          doc(db, "classes", classId, "storeItems", itemToEdit.id),
          buildStoreItemWriteData(payloadOptions),
        );
      } else {
        await addDoc(
          collection(db, "classes", classId, "storeItems"),
          buildNewStoreItemWriteData(payloadOptions),
        );
      }

      showFeedback("상품 정보가 저장되었습니다.", "success");
      onClose?.();
    } catch (error) {
      console.error("Save error:", error);
      showFeedback("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div
            className={`rounded-xl p-2.5 text-white shadow-lg ${
              isEditing ? "bg-blue-600" : "bg-indigo-600"
            }`}
          >
            {isEditing ? (
              <PencilSquareIcon className="h-5 w-5" />
            ) : (
              <ShoppingBagIcon className="h-5 w-5" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {isEditing ? "상품 수정" : "상품 등록"}
            </h2>
            <p className="text-xs font-medium text-slate-500">
              학생이 구매할 상품 정보를 설정합니다.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <form
          onSubmit={handleSubmit}
          id="store-item-form"
          data-tour="store-item-form"
          className="space-y-6"
        >
          <div className="space-y-4">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <TagIcon className="h-4 w-4 text-slate-400" />
                상품명
              </label>
              <div className="flex items-stretch gap-2">
                <div
                  className="relative flex w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-blue-600 transition-colors hover:border-blue-200 hover:bg-blue-50"
                  title={"\uB300\uD45C \uADF8\uB9BC \uC120\uD0DD"}
                >
                  {isItemIconHidden ? (
                    <span className="text-[11px] font-black text-slate-500">
                      없음
                    </span>
                  ) : (
                    <img
                      src={selectedItemAsset}
                      alt=""
                      className="h-9 w-9 object-contain"
                      aria-hidden="true"
                    />
                  )}
                  <span className="absolute bottom-0.5 right-1 text-[8px] text-slate-400">
                    ▼
                  </span>
                  <select
                    value={formData.itemIcon}
                    onChange={(event) =>
                      handleInputChange("itemIcon", event.target.value)
                    }
                    aria-label={"\uB300\uD45C \uADF8\uB9BC \uC120\uD0DD"}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    {STORE_ITEM_ICON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  data-tour="store-item-name-input"
                  value={formData.name}
                  onChange={(event) =>
                    handleInputChange("name", event.target.value)
                  }
                  className="min-w-0 flex-1 rounded-xl border border-blue-200 px-4 py-2.5 font-medium outline-none transition-all focus:ring-2 focus:ring-blue-100"
                  placeholder={"\uC0C1\uD488 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694"}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <PencilSquareIcon className="h-4 w-4 text-slate-400" />
                상품 설명
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange("description", e.target.value)}
                className="w-full resize-none rounded-xl border border-blue-200 px-4 py-2.5 font-medium outline-none transition-all focus:ring-2 focus:ring-blue-100"
                placeholder="상품 설명을 입력하세요"
                rows="2"
              />
            </div>

            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <FolderIcon className="h-4 w-4 text-slate-400" />
                카테고리 선택
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => {
                  const isVipCategory = isVipLoungeCategory(category);
                  const isSelected = formData.categoryId === category.id;

                  return (
                    <Button
                      key={category.id}
                      type="button"
                      onClick={() => handleInputChange("categoryId", category.id)}
                      tone={isVipCategory ? "amber" : "blue"}
                      kind={isSelected ? "solid" : "outline"}
                      size="xs"
                      rounded="xl"
                      className={`rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
                        isSelected
                          ? isVipCategory
                            ? "border-amber-300 bg-slate-950 text-amber-100 shadow-md"
                            : "border-blue-600 bg-blue-600 text-white shadow-md"
                          : isVipCategory
                            ? "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {isVipCategory ? "VIP · " : ""}
                      {category.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <SparklesIcon className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-black uppercase tracking-tighter text-blue-800">
                아이템 유형
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => handleInputChange("itemType", "general")}
                tone="blue"
                kind={formData.itemType === "general" ? "soft" : "ghost"}
                size="xs"
                rounded="xl"
                className={`rounded-xl border py-3 text-xs font-bold transition-all ${
                  formData.itemType === "general"
                    ? "border-blue-200 bg-white text-blue-600 shadow-sm"
                    : "border-transparent bg-transparent text-slate-400"
                }`}
              >
                일반 아이템
              </Button>
              <Button
                type="button"
                onClick={() => handleInputChange("itemType", "ticket")}
                tone="blue"
                kind={formData.itemType === "ticket" ? "soft" : "ghost"}
                size="xs"
                rounded="xl"
                className={`rounded-xl border py-3 text-xs font-bold transition-all ${
                  formData.itemType === "ticket"
                    ? "border-blue-200 bg-white text-blue-600 shadow-sm"
                    : "border-transparent bg-transparent text-slate-400"
                }`}
              >
                오락실 티켓
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <BanknotesIcon className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-black uppercase tracking-tighter text-amber-800">
                결제 화폐
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                onClick={() => handleInputChange("currencyType", "cash")}
                tone="amber"
                kind={formData.currencyType === "cash" ? "soft" : "ghost"}
                size="xs"
                rounded="xl"
                className={`min-w-0 whitespace-normal rounded-xl border px-2 py-3 text-xs font-bold transition-all ${
                  formData.currencyType === "cash"
                    ? "border-amber-200 bg-white text-amber-700 shadow-sm"
                    : "border-transparent bg-transparent text-slate-400"
                }`}
              >
                기본 화폐 ({currencyUnit})
              </Button>
              <Button
                type="button"
                onClick={() => handleInputChange("currencyType", "missionToken")}
                tone="amber"
                kind={formData.currencyType === "missionToken" ? "soft" : "ghost"}
                size="xs"
                rounded="xl"
                className={`min-w-0 whitespace-normal rounded-xl border px-2 py-3 text-xs font-bold transition-all ${
                  formData.currencyType === "missionToken"
                    ? "border-amber-200 bg-white text-amber-700 shadow-sm"
                    : "border-transparent bg-transparent text-slate-400"
                }`}
              >
                {missionTokenLabel || MISSION_TOKEN_UNIT}
              </Button>
              <Button
                type="button"
                onClick={() => handleInputChange("currencyType", "usdBalance")}
                tone="amber"
                kind={formData.currencyType === "usdBalance" ? "soft" : "ghost"}
                size="xs"
                rounded="xl"
                className={`min-w-0 whitespace-normal rounded-xl border px-2 py-3 text-xs font-bold transition-all ${
                  formData.currencyType === "usdBalance"
                    ? "border-amber-200 bg-white text-amber-700 shadow-sm"
                    : "border-transparent bg-transparent text-slate-400"
                }`}
              >
                외화 (FIN)
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <ReceiptPercentIcon className="h-5 w-5 text-emerald-600" />
              <span className="text-sm font-black uppercase tracking-tighter text-emerald-800">
                세금 설정
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => handleInputChange("taxType", "inherit")}
                tone="blue"
                kind={formData.taxType === "inherit" ? "soft" : "ghost"}
                size="xs"
                rounded="xl"
                className={`rounded-xl border py-3 text-xs font-bold transition-all ${
                  formData.taxType === "inherit"
                    ? "border-emerald-200 bg-white text-emerald-600 shadow-sm"
                    : "border-transparent bg-transparent text-slate-400"
                }`}
              >
                기본 세율 적용 ({defaultTaxRate}%)
              </Button>
              <Button
                type="button"
                onClick={() => handleInputChange("taxType", "custom")}
                tone="emerald"
                kind={formData.taxType === "custom" ? "soft" : "ghost"}
                size="xs"
                rounded="xl"
                className={`rounded-xl border py-3 text-xs font-bold transition-all ${
                  formData.taxType === "custom"
                    ? "border-emerald-200 bg-white text-emerald-600 shadow-sm"
                    : "border-transparent bg-transparent text-slate-400"
                }`}
              >
                개별 세율 설정
              </Button>
            </div>
            {formData.taxType === "custom" ? (
              <div className="relative animate-in slide-in-from-top-1">
                <input
                  type="number"
                  value={formData.customTaxRate}
                  onChange={(e) =>
                    handleInputChange("customTaxRate", e.target.value)
                  }
                  className="w-full rounded-xl border border-emerald-200 bg-blue-50/50 px-4 py-2.5 font-bold text-emerald-700 outline-none"
                  placeholder="세율 입력 (0 입력 시 면세)"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-emerald-400">
                  %
                </span>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <CurrencyDollarIcon className="h-4 w-4 text-slate-400" />
                판매 가격
              </label>
              <div className="relative">
                <input
                  type="number"
                  data-tour="store-item-price-input"
                  value={formData.price}
                  onChange={(e) => handleInputChange("price", e.target.value)}
                  className="w-full rounded-xl border border-blue-200 px-4 py-2.5 font-bold outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  {selectedCurrencyUnit}
                </span>
              </div>
              {normalizeStoreCurrencyType(formData.currencyType) === "cash" &&
              baselineWeeklySalary ? (
                <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-amber-800">
                    <span>
                      기준 주급 {formatClassCurrency(baselineWeeklySalary)}{" "}
                      {currencyUnit}
                    </span>
                    {priceGuidance?.weeks ? (
                      <>
                        <span className="text-amber-300">·</span>
                        <span>
                          현재 {formatPriceWeeks(priceGuidance.weeks)}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${priceGuidance.toneClassName}`}
                        >
                          {priceGuidance.label}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pricePresetOptions.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          handleInputChange("price", String(preset.value))
                        }
                        className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-black text-amber-700 transition hover:border-amber-300 hover:bg-amber-100"
                      >
                        {preset.label} {formatClassCurrency(preset.value)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                <ArchiveBoxIcon className="h-4 w-4 text-slate-400" />
                초기 재고
              </label>
              <input
                type="number"
                value={formData.stock}
                onChange={(e) => handleInputChange("stock", e.target.value)}
                className="w-full rounded-xl border border-blue-200 px-4 py-2.5 font-bold outline-none"
                placeholder="미입력 시 무제한"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-2">
                <ClockIcon className="h-5 w-5 text-sky-600" />
                <span className="text-sm font-black uppercase tracking-tighter text-sky-800">
                  사용기한 설정
                </span>
              </div>
              <div className="text-[10px] font-medium text-slate-500 sm:text-right">
                <p>사용기한이 끝나면 가방에서 아이템이 사라집니다.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {VALIDITY_PRESET_OPTIONS.map((preset) => {
                const isActive = Number(formData.validityHours) === preset.hours;

                return (
                  <Button
                    key={preset.hours}
                    type="button"
                    onClick={() =>
                      handleInputChange("validityHours", String(preset.hours))
                    }
                    tone="blue"
                    kind={isActive ? "solid" : "outline"}
                    size="xs"
                    rounded="full"
                    className={`rounded-full border px-3 py-2 text-[11px] font-black transition-colors ${
                      isActive
                        ? "border-sky-500 bg-sky-500 text-white"
                        : "border-sky-200 bg-white text-sky-700 hover:border-sky-300 hover:bg-sky-50"
                    }`}
                  >
                    {preset.label}
                  </Button>
                );
              })}
              <Button
                type="button"
                onClick={() => handleInputChange("validityHours", "")}
                tone="slate"
                kind={formData.validityHours === "" ? "solid" : "outline"}
                size="xs"
                rounded="full"
                className={`rounded-full border px-3 py-2 text-[11px] font-black transition-colors ${
                  formData.validityHours === ""
                    ? "border-slate-500 bg-slate-500 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                제한 없음
              </Button>

              <div className="relative min-w-[140px] flex-1 sm:ml-auto sm:max-w-[180px]">
                <input
                  type="number"
                  value={formData.validityHours}
                  onChange={(e) =>
                    handleInputChange("validityHours", e.target.value)
                  }
                  className="w-full rounded-xl border border-sky-200 bg-blue-50/50 px-4 py-2.5 font-bold text-sky-700 outline-none transition-all focus:ring-2 focus:ring-sky-100"
                  placeholder="직접 입력"
                  min={1}
                  aria-label="사용기한 시간 입력"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-sky-300">
                  시간
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <ClockIcon className="h-5 w-5 text-slate-500" />
              <span className="text-sm font-bold text-slate-700">
                1인당 구매 제한 (선택)
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-slate-400">
                  일일 한도
                </label>
                <input
                  type="number"
                  value={formData.dailyLimit}
                  onChange={(e) => handleInputChange("dailyLimit", e.target.value)}
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none"
                  placeholder="무제한"
                />
              </div>
              <div>
                <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-slate-400">
                  주간 한도
                </label>
                <input
                  type="number"
                  value={formData.weeklyLimit}
                  onChange={(e) => handleInputChange("weeklyLimit", e.target.value)}
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none"
                  placeholder="무제한"
                />
              </div>
              <div>
                <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-slate-400">
                  전체 한도
                </label>
                <input
                  type="number"
                  value={formData.totalLimit}
                  onChange={(e) => handleInputChange("totalLimit", e.target.value)}
                  className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none"
                  placeholder="무제한"
                />
              </div>
            </div>
            <p className="text-[11px] font-semibold text-slate-500">
              제한을 모두 해제하면 이후 구매부터는 사용량을 집계하지 않습니다.
            </p>
            {willResetPurchaseUsage ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-bold text-amber-800">
                  기존 구매 제한 사용량이 0으로 초기화됩니다.
                </p>
                <p className="mt-1 text-[11px] font-semibold text-amber-700">
                  다시 제한을 설정해도 이전 사용량은 반영되지 않고, 새 제한 설정 이후 구매부터 계산됩니다.
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <ShieldCheckIcon className="h-5 w-5 text-violet-600" />
              <span className="text-sm font-black uppercase tracking-tighter text-violet-800">
                신용등급 제한 (선택)
              </span>
            </div>
            <select
              value={formData.minCreditTierId}
              onChange={(e) => handleInputChange("minCreditTierId", e.target.value)}
              className="w-full rounded-xl border border-violet-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none"
            >
              <option value="">제한 없음</option>
              {tierOptions.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name} ({Number(tier.minScore || 0)}점)
                </option>
              ))}
            </select>
            <p className="text-[11px] font-semibold text-violet-600">
              선택한 등급 이상 학생만 구매할 수 있습니다.
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 via-amber-50 to-white p-4">
            <div className="mb-1 flex items-center gap-2">
              <SparklesIcon className="h-5 w-5 text-rose-500" />
              <span className="text-sm font-black uppercase tracking-tighter text-rose-700">
                타임세일
              </span>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-rose-100 bg-white/80 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-slate-700">타임세일 사용</p>
                <p className="text-[11px] font-medium text-slate-500">
                  체크하면 세일가와 진행 기간 입력란이 열립니다.
                </p>
              </div>
              <ToggleSwitch
                checked={isTimeSaleEnabled}
                onChange={setIsTimeSaleEnabled}
                disabled={isSubmitting}
                tone="rose"
                srLabel="타임세일 사용"
              />
            </label>

            {isTimeSaleEnabled ? (
              <>
                <p className="text-[11px] font-medium text-rose-600">
                  세일가를 입력하면 학생 화면에는 할인율이 자동 계산되어 표시됩니다.
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-rose-500">
                      세일가
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={formData.timeSalePrice}
                        onChange={(e) =>
                          handleInputChange("timeSalePrice", e.target.value)
                        }
                        className="w-full rounded-xl border border-rose-200 bg-blue-50/50 px-4 py-2.5 font-bold text-rose-700 outline-none transition-all focus:ring-2 focus:ring-rose-100"
                        placeholder="세일가 입력"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-rose-300">
                        {selectedCurrencyUnit}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-rose-100 bg-white/80 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-rose-500">
                      자동 계산
                    </p>
                    <p
                      className="mt-1 text-sm font-bold text-slate-700"
                      title={
                        timeSaleDiscountPreview !== null
                          ? `${timeSaleDiscountPreview}%`
                          : undefined
                      }
                    >
                      {formData.price && formData.timeSalePrice
                        ? `${Math.max(
                            0,
                            Math.floor(
                              ((Number(formData.price) -
                                Number(formData.timeSalePrice || 0)) /
                                Number(formData.price || 1)) *
                                100,
                            ),
                          )}% 세일`
                        : "세일가 입력 시 자동 계산"}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">
                      원가보다 낮은 세일가만 적용됩니다.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-rose-100 bg-white/80 p-4">
                    <p className="mb-3 text-[10px] font-black uppercase tracking-wide text-rose-500">
                      시작 일시
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        type="date"
                        value={formData.timeSaleStartDate}
                        onChange={(e) =>
                          handleInputChange("timeSaleStartDate", e.target.value)
                        }
                        className="w-full rounded-xl border border-rose-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none"
                      />
                      <input
                        type="time"
                        value={formData.timeSaleStartTime}
                        onChange={(e) =>
                          handleInputChange("timeSaleStartTime", e.target.value)
                        }
                        className="w-full rounded-xl border border-rose-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-rose-100 bg-white/80 p-4">
                    <p className="mb-3 text-[10px] font-black uppercase tracking-wide text-rose-500">
                      종료 일시
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        type="date"
                        value={formData.timeSaleEndDate}
                        onChange={(e) =>
                          handleInputChange("timeSaleEndDate", e.target.value)
                        }
                        className="w-full rounded-xl border border-rose-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none"
                      />
                      <input
                        type="time"
                        value={formData.timeSaleEndTime}
                        onChange={(e) =>
                          handleInputChange("timeSaleEndTime", e.target.value)
                        }
                        className="w-full rounded-xl border border-rose-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-[11px] font-medium text-rose-600">
                사용을 켜면 세일가와 시작/종료 시각을 설정할 수 있습니다.
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-pink-100 bg-pink-50/50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <GiftIcon className="h-5 w-5 text-pink-600" />
              <span className="text-sm font-black uppercase tracking-tighter text-pink-800">
                선물 설정
              </span>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-pink-100 bg-white/80 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-slate-700">학생 간 선물 허용</p>
                <p className="text-[11px] font-medium text-slate-500">
                  끄면 구매 후에도 친구에게 이 상품을 선물할 수 없습니다.
                </p>
              </div>
              <ToggleSwitch
                checked={formData.isGiftAllowed}
                onChange={(checked) => handleInputChange("isGiftAllowed", checked)}
                disabled={isSubmitting}
                tone="pink"
                srLabel="학생 간 선물 허용"
              />
            </label>
          </div>

          <div
            data-tour="store-item-sale-status"
            className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4"
          >
            <div>
              <label className="text-sm font-bold text-slate-700">
                판매 상태
              </label>
              <p className="text-[10px] font-medium text-slate-400">
                학생 노출과 구매 가능 여부를 함께 정할 수 있습니다.
              </p>
            </div>
            <select
              value={formData.saleStatus}
              onChange={(event) =>
                handleInputChange("saleStatus", event.target.value)
              }
              className="min-w-[180px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold text-slate-700 outline-none"
            >
              {STORE_ITEM_SALE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </form>
      </Modal.Body>

      <Modal.Footer>
        <Button
          tone="slate"
          kind="ghost"
          onClick={onClose}
          disabled={isSubmitting}
        >
          취소
        </Button>
        <Button size="md"
          tone="blue"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          data-tour="store-item-submit"
          
        >
          {isEditing ? "변경 저장" : "등록"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AddEditStoreItemModal;
