import { appConfirm } from "../../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import {
  PlusIcon,
  TrashIcon,
  CreditCardIcon,
} from "@heroicons/react/24/outline";

import { Modal, Button, Spinner, Alert } from "../../../../components/ui";
import { db } from "../../../../firebase";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { deleteProductCascade } from "../../services/subscriptionService";
import SubscriptionProductForm from "../components/SubscriptionProductForm";

const toDateInputValue = (value) => {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date?.getTime?.()) ? "" : date.toISOString().split("T")[0];
};

const normalizeProductForCompare = (product) => {
  if (!product) return null;

  return {
    title: String(product.title || ""),
    description: String(product.description || ""),
    startDate: toDateInputValue(product.startDate),
    endDate: toDateInputValue(product.endDate),
    minAmount: Number(product.minAmount ?? 0),
    maxAmount:
      product.maxAmount === null || product.maxAmount === undefined || product.maxAmount === ""
        ? null
        : Number(product.maxAmount),
    paymentCycle: Number(product.paymentCycle ?? 0),
    targetStudents: [...(product.targetStudents || [])].map(String).sort(),
    hasInterest: product.hasInterest !== false,
    weeklyInterestRate: Number(product.weeklyInterestRate ?? 0),
    earlyTerminationBlocked: product.earlyTerminationBlocked === true,
    assetKey: String(product.assetKey || "subscriptionPassbook"),
  };
};

const emptyProduct = {
  title: "새 청약통장",
  description: "",
  startDate: "",
  endDate: "",
  minAmount: 1000,
  maxAmount: null,
  paymentCycle: 7,
  targetStudents: [],
  hasInterest: true,
  weeklyInterestRate: 2,
  earlyTerminationBlocked: false,
  assetKey: "subscriptionPassbook",
};

