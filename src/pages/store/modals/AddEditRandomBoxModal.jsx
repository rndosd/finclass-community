import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import {
  ArchiveBoxIcon,
  BanknotesIcon,
  ChartBarIcon,
  FolderIcon,
  GiftIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { Button, IconButton, Modal, ToggleSwitch , Tabs} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { resolveClassCurrencyUnit } from "../../../utils/currencyUnit";
import {
  MISSION_TOKEN_UNIT,
  getStoreCurrencyUnit,
  normalizeStoreCurrencyType,
} from "../utils/storeCurrency";
import {
  normalizeStoreItemSaleStatus,
  STORE_ITEM_SALE_STATUS,
  STORE_ITEM_SALE_STATUS_OPTIONS,
} from "../utils/storeSaleStatus";
import { isRandomBoxItem } from "../utils/randomBox";
import {
  buildNewRandomBoxItemWriteData,
  buildRandomBoxItemWriteData,
} from "../utils/storeItemPayload";

const INITIAL_FORM = {
  name: "",
  description: "",
  price: "",
  saleStatus: STORE_ITEM_SALE_STATUS.FOR_SALE,
  categoryId: "",
  boxType: "normal",
  currencyType: "cash",
  dailyLimit: "",
  weeklyLimit: "",
  totalLimit: "",
  minCreditTierId: "",
  isGiftAllowed: true,
};

const TONE_STYLES = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

const PROB_TOLERANCE = 0.1;
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const intOr = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};
const makeRewardRow = (overrides = {}) => ({
  rowId: `reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  itemId: "",
  itemNameSnapshot: "",
  probabilityPercent: "",
  quantity: "1",
  ...overrides,
});
const percent = (value) => `${round2(value).toFixed(2)}%`;

const getRewardProbability = (reward, totalWeight) => {
  const rawProbability = Number(reward?.probabilityPercent ?? reward?.chance);
  if (Number.isFinite(rawProbability) && rawProbability > 0) return round2(rawProbability);
  const weight = Number(reward?.weight || 0);
  return totalWeight > 0 && weight > 0 ? round2((weight / totalWeight) * 100) : 0;
};

const buildRewardRows = (itemToEdit) => {
  const rewards = Array.isArray(itemToEdit?.randomBoxConfig?.rewards)
    ? itemToEdit.randomBoxConfig.rewards
    : [];
  if (!rewards.length) return [makeRewardRow()];
  const totalWeight = rewards.reduce((sum, reward) => sum + Math.max(0, Number(reward?.weight || 0)), 0);
  return rewards.map((reward) =>
    makeRewardRow({
      itemId: String(reward?.itemId || "").trim(),
      itemNameSnapshot: String(reward?.itemName || "").trim(),
      probabilityPercent: String(getRewardProbability(reward, totalWeight) || ""),
      quantity: String(intOr(reward?.quantity, 1) || 1),
    }),
  );
};

const getRecommendation = ({ boxPrice, averageRewardValue }) => {
  const price = Math.max(0, Number(boxPrice || 0));
  const avg = Math.max(0, Number(averageRewardValue || 0));
  if (price <= 0) {
    return {
      tone: "slate",
      label: "가격 확인 필요",
      description: "판매 가격을 입력하면 평균 보상 가치와 운영 감각을 바로 보여드립니다.",
    };
  }
  const ratio = avg / price;
  if (ratio < 0.6) {
    return { tone: "amber", label: "짠 편", description: "희귀 보상 기대감은 크지만 평균 체감은 낮을 수 있습니다." };
  }
  if (ratio < 0.9) {
    return { tone: "sky", label: "보수형", description: "운영 부담은 낮지만 학생 입장에선 손해가 조금 크게 느껴질 수 있습니다." };
  }
  if (ratio <= 1.1) {
    return { tone: "emerald", label: "기본형", description: "판매가와 평균 보상 가치가 비슷해 가장 무난하게 운영하기 좋습니다." };
  }
  if (ratio <= 1.4) {
    return { tone: "violet", label: "후한 편", description: "체감 만족도는 높지만 전체 지급 가치가 빠르게 커질 수 있습니다." };
  }
  return { tone: "rose", label: "매우 후함", description: "평균 보상이 박스 가격보다 많이 높아 빠르게 소진될 가능성이 큽니다." };
};

const AddEditRandomBoxModal = ({
  isOpen,
  onClose,
  selectedCategoryId,
  categories = [],
  allItems = [],
  itemToEdit = null,
}) => {
  const { formatClassCurrency } = useNumberFormat();
  const money = (value, unit) => `${formatClassCurrency(value)} ${unit}`;
  const { classId, classData, userData, missionTokenLabel } = useUser();
  const { showFeedback } = useFeedback();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tierOptions, setTierOptions] = useState([]);
  const [formData, setFormData] = useState({
    ...INITIAL_FORM,
    categoryId: selectedCategoryId || "",
  });
  const [rewardRows, setRewardRows] = useState([makeRewardRow()]);
  const [activeTab, setActiveTab] = useState("product");

  const currencyUnit = resolveClassCurrencyUnit(classData);
  const selectedCurrencyUnit = getStoreCurrencyUnit(
    formData.currencyType,
    currencyUnit,
    missionTokenLabel,
  );
  const isEditing = Boolean(itemToEdit);
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

  const rewardItemMap = useMemo(
    () =>
      new Map(
        (Array.isArray(allItems) ? allItems : [])
          .filter((item) => !isRandomBoxItem(item))
          .map((item) => [item.id, item]),
      ),
    [allItems],
  );

  const categoryNameMap = useMemo(
    () =>
      new Map(
        (Array.isArray(categories) ? categories : []).map((category, index) => [
          category.id,
          {
            name: category?.name || "미분류",
            order: Number.isFinite(Number(category?.order))
              ? Number(category.order)
              : index,
          },
        ]),
      ),
    [categories],
  );

  const rewardCandidates = useMemo(
    () =>
      (Array.isArray(allItems) ? allItems : [])
        .filter((item) => !isRandomBoxItem(item))
        .sort((a, b) => {
          const leftCategory = categoryNameMap.get(a?.categoryId) || null;
          const rightCategory = categoryNameMap.get(b?.categoryId) || null;
          const leftOrder = leftCategory?.order ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = rightCategory?.order ?? Number.MAX_SAFE_INTEGER;

          if (leftOrder !== rightOrder) return leftOrder - rightOrder;

          const categoryCompare = String(leftCategory?.name || "").localeCompare(
            String(rightCategory?.name || ""),
            "ko",
          );
          if (categoryCompare !== 0) return categoryCompare;

          return String(a?.name || "").localeCompare(String(b?.name || ""), "ko");
        }),
    [allItems, categoryNameMap],
  );

  useEffect(() => {
    if (!classId || !isOpen) return;
    let cancelled = false;
    const fetchTiers = async () => {
      try {
        const snap = await getDoc(doc(db, "classes", classId, "tierCriteria", "default"));
        const tiers = Array.isArray(snap.data()?.tiers) ? [...snap.data().tiers] : [];
        tiers.sort((a, b) => Number(b?.minScore ?? 0) - Number(a?.minScore ?? 0));
        if (!cancelled) setTierOptions(tiers);
      } catch (error) {
        console.error("Tier options load error:", error);
        if (!cancelled) setTierOptions([]);
      }
    };
    fetchTiers();
    return () => {
      cancelled = true;
    };
  }, [classId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab("product");
    if (itemToEdit) {
      setFormData({
        name: itemToEdit.name || "",
        description: itemToEdit.description || "",
        price: itemToEdit.price || "",
        saleStatus: normalizeStoreItemSaleStatus(itemToEdit),
        categoryId: itemToEdit.categoryId || selectedCategoryId || "",
        boxType: String(itemToEdit?.randomBoxConfig?.boxType || "normal").trim() === "premium" ? "premium" : "normal",
        currencyType: normalizeStoreCurrencyType(itemToEdit.currencyType),
        dailyLimit: itemToEdit.dailyLimit || "",
        weeklyLimit: itemToEdit.weeklyLimit || "",
        totalLimit: itemToEdit.totalLimit || "",
        minCreditTierId: itemToEdit.minCreditTierId || "",
        isGiftAllowed: itemToEdit.isGiftAllowed !== false,
      });
      setRewardRows(buildRewardRows(itemToEdit));
      return;
    }
    setFormData({ ...INITIAL_FORM, categoryId: selectedCategoryId || "" });
    setRewardRows([makeRewardRow()]);
  }, [isOpen, itemToEdit, selectedCategoryId]);

  const totalProbability = useMemo(
    () => round2(rewardRows.reduce((sum, row) => sum + Math.max(0, Number(row.probabilityPercent || 0)), 0)),
    [rewardRows],
  );

  const analytics = useMemo(() => {
    let averageRewardValue = 0;
    rewardRows.forEach((row) => {
      const item = rewardItemMap.get(row.itemId);
      const quantity = intOr(row.quantity, 0);
      const probabilityValue = Math.max(0, Number(row.probabilityPercent || 0));
      if (!item || quantity <= 0 || probabilityValue <= 0) return;
      const value = Number(item.price || 0) * quantity;
      averageRewardValue += value * (probabilityValue / 100);
    });
    const expectedNet = averageRewardValue - Math.max(0, Number(formData.price || 0));
    return {
      averageRewardValue: round2(averageRewardValue),
      expectedNet: round2(expectedNet),
    };
  }, [formData.price, rewardItemMap, rewardRows]);

  const recommendation = useMemo(
    () => getRecommendation({ boxPrice: formData.price, averageRewardValue: analytics.averageRewardValue }),
    [analytics.averageRewardValue, formData.price],
  );

  const updateForm = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));
  const updateRewardRow = (rowId, field, value) => {
    setRewardRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        if (field === "itemId") {
          const item = rewardItemMap.get(value);
          return { ...row, itemId: value, itemNameSnapshot: item?.name || row.itemNameSnapshot };
        }
        return { ...row, [field]: value };
      }),
    );
  };

  const addRewardRow = () => setRewardRows((prev) => [...prev, makeRewardRow()]);
  const removeRewardRow = (rowId) =>
    setRewardRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.rowId !== rowId)));
  const distributeProbabilities = () => {
    if (!rewardRows.length) return;
    const selectedRows = rewardRows.filter((row) => String(row.itemId || "").trim());
    const targetRows = selectedRows.length ? selectedRows : rewardRows;
    if (!targetRows.length) return;

    const equalShare = round2(100 / targetRows.length);
    let allocated = 0;

    setRewardRows((prev) =>
      prev.map((row) => {
        const isTarget = targetRows.some((targetRow) => targetRow.rowId === row.rowId);
        if (!isTarget) {
          return {
            ...row,
            probabilityPercent: "",
          };
        }

        const targetIndex = targetRows.findIndex((targetRow) => targetRow.rowId === row.rowId);
        const nextValue =
          targetIndex === targetRows.length - 1
            ? round2(Math.max(0, 100 - allocated))
            : equalShare;
        allocated = round2(allocated + nextValue);

        return {
          ...row,
          probabilityPercent: String(nextValue),
        };
      }),
    );

    showFeedback(
      `${targetRows.length}개 보상에 맞춰 확률을 자동분배했습니다.`,
      "success",
    );
  };

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (!classId) return;
    if (!formData.name.trim()) {
      setActiveTab("product");
      showFeedback("랜덤박스 이름을 입력해주세요.", "error");
      return;
    }
    if (!formData.price || Number(formData.price) <= 0) {
      setActiveTab("product");
      showFeedback("올바른 판매 가격을 입력해주세요.", "error");
      return;
    }
    if (!formData.categoryId) {
      setActiveTab("product");
      showFeedback("카테고리를 선택해주세요.", "error");
      return;
    }
    if (!rewardRows.length) {
      setActiveTab("rewards");
      showFeedback("보상 항목을 1개 이상 추가해주세요.", "error");
      return;
    }

    const duplicateIds = new Set();
    for (const row of rewardRows) {
      const itemId = String(row.itemId || "").trim();
      const item = rewardItemMap.get(itemId);
      if (!itemId || !item) {
        setActiveTab("rewards");
      showFeedback("보상 목록에서 지급할 상품을 모두 선택해주세요.", "error");
        return;
      }
      if (isRandomBoxItem(item)) {
        setActiveTab("rewards");
      showFeedback("랜덤박스 안에는 다른 랜덤박스를 넣을 수 없습니다.", "error");
        return;
      }
      if (Number(row.probabilityPercent || 0) <= 0) {
        setActiveTab("rewards");
      showFeedback("모든 보상 확률은 0%보다 커야 합니다.", "error");
        return;
      }
      if (intOr(row.quantity, 0) <= 0) {
        setActiveTab("rewards");
      showFeedback("모든 보상 수량은 1개 이상이어야 합니다.", "error");
        return;
      }
      if (duplicateIds.has(itemId)) {
        setActiveTab("rewards");
      showFeedback("같은 상품을 보상 목록에 중복으로 넣을 수 없습니다.", "error");
        return;
      }
      duplicateIds.add(itemId);
    }

    if (Math.abs(totalProbability - 100) > PROB_TOLERANCE) {
      setActiveTab("rewards");
      showFeedback("보상 확률 합계를 100%로 맞춰주세요.", "error");
      return;
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
        rewardRows,
        rewardItemMap,
        tierOptions,
        itemToEdit,
        isEditing,
        teacherUid: userData?.uid,
      };

      if (isEditing) {
        await updateDoc(
          doc(db, "classes", classId, "storeItems", itemToEdit.id),
          buildRandomBoxItemWriteData(payloadOptions),
        );
      } else {
        await addDoc(
          collection(db, "classes", classId, "storeItems"),
          buildNewRandomBoxItemWriteData(payloadOptions),
        );
      }

      showFeedback("랜덤박스 정보가 저장되었습니다.", "success");
      onClose?.();
    } catch (error) {
      console.error("Random box save error:", error);
      showFeedback("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderRewardOptionLabel = (item) =>
    `${item.name} · ${money(item.price, getStoreCurrencyUnit(item.currencyType, currencyUnit, missionTokenLabel))}`;

  const renderRewardOptionLabelWithCategory = (item) => {
    const categoryName = categoryNameMap.get(item?.categoryId)?.name || "미분류";
    return `[${categoryName}] ${renderRewardOptionLabel(item)}`;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className={`rounded-xl p-2.5 text-white shadow-lg ${isEditing ? "bg-blue-600" : "bg-pink-600"}`}>
            <ArchiveBoxIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">{isEditing ? "랜덤박스 수정" : "랜덤박스 추가"}</h2>
            <p className="text-xs font-medium text-slate-500">기존 상품 추가 모달 흐름에 맞춰 랜덤박스만 별도로 설정합니다.</p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <form onSubmit={handleSubmit} id="random-box-form" className="space-y-6">
          <Tabs
            ariaLabel="랜덤박스 설정"
            idPrefix="random-box-editor"
            tabs={[
              { id: "product", label: "상품 정보" },
              {
                id: "rewards",
                label: (
                  <span className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
                    <span className="whitespace-nowrap">보상 구성</span>
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] ${Math.abs(totalProbability - 100) <= PROB_TOLERANCE ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {rewardRows.length}개 · {percent(totalProbability)}
                    </span>
                  </span>
                ),
              },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            variant="pills"
            size="md"
            fullWidth
            wrapLabels
          />

          {activeTab === "product" ? (
            <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700"><TagIcon className="h-4 w-4 text-slate-400" />랜덤박스 이름</label>
              <input type="text" value={formData.name} onChange={(e) => updateForm("name", e.target.value)} className="w-full rounded-xl border border-blue-200 px-4 py-2.5 font-medium outline-none transition-all focus:ring-2 focus:ring-pink-100" placeholder="예: 봄학기 간식 랜덤박스" />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700"><PencilSquareIcon className="h-4 w-4 text-slate-400" />랜덤박스 설명</label>
              <textarea value={formData.description} onChange={(e) => updateForm("description", e.target.value)} className="w-full resize-none rounded-xl border border-blue-200 px-4 py-2.5 font-medium outline-none transition-all focus:ring-2 focus:ring-pink-100" placeholder="학생에게 보여줄 설명을 입력하세요" rows="2" />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700"><FolderIcon className="h-4 w-4 text-slate-400" />카테고리 선택</label>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <Button key={category.id} type="button" onClick={() => updateForm("categoryId", category.id)} size="xs" tone="rose" kind={formData.categoryId === category.id ? "solid" : "outline"} rounded="xl" className={`px-4 py-2 text-xs font-bold ${formData.categoryId === category.id ? "border-pink-600 bg-pink-600 text-white shadow-md" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                    {category.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <div className="space-y-3 rounded-2xl border border-pink-100 bg-pink-50/60 p-4">
                <div className="mb-1 flex items-center gap-2"><SparklesIcon className="h-5 w-5 text-pink-600" /><span className="text-sm font-black uppercase tracking-tighter text-pink-800">박스 유형</span></div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "normal", label: "일반 랜덤박스" },
                    { value: "premium", label: "프리미엄 박스" },
                  ].map((option) => (
                    <Button key={option.value} type="button" onClick={() => updateForm("boxType", option.value)} size="xs" tone="rose" kind={formData.boxType === option.value ? "soft" : "ghost"} rounded="xl" className={`py-3 text-xs font-bold ${formData.boxType === option.value ? "border-pink-200 bg-white text-pink-700 shadow-sm" : "border-transparent bg-transparent text-slate-400"}`}>
                      {option.label}
                    </Button>
                  ))}
                </div>
                <p className="text-[11px] font-semibold text-pink-700">
                  현재 박스 유형 차이는 개봉 연출과 디자인입니다.
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                <div className="mb-1 flex items-center gap-2"><BanknotesIcon className="h-5 w-5 text-amber-600" /><span className="text-sm font-black uppercase tracking-tighter text-amber-800">결제 화폐</span></div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "cash", label: `기본 화폐 (${currencyUnit})` },
                    {
                      value: "missionToken",
                      label: missionTokenLabel || MISSION_TOKEN_UNIT,
                    },
                    { value: "usdBalance", label: "외화 (FIN)" },
                  ].map((option) => (
                    <Button key={option.value} type="button" onClick={() => updateForm("currencyType", option.value)} size="xs" tone="amber" kind={formData.currencyType === option.value ? "soft" : "ghost"} rounded="xl" className={`min-w-0 whitespace-normal px-2 py-3 text-xs font-bold ${formData.currencyType === option.value ? "border-amber-200 bg-white text-amber-700 shadow-sm" : "border-transparent bg-transparent text-slate-400"}`}>
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700"><BanknotesIcon className="h-4 w-4 text-slate-400" />판매 가격</label>
                <div className="relative">
                  <input type="number" min="1" value={formData.price} onChange={(e) => updateForm("price", e.target.value)} className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-2.5 font-bold outline-none" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{selectedCurrencyUnit}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-1 flex items-center gap-2"><BanknotesIcon className="h-5 w-5 text-slate-500" /><span className="text-sm font-bold text-slate-700">1인당 구매 제한 (선택)</span></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                { field: "dailyLimit", label: "일일 한도" },
                { field: "weeklyLimit", label: "주간 한도" },
                { field: "totalLimit", label: "전체 한도" },
              ].map((limit) => (
                <div key={limit.field}>
                  <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-slate-400">{limit.label}</label>
                  <input type="number" value={formData[limit.field]} onChange={(e) => updateForm(limit.field, e.target.value)} className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold outline-none" placeholder="무제한" />
                </div>
              ))}
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
            <div className="mb-1 flex items-center gap-2"><ShieldCheckIcon className="h-5 w-5 text-violet-600" /><span className="text-sm font-black uppercase tracking-tighter text-violet-800">신용등급 제한 (선택)</span></div>
            <select value={formData.minCreditTierId} onChange={(e) => updateForm("minCreditTierId", e.target.value)} className="w-full rounded-xl border border-violet-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none">
              <option value="">제한 없음</option>
              {tierOptions.map((tier) => (
                <option key={tier.id} value={tier.id}>{tier.name} ({Number(tier.minScore || 0)}점)</option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-pink-100 bg-pink-50/50 p-4">
              <div className="mb-1 flex items-center gap-2"><GiftIcon className="h-5 w-5 text-pink-600" /><span className="text-sm font-black uppercase tracking-tighter text-pink-800">선물 설정</span></div>
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-pink-100 bg-white/80 px-4 py-3">
                <p className="text-sm font-bold text-slate-700">학생 간 선물 허용</p>
                <ToggleSwitch
                  checked={formData.isGiftAllowed}
                  onChange={(checked) => updateForm("isGiftAllowed", checked)}
                  disabled={isSubmitting}
                  tone="pink"
                  srLabel="학생 간 선물 허용"
                />
              </label>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-1 flex items-center gap-2"><ShoppingBagIcon className="h-5 w-5 text-slate-500" /><span className="text-sm font-black uppercase tracking-tighter text-slate-700">판매 상태</span></div>
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-bold text-slate-700">판매 상태</p>
                <select
                  value={formData.saleStatus}
                  onChange={(event) => updateForm("saleStatus", event.target.value)}
                  className="min-w-[180px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold text-slate-700 outline-none"
                >
                  {STORE_ITEM_SALE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
            </div>
          ) : (
            <div className="space-y-6">
          <div className={`flex flex-col gap-4 rounded-2xl border px-5 py-4 ${Math.abs(totalProbability - 100) <= PROB_TOLERANCE ? "border-blue-100 bg-blue-50" : "border-amber-100 bg-amber-50"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={`text-sm font-black ${Math.abs(totalProbability - 100) <= PROB_TOLERANCE ? "text-blue-700" : "text-amber-700"}`}>입력 확률 합계 {percent(totalProbability)}</p>
                <p className="text-[11px] font-bold text-slate-500">가중치 대신 확률로 입력하고, 저장 시 서버용 값으로 함께 변환됩니다.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={distributeProbabilities}
                  size="xs"
                  tone="blue"
                  kind="outline"
                  rounded="lg"
                  
                >
                  자동분배
                </Button>
                <div className="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-slate-600">목표 100%</div>
              </div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/90">
              <div className={`h-full transition-all ${Math.abs(totalProbability - 100) <= PROB_TOLERANCE ? "bg-blue-600" : "bg-amber-500"}`} style={{ width: `${Math.min(Math.max(totalProbability, 0), 100)}%` }} />
            </div>
          </div>
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">보상 목록</p>
                <p className="mt-1 text-xs font-medium text-slate-500">보상은 박스 카테고리와 무관하게 상점의 전체 일반 상품에서 고를 수 있습니다.</p>
              </div>
              <Button type="button" onClick={addRewardRow} size="xs" tone="rose" kind="outline" rounded="lg" className="gap-2">
                <PlusIcon className="h-4 w-4" />보상 추가
              </Button>
            </div>

            {rewardCandidates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">랜덤박스 보상으로 넣을 일반 상품이 아직 없습니다.</div>
            ) : (
              <div className="space-y-3">
                {rewardRows.map((row, index) => {
                  const selectedItem = rewardItemMap.get(row.itemId) || null;
                  const missingItem = Boolean(row.itemId) && !selectedItem;
                  const rowValue = Number(selectedItem?.price || 0) * intOr(row.quantity, 0);
                  return (
                    <div key={row.rowId} className={`rounded-2xl border p-4 ${missingItem ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50/60"}`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">보상 {index + 1}</p>
                        <IconButton type="button" onClick={() => removeRewardRow(row.rowId)} disabled={rewardRows.length <= 1} icon={TrashIcon} label="보상 삭제" tone="red" size="sm" className="rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" />
                      </div>

                      <div className="grid gap-3 md:grid-cols-[minmax(0,1.7fr)_120px_120px]">
                        <div>
                          <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-slate-400">보상 상품</label>
                          <select value={row.itemId} onChange={(e) => updateRewardRow(row.rowId, "itemId", e.target.value)} className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none">
                            <option value="">상품 선택</option>
                            {rewardCandidates.map((item) => (
                              <option key={item.id} value={item.id}>{renderRewardOptionLabelWithCategory(item)}</option>
                            ))}
                            {row.itemId && missingItem ? <option value={row.itemId}>{row.itemNameSnapshot || "알 수 없는 상품"} (삭제됨)</option> : null}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-slate-400">확률</label>
                          <div className="relative">
                            <input type="number" min="0" max="100" step="0.01" value={row.probabilityPercent} onChange={(e) => updateRewardRow(row.rowId, "probabilityPercent", e.target.value)} className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 pr-8 text-right text-sm font-black text-pink-700 outline-none" placeholder="0" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                          </div>
                        </div>
                        <div>
                          <label className="mb-1.5 ml-1 block text-[10px] font-black uppercase text-slate-400">지급 수량</label>
                          <input type="number" min="1" step="1" value={row.quantity} onChange={(e) => updateRewardRow(row.rowId, "quantity", e.target.value)} className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none" placeholder="1" />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/80 px-4 py-3">
                        <div className="text-xs font-semibold text-slate-500">
                          {selectedItem ? <>현재 상점가 기준 보상 가치 <span className="font-black text-slate-800">{money(rowValue, getStoreCurrencyUnit(selectedItem.currencyType, currencyUnit, missionTokenLabel))}</span></> : "보상 상품을 고르면 예상 가치를 바로 보여줍니다."}
                        </div>
                        {selectedItem ? <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600">{percent(row.probabilityPercent || 0)}</div> : null}
                      </div>

                      {missingItem ? <p className="mt-2 text-xs font-semibold text-amber-700">현재 상점에 없는 상품입니다. 다른 상품으로 다시 선택해주세요.</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className={`rounded-2xl border p-5 ${TONE_STYLES[recommendation.tone] || TONE_STYLES.slate}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-white/70 p-3"><ChartBarIcon className="h-6 w-6" /></div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em]">랜덤박스 가치 요약</p>
                  <h4 className="mt-1 text-lg font-black">현재 성향: {recommendation.label}</h4>
                  <p className="mt-1 text-sm font-semibold opacity-90">{recommendation.description}</p>
                </div>
              </div>
              <div className="rounded-full bg-white/70 px-3 py-1 text-xs font-black">박스 유형 {formData.boxType === "premium" ? "프리미엄" : "일반"}</div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {[
                { label: "판매 가격", value: money(formData.price, selectedCurrencyUnit), className: "text-slate-800" },
                { label: "평균 보상 가치", value: money(analytics.averageRewardValue, selectedCurrencyUnit), className: "text-slate-800" },
                { label: "1회 기대 손익", value: `${analytics.expectedNet > 0 ? "+" : ""}${money(analytics.expectedNet, selectedCurrencyUnit)}`, className: analytics.expectedNet >= 0 ? "text-emerald-600" : "text-rose-600" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3">
                  <p className="text-[11px] font-black text-slate-500">{stat.label}</p>
                  <p className={`mt-1 text-xl font-black ${stat.className}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-xs font-semibold text-slate-600">보상 가치는 현재 상점 판매가 기준으로 단순 계산됩니다. 놀이터 설정처럼 평균값을 보며 너무 짜거나 후하지 않은지 바로 판단할 수 있습니다.</p>
          </div>
            </div>
          )}
        </form>
      </Modal.Body>

      <Modal.Footer>
        <Button tone="slate" kind="ghost" onClick={onClose} disabled={isSubmitting}>취소</Button>
        <Button size="md" tone="blue" onClick={handleSubmit} isLoading={isSubmitting} >
          {isEditing ? "수정사항 저장" : "랜덤박스 등록하기"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AddEditRandomBoxModal;
