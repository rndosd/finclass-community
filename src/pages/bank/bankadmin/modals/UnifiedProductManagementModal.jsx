import { appConfirm } from "../../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../../../../firebase";
import { doc, setDoc } from "firebase/firestore";
import { Modal, Button, Badge, Spinner, Tabs, ToggleSwitch } from "../../../../components/ui";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PlusIcon,
  BanknotesIcon,
  CreditCardIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
import BankProductForm from "./BankProductForm";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useClassStudents } from "../../../../hooks/user/useClassStudents";
import {
  createBankProduct,
  deleteBankProduct,
  normalizeBankProduct,
  reorderBankProducts,
  upsertBankProduct,
} from "../../services/bankProductService";

/* -----------------------------------------------------------
    탭 메타 및 필드 키
----------------------------------------------------------- */
// eslint-disable-next-line no-unused-vars
const TABS_META = {
  deposit: {
    id: "deposit",
    fieldKey: "depositProducts",
    icon: BanknotesIcon,
    label: "예금 상품",
  },
  loan: {
    id: "loan",
    fieldKey: "loanProducts",
    icon: CreditCardIcon,
    label: "대출 상품",
  },
};

function SortableProductItem({
  product,
  isSelected,
  onSelect,
  getTierName,
  disabled = false,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: product.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={() => onSelect(product)}
      className={`rounded-xl border bg-white p-3 shadow-sm transition-all ${
        isSelected
          ? "border-blue-500 ring-2 ring-blue-100"
          : "border-transparent hover:border-slate-300"
      } ${isDragging ? "z-10 border-indigo-300 shadow-lg" : ""}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label="상품 순서 변경"
          className={`mt-0.5 rounded-lg p-1 text-slate-400 transition-colors ${
            disabled
              ? "cursor-not-allowed opacity-40"
              : "cursor-grab hover:text-indigo-600 active:cursor-grabbing"
          }`}
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <Bars3Icon className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start justify-between gap-2">
            <span
              className={`block truncate text-sm font-bold ${
                product.active ? "text-slate-800" : "text-slate-400"
              }`}
            >
              {product.label || "(이름 없음)"}
            </span>
            {!product.active && (
              <Badge tone="slate" variant="status" size="sm">
                비활성
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <span className="whitespace-nowrap">{product.days}일</span>
            <span>•</span>
            <span className="font-semibold text-indigo-600">
              {product.rate ?? product.periodRate}%
            </span>
            <span>•</span>
            <span>
              {product.eligibilityMode === "students" ||
              (product.eligibilityMode === "both" &&
                Array.isArray(product.allowedStudentUids) &&
                product.allowedStudentUids.length > 0)
                ? `지정 학생 ${Array.isArray(product.allowedStudentUids) ? product.allowedStudentUids.length : 0}명`
                : getTierName(product.minCreditScore)}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function UnifiedProductManagementModal({
  isOpen,
  onClose,
  classId,
  initialTab = "deposit",
  currencyUnit = "단위",
  bankSettings,
  tierCriteria = [],
  ...modalProps
}) {
  const { showFeedback } = useFeedback();

  const [activeTab, setActiveTab] = useState(initialTab);
  const [data, setData] = useState({ deposit: [], loan: [] });
  const [tiers, setTiers] = useState([]); // 🚀 등급 기준 상태
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [loanContractEnabled, setLoanContractEnabled] = useState(false);
  const [isSavingLoanContractSetting, setIsSavingLoanContractSetting] = useState(false);
  const { data: students = [] } = useClassStudents(classId, {
    enabled: isOpen && !!classId,
    realtime: true,
  });
  // eslint-disable-next-line no-unused-vars
  const [alert, setAlert] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  // 은행 화면이 이미 구독한 정책과 등급 기준을 재사용합니다.
  useEffect(() => {
    if (!isOpen) return;

    const settings = bankSettings || {};
    setData({
      deposit: Array.isArray(settings.depositProducts)
        ? settings.depositProducts
        : [],
      loan: Array.isArray(settings.loanProducts) ? settings.loanProducts : [],
    });
    setLoanContractEnabled(settings.loanContractEnabled === true);
    setTiers(
      [...tierCriteria].sort(
        (a, b) => (b.minScore || 0) - (a.minScore || 0),
      ),
    );
    setLoading(false);
  }, [bankSettings, isOpen, tierCriteria]);

  const products = useMemo(() => data[activeTab] || [], [data, activeTab]);

  // 2. 선택된 상품에 대한 Draft 관리
  useEffect(() => {
    if (!products.length) {
      setSelectedId(null);
      setDraft(null);
      return;
    }
    const stillExists = selectedId && products.some((p) => p.id === selectedId);
    const target = stillExists
      ? products.find((p) => p.id === selectedId)
      : products[0];
    setSelectedId(target?.id ?? null);
    setDraft((currentDraft) => {
      if (!target) return null;
      if (currentDraft?.id === target.id) return currentDraft;
      const normalizedTarget = normalizeBankProduct(activeTab, target);
      return {
        ...target,
        eligibilityMode: normalizedTarget.eligibilityMode,
        allowedStudentUids: normalizedTarget.allowedStudentUids,
        minCreditScore: normalizedTarget.minCreditScore,
      };
    });
  }, [activeTab, products, selectedId]);

  const isDirty = useMemo(() => {
    const selected = products.find((p) => p.id === selectedId);
    if (!selected || !draft) return false;
    return (
      JSON.stringify(normalizeBankProduct(activeTab, draft)) !==
      JSON.stringify(normalizeBankProduct(activeTab, selected))
    );
  }, [activeTab, draft, products, selectedId]);

  // 3. 헬퍼: 점수를 등급 이름으로 변환
  const getTierName = (score) => {
    if (score === null || score === undefined) return "모든 등급";
    const matched = tiers.find((t) => t.minScore === score);
    return matched ? `${matched.name} 이상` : `${score}점 이상`;
  };

  // 4. 액션 핸들러
  const handleCreate = async () => {
    try {
      const newId = `${activeTab === "deposit" ? "dp" : "lp"}_${Date.now()}`;
      const template =
        activeTab === "deposit"
          ? {
              id: newId,
              label: "새 예금 상품",
              days: 7,
              rate: 1,
              maxDepositProductLimit: null,
              useTierRateAdjustment: true,
              earlyTerminationBlocked: false,
              eligibilityMode: "tier",
              allowedStudentUids: [],
              minCreditScore: null,
              active: true,
            }
          : {
              id: newId,
              label: "새 대출 상품",
              days: 7,
              periodRate: 5,
              overdueRate: 1.0, // 🚀 기본 연체 벌금을 1% 등으로 설정
              maxLoanProductLimit: null,
              useTierRateAdjustment: true,
              eligibilityMode: "tier",
              allowedStudentUids: [],
              minCreditScore: null,
              active: true,
            };

      await createBankProduct(classId, activeTab, template);
      setSelectedId(newId);
      showFeedback("새 상품이 생성되었습니다.", "success");
    } catch (e) {
      showFeedback(`생성 실패: ${e.message}`, "error");
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    if (
      draft.eligibilityMode === "students" &&
      (!Array.isArray(draft.allowedStudentUids) || draft.allowedStudentUids.length === 0)
    ) {
      showFeedback("특정 학생 가입 자격을 선택해 주세요.", "warning");
      return;
    }
    try {
      await upsertBankProduct(classId, activeTab, draft);
      showFeedback("저장되었습니다.", "success");
    } catch (e) {
      showFeedback(`저장 실패: ${e.message}`, "error");
    }
  };

  const handleLoanContractToggle = async (nextValue) => {
    if (!classId || isSavingLoanContractSetting) return;
    setLoanContractEnabled(nextValue);
    setIsSavingLoanContractSetting(true);
    try {
      await setDoc(
        doc(db, "classes", classId, "bank", "settings"),
        { loanContractEnabled: nextValue },
        { merge: true },
      );
      showFeedback(
        nextValue ? "대출 계약서 기능을 켰습니다." : "대출 계약서 기능을 껐습니다.",
        "success",
      );
    } catch (error) {
      setLoanContractEnabled(!nextValue);
      showFeedback(`계약서 설정 저장 실패: ${error.message}`, "error");
    } finally {
      setIsSavingLoanContractSetting(false);
    }
  };

  const handleDelete = async (p) => {
    if (!p || !(await appConfirm(`"${p.label}" 상품을 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    try {
      await deleteBankProduct(classId, activeTab, p.id);
      showFeedback("삭제되었습니다.", "success");
    } catch (e) {
      showFeedback(`삭제 실패: ${e.message}`, "error");
    }
  };

  const handleSelectProduct = (product) => {
    setSelectedId(product.id);
    setDraft({ ...product });
  };

  const handleCancel = () => {
    const selectedProduct = products.find((product) => product.id === selectedId);
    setDraft(selectedProduct ? { ...selectedProduct } : null);
    onClose();
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!active?.id || !over?.id || active.id === over.id) return;

    const oldIndex = products.findIndex((product) => product.id === active.id);
    const newIndex = products.findIndex((product) => product.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previousProducts = products;
    const reorderedProducts = arrayMove(products, oldIndex, newIndex);

    setData((current) => ({
      ...current,
      [activeTab]: reorderedProducts,
    }));

    try {
      setIsReordering(true);
      await reorderBankProducts(
        classId,
        activeTab,
        reorderedProducts.map((product) => product.id),
      );
      showFeedback("상품 순서가 변경되었습니다.", "success");
    } catch (error) {
      setData((current) => ({
        ...current,
        [activeTab]: previousProducts,
      }));
      showFeedback(`순서 변경 실패: ${error.message}`, "error");
    } finally {
      setIsReordering(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="은행 상품 관리"
      size="xl"
      bodyClassName="!overflow-hidden"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button tone="rose" kind="ghost" size="sm" onClick={() => handleDelete(draft)} disabled={!draft}>
            삭제
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={handleCancel}>취소</Button>
            <Button tone="blue" onClick={handleSave} disabled={!isDirty}>저장하기</Button>
          </div>
        </div>
      }
      {...modalProps}
    >
      <div className="flex h-[calc(92dvh-190px)] min-h-0 flex-col gap-4 sm:h-[calc(92vh-190px)]">
        <Tabs
          tabs={[
            {
              id: "deposit",
              label: "예금 상품",
              icon: BanknotesIcon,
              badge: data.deposit.length,
            },
            {
              id: "loan",
              label: "대출 상품",
              icon: CreditCardIcon,
              badge: data.loan.length,
            },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          idPrefix="bank-products"
        />

        {activeTab === "loan" ? (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50/60 px-4 py-3">
            <div>
              <p className="text-sm font-black text-rose-800">대출 계약서</p>
              <p className="mt-0.5 text-xs font-medium text-rose-700">
                켜면 학생이 신청 전에 계약서를 확인하고 직접 서명합니다.
              </p>
            </div>
            <ToggleSwitch
              srLabel="대출 계약서 사용"
              checked={loanContractEnabled}
              onChange={(nextValue) => handleLoanContractToggle(nextValue)}
              disabled={isSavingLoanContractSetting}
            />
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Spinner size="lg" />
            <span className="text-slate-500 font-medium">
              데이터 로드 중...
            </span>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-12 lg:grid-rows-1">
            {/* 왼쪽: 상품 리스트 */}
            <aside className="lg:col-span-4 max-h-40 lg:max-h-none min-h-0 rounded-2xl bg-slate-50 border border-slate-200 p-3 flex flex-col overflow-hidden">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                  목록
                </span>
                <Button
                  color="blue"
                  size="xs"
                  icon={PlusIcon}
                  onClick={handleCreate}
                >
                  새 상품
                </Button>
              </div>

              <div className="mb-2 px-1 text-xs font-medium text-slate-600">
                드래그해서 상품 순서를 바꿀 수 있습니다.
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={products.map((product) => product.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="min-h-0 flex-grow overflow-y-auto space-y-2 pr-1" aria-label="은행 상품 목록">
                    {products.length > 0 ? (
                      products.map((product) => (
                        <SortableProductItem
                          key={product.id}
                          product={product}
                          isSelected={product.id === selectedId}
                          onSelect={handleSelectProduct}
                          getTierName={getTierName}
                          disabled={isReordering}
                        />
                      ))
                    ) : (
                      <li className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
                        등록된 상품이 없습니다.
                      </li>
                    )}
                  </ul>
                </SortableContext>
              </DndContext>
            </aside>

            {/* 오른쪽: 상세 설정 폼 */}
            <section className="lg:col-span-8 min-h-0 rounded-2xl bg-white border border-slate-200 flex flex-col overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-100 bg-white flex flex-wrap gap-3 items-center justify-between">
                <h3 className="font-bold text-slate-800">{draft ? `${draft.label || "새 상품"} · 기존 상품 편집` : "상품 상세 정보"}</h3>

              </div>

              <div className="min-h-0 p-4 sm:p-6 overflow-y-auto flex-grow" aria-label="상품 상세 입력" tabIndex={0}>
                {draft ? (
                  <BankProductForm
                    product={draft}
                    onChange={setDraft}
                    type={activeTab}
                    tiers={tiers} // 🚀 등급 목록 전달
                    students={students}
                    currencyUnit={currencyUnit}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                    <PlusIcon className="w-8 h-8 opacity-20" />
                    <p className="text-sm">편집할 상품을 선택하세요.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}