export default function SubscriptionManagementModal({
  isOpen,
  onClose,
  classId,
  currencyUnit,
  ...modalProps
}) {
  const { showFeedback } = useFeedback();

  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    if (!isOpen || !classId) return undefined;

    setLoading(true);

    const unsubscribe = onSnapshot(
      query(collection(db, "classes", classId, "subscriptionProducts"), orderBy("createdAt", "desc")),
      (snap) => {
        const nextProducts = snap.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            ...data,
            startDate: data.startDate?.toDate ? data.startDate.toDate() : data.startDate || null,
            endDate: data.endDate?.toDate ? data.endDate.toDate() : data.endDate || null,
          };
        });

        setProducts(nextProducts);
        setLoading(false);
      },
      (error) => {
        setAlert({ type: "error", message: `불러오기 실패: ${error.message}` });
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, isOpen]);

  const selected = useMemo(
    () => (selectedId ? products.find((product) => product.id === selectedId) : null),
    [products, selectedId],
  );

  useEffect(() => {
    if (!products.length) {
      setSelectedId(null);
      setDraft(null);
      return;
    }

    const stillExists = selectedId && products.some((product) => product.id === selectedId);
    if (!stillExists) {
      setSelectedId(products[0].id);
      setDraft({ ...products[0] });
    }
  }, [products, selectedId]);

  const isDirty = useMemo(() => {
    if (!selected || !draft) return false;

    return (
      JSON.stringify(normalizeProductForCompare(draft)) !==
      JSON.stringify(normalizeProductForCompare(selected))
    );
  }, [draft, selected]);

  const handleCreate = async () => {
    if (saving) return;

    setSaving(true);
    try {
      const functions = getFunctions(getApp(), "asia-northeast3");
      const createOrUpdateProduct = httpsCallable(functions, "createOrUpdateProduct");
      await createOrUpdateProduct({ classId, product: { ...emptyProduct } });
      showFeedback("새 청약통장이 생성되었습니다.", "success");
    } catch (error) {
      setAlert({ type: "error", message: `생성 실패: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!draft || !selected || saving) return;

    setSaving(true);
    try {
      const functions = getFunctions(getApp(), "asia-northeast3");
      const createOrUpdateProduct = httpsCallable(functions, "createOrUpdateProduct");
      await createOrUpdateProduct({ classId, productId: selected.id, product: draft });
      showFeedback("저장되었습니다.", "success");
    } catch (error) {
      setAlert({ type: "error", message: `저장 실패: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product) => {
    if (!product || saving) return;

    const confirmed = (await appConfirm(`"${product.title || "청약통장"}"을(를) 정말 삭제할까요?\n삭제된 기록은 복구할 수 없습니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
    if (!confirmed) return;

    setSaving(true);
    try {
      await deleteProductCascade({ classId, productId: product.id });
      showFeedback("청약통장이 삭제되었습니다.", "success");
    } catch (error) {
      setAlert({ type: "error", message: `삭제 실패: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (value) => {
    if (!value) return "미설정";
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="청약통장 관리" size="xl" {...modalProps}>
      <div className="space-y-4">
        {alert ? (
          <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Spinner color="blue" />
            <p className="mt-4 text-sm font-bold text-slate-400">정보를 불러오는 중입니다...</p>
          </div>
        ) : (
          <div className="grid h-[65vh] grid-cols-12 gap-5">
            <aside className="col-span-4 flex flex-col rounded-[2rem] border border-slate-100 bg-slate-50 p-4">
              <div className="mb-4 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-700">상품 목록</span>
                  <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] text-white">
                    {products.length}
                  </span>
                </div>
                <Button
                  tone="blue"
                  size="xs"
                  icon={PlusIcon}
                  onClick={handleCreate}
                  disabled={saving}
                  
                >
                  새 상품 생성
                </Button>
              </div>

              <p className="mb-3 px-1 text-xs leading-5 text-slate-500">
                누르면 기본 상품이 바로 생성됩니다. 생성 후 상세에서 조건을 수정하고 저장하세요.
              </p>

              <ul className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
                {products.map((product) => {
                  const isSelected = product.id === selectedId;

                  return (
                    <li
                      key={product.id}
                      className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                        isSelected
                          ? "border-blue-200 bg-white shadow-md shadow-blue-100/50"
                          : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white/60"
                      }`}
                      onClick={() => {
                        setSelectedId(product.id);
                        setDraft({ ...product });
                      }}
                    >
                      <div className="mb-1 truncate text-sm font-bold text-slate-800">
                        {product.title}
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span className="text-blue-500">{product.paymentCycle}일 주기</span>
                        <span className="text-slate-400">
                          {formatDate(product.startDate)} ~ {formatDate(product.endDate)}
                        </span>
                      </div>
                    </li>
                  );
                })}

                {products.length === 0 ? (
                  <div className="py-20 text-center text-xs font-bold text-slate-300">
                    등록된 상품이 없습니다.
                  </div>
                ) : null}
              </ul>
            </aside>

            <section className="col-span-8 flex flex-col overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-50 bg-white px-6 py-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800">상품 상세 설정</h3>
                  <p
                    className={`text-[10px] font-bold ${
                      isDirty ? "text-amber-500" : "text-blue-400"
                    }`}
                  >
                    {isDirty ? "변경된 내용이 있습니다" : "모든 내용이 저장되었습니다"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selected ? (
                    <Button aria-label="삭제"
                      tone="red"
                      kind="soft"
                      size="sm"
                      onClick={() => handleDelete(selected)}
                      disabled={saving}
                      
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button
                    tone="blue"
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || saving}
                    isLoading={saving}
                    className={` ${
                      isDirty ? "" : "opacity-50"
                    }`}
                  >
                    저장하기
                  </Button>
                </div>
              </div>

              <div className="custom-scrollbar flex-1 overflow-y-auto p-6">
                {selected ? (
                  <SubscriptionProductForm
                    value={draft}
                    onChange={setDraft}
                    currencyUnit={currencyUnit}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-slate-300">
                    <CreditCardIcon className="mb-4 h-16 w-16 opacity-20" />
                    <p className="text-sm font-bold">관리할 상품을 왼쪽에서 선택해 주세요.</p>
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
