import { appAlert, appConfirm } from "../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  Clock,
  FileEdit,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";
import dayjs from "dayjs";

import {
  Badge,
  Button,
  CardSkeleton,
  Modal,
  SurfaceLoader,
  Tabs,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { db } from "../../../firebase";
import {
  getLoanOutstandingPrincipal,
  getLoanPrincipal,
  getLoanRemainingInterest,
  getLoanTotalInterest,
} from "../../bank/utils/loanMetrics";

const toDateSafe = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getStatusMeta = (status, isLoan) => {
  if (status === "pending") {
    return {
      label: "승인 대기",
      tone: "amber",
    };
  }

  if (status === "active" || status === "ongoing") {
    return {
      label: isLoan ? "상환 중" : "진행 중",
      tone: isLoan ? "rose" : "blue",
    };
  }

  return {
    label: "종료됨",
    tone: "slate",
  };
};

const MasterEditModal = ({
  isOpen,
  onClose,
  item,
  onConfirm,
  isProcessing,
}) => {
  const [fields, setFields] = useState({ days: "", rate: "", adminNote: "" });

  useEffect(() => {
    if (!item || !isOpen) return;

    setFields({
      days: item.days || 0,
      rate: item.rate || 0,
      adminNote: item.adminNote || "",
    });
  }, [isOpen, item]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="금융 조건 마스터 수정"
      size="lg"
    >
      <div className="space-y-6">
        <div className="flex gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
          <AlertTriangle className="shrink-0 text-amber-500" size={20} />
          <p className="text-xs font-bold leading-relaxed text-amber-900">
            주의: 수정된 조건은 해당 상품의 개별 내역에 직접 반영됩니다.
            <br />
            대출은 남은 원금 기준으로 이자 잔액이 다시 계산됩니다.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="ml-1 text-[11px] font-black uppercase tracking-tighter text-slate-400">
              만기 기간 (일)
            </label>
            <input
              type="number"
              className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 font-bold outline-none transition-all focus:border-blue-500 focus:bg-blue-50/50"
              value={fields.days}
              onChange={(event) =>
                setFields((prev) => ({ ...prev, days: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <label className="ml-1 text-[11px] font-black uppercase tracking-tighter text-slate-400">
              적용 금리 (%)
            </label>
            <input
              type="number"
              step="0.1"
              className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 font-bold outline-none transition-all focus:border-blue-500 focus:bg-blue-50/50"
              value={fields.rate}
              onChange={(event) =>
                setFields((prev) => ({ ...prev, rate: event.target.value }))
              }
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="ml-1 text-[11px] font-black uppercase tracking-tighter text-slate-400">
            수정 사유 (학생에게 공개)
          </label>
          <textarea
            className="h-24 w-full resize-none rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium outline-none focus:border-blue-500 focus:bg-blue-50/50"
            placeholder="예: 학급 운영 보정 금리 적용"
            value={fields.adminNote}
            onChange={(event) =>
              setFields((prev) => ({ ...prev, adminNote: event.target.value }))
            }
          />
        </div>

        <div className="flex gap-3">
          <Button size="md"
            kind="soft"
            tone="slate"
            className="flex-1"
            onClick={onClose}
          >
            취소
          </Button>
          <Button size="md"
            tone="blue"
            className="flex-1"
            isLoading={isProcessing}
            onClick={() => {
              if (!String(fields.adminNote).trim()) {
                appAlert("학생에게 보일 수정 사유를 입력해주세요.");
                return;
              }

              onConfirm(fields);
            }}
          >
            수정사항 적용
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const BankItemCard = ({
  item,
  type,
  formatClassCurrency,
  onEditOpen,
  onAction,
  isProcessing,
}) => {
  const isLoan = type === "loans";
  const isPending = item.status === "pending";
  const isInProgress = item.status === "active" || item.status === "ongoing";
  const isVisibleCard = isPending || isInProgress;
  const statusMeta = getStatusMeta(item.status, isLoan);

  const metrics = useMemo(() => {
    const start = toDateSafe(item.startedAt) || toDateSafe(item.createdAt) || new Date();
    const totalDays = Number(item.days || 1);
    const diffMs = new Date().getTime() - start.getTime();
    const passedDays = Math.max(
      0,
      Math.min(totalDays, Math.floor(diffMs / 86400000)),
    );

    const principal = getLoanPrincipal(item);
    const principalLeft = getLoanOutstandingPrincipal(item);
    const interestTotal = getLoanTotalInterest(item);
    const interestLeft = getLoanRemainingInterest(item);

    return {
      principal,
      principalLeft,
      interestTotal,
      interestLeft,
      passedDays,
      remainingDays: totalDays - passedDays,
      progress:
        isLoan && principal > 0
          ? ((principal - principalLeft) / principal) * 100
          : (passedDays / totalDays) * 100,
      requestDate: dayjs(toDateSafe(item.createdAt) || start).format("YYYY.MM.DD"),
      maturityDate: dayjs(start).add(totalDays, "day").format("YYYY.MM.DD"),
    };
  }, [isLoan, item]);

  const headerAmount = isLoan
    ? isPending
      ? metrics.principal
      : metrics.principalLeft
    : Number(item.amount ?? item.principal ?? 0);

  const actionLabel = isLoan
    ? isPending
      ? "강제 취소"
      : "강제 상환"
    : isPending
      ? "강제 취소"
      : "강제 해지";

  return (
    <div
      className={`group relative overflow-hidden rounded-3xl border-2 transition-all duration-300 ${
        isVisibleCard
          ? "border-slate-100 bg-white shadow-sm hover:border-blue-100 hover:shadow-xl"
          : "border-transparent bg-slate-50 opacity-60"
      }`}
    >
      <div className="p-6">
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`rounded-2xl p-3 ${
                isLoan ? "bg-rose-50 text-rose-500" : "bg-blue-50 text-blue-500"
              }`}
            >
              {isLoan ? <Landmark size={24} /> : <Wallet size={24} />}
            </div>

            <div>
              <div className="mb-1 flex items-center gap-2">
                <h4 className="text-lg font-black leading-none text-slate-800">
                  {item.productLabel || (isLoan ? "대출 상품" : "정기 예금")}
                </h4>
                <Badge tone={statusMeta.tone} variant="soft" size="sm">
                  {statusMeta.label}
                </Badge>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest italic text-slate-400">
                적용 금리: {item.rate ?? item.finalRateApplied ?? item.finalRate ?? 0}%
              </p>
            </div>
          </div>

          <div className="text-right">
            <p
              className={`text-2xl font-black ${
                isLoan ? "text-rose-600" : "text-blue-600"
              }`}
            >
              {formatClassCurrency(headerAmount)}
            </p>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {isLoan
                ? isPending
                  ? "신청 원금"
                  : "남은 원금 잔액"
                : "예치 원금"}
            </p>
          </div>
        </div>

        {isVisibleCard ? (
          <div className="space-y-5">
            {isPending ? (
              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                <div className="space-y-1">
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase text-amber-600">
                    <PiggyBank size={12} />
                    {isLoan ? "신청 금액" : "예치 예정 금액"}
                  </span>
                  <p className="text-sm font-black text-amber-800">
                    {formatClassCurrency(metrics.principal)}
                  </p>
                </div>

                <div className="space-y-1 text-right">
                  <span className="flex items-center justify-end gap-1 text-[10px] font-black uppercase text-amber-600">
                    <Calendar size={12} />
                    신청일
                  </span>
                  <p className="text-sm font-black text-slate-700">
                    {metrics.requestDate}
                  </p>
                </div>

                <div className="col-span-2 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-[11px] font-semibold text-amber-700">
                  현재 승인 대기 상태입니다. 아직 실제 금융 상품이 시작되지 않았습니다.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="space-y-1">
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
                    {isLoan ? (
                      <AlertTriangle size={12} className="text-rose-400" />
                    ) : (
                      <TrendingUp size={12} />
                    )}
                    {isLoan ? "남은 이자" : "만기 예상 이자"}
                  </span>
                  <p
                    className={`text-sm font-black ${
                      isLoan ? "text-rose-500" : "text-emerald-600"
                    }`}
                  >
                    {isLoan ? "" : "+"}
                    {formatClassCurrency(
                      isLoan ? metrics.interestLeft : metrics.interestTotal,
                    )}
                  </p>
                </div>

                <div className="space-y-1 text-right">
                  <span className="flex items-center justify-end gap-1 text-[10px] font-black uppercase text-slate-400">
                    <Calendar size={12} />
                    {isLoan ? "최종 상환일" : "예상 만기일"}
                  </span>
                  <p className="text-sm font-black text-slate-700">
                    {metrics.maturityDate}
                  </p>
                </div>

                <div className="col-span-2 pt-2">
                  <div className="mb-2 flex items-end justify-between">
                    <span
                      className={`text-[11px] font-black ${
                        isLoan ? "text-rose-600" : "text-blue-600"
                      }`}
                    >
                      {isLoan
                        ? `상환 진행률 ${metrics.progress.toFixed(1)}%`
                        : `${metrics.passedDays}일 진행`}
                    </span>
                    <span className="text-[10px] font-bold italic text-slate-400">
                      {isLoan
                        ? `총 원금: ${formatClassCurrency(metrics.principal)}`
                        : `${metrics.remainingDays}일 남음`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${
                        isLoan ? "bg-rose-500 shadow-sm" : "bg-blue-500 shadow-sm"
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, metrics.progress))}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                tone="slate"
                
                icon={FileEdit}
                onClick={() => onEditOpen(item)}
              >
                조건 수정
              </Button>
              <Button
                size="sm"
                tone={isLoan ? "red" : "slate"}
                
                isLoading={isProcessing}
                icon={ChevronRight}
                onClick={() =>
                  onAction(
                    item.id,
                    isLoan ? "force_repay_loan" : "force_terminate_saving",
                  )
                }
              >
                {actionLabel}
              </Button>
            </div>
          </div>
        ) : null}

        {item.adminNote ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5">
            <Wrench size={14} className="mt-0.5 shrink-0 text-indigo-400" />
            <p className="text-[11px] font-bold leading-tight text-indigo-900">
              관리자 알림: {item.adminNote}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const BankManagementModal = ({
  isOpen,
  onClose,
  student,
  classId,
  initialTab = "savings",
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const { formatClassCurrency } = useNumberFormat();
  const { showFeedback } = useFeedback();

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
  }, [initialTab, isOpen]);

  const fetchData = useCallback(async () => {
    if (!student || !classId) return;

    setIsLoading(true);
    try {
      const q = query(
        collection(db, `classes/${classId}/students/${student.uid}/${activeTab}`),
        orderBy("createdAt", "desc"),
      );
      const snap = await getDocs(q);
      setItems(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, classId, student]);

  useEffect(() => {
    if (isOpen) fetchData();
  }, [fetchData, isOpen]);

  const handleOpenEdit = (item) => {
    setSelectedItem(item);
    setIsEditOpen(true);
  };

  const handleAction = async (docId, type, payload = {}) => {
    const currentItem = items.find((item) => item.id === docId);
    const isPendingLoanRequest =
      type === "force_repay_loan" && currentItem?.status === "pending";
    const isPendingSavingRequest =
      type === "force_terminate_saving" && currentItem?.status === "pending";

    if (type === "force_repay_loan") {
      const confirmed = (await appConfirm(
        isPendingLoanRequest
          ? "승인 대기 중인 대출 요청을 강제 취소하시겠습니까? 실제 자산은 변동되지 않습니다."
          : "정말로 강제 상환하시겠습니까? 학생의 현금 잔액에서 원금이 즉시 차감됩니다.",
      ));
      if (!confirmed) return;
    }

    if (type === "force_terminate_saving") {
      const confirmed = (await appConfirm(
        isPendingSavingRequest
          ? "승인 대기 중인 예금 요청을 강제 취소하시겠습니까? 학생 현금 잔액으로 원금이 복구됩니다."
          : "정말로 강제 해지하시겠습니까? 원금이 학생의 현금 잔액으로 즉시 반환됩니다.",
      ));
      if (!confirmed) return;
    }

    setProcessingId(docId);
    try {
      const adminBankAction = httpsCallable(
        getFunctions(undefined, "asia-northeast3"),
        "adminBankAction",
      );

      await adminBankAction({
        classId,
        targetUid: student.uid,
        docId,
        type,
        payload,
      });

      showFeedback("성공적으로 처리했습니다.", "success");
      setIsEditOpen(false);
      fetchData();
    } catch (error) {
      showFeedback(`오류: ${error.message}`, "error");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`${student?.name} 학생 금융 관리`}
        size="3xl"
      >
        <Tabs ariaLabel="학생 금융 관리 업무" idPrefix="student-bank-management" tabs={[{id:"savings",label:"예금 관리",icon:PiggyBank},{id:"loans",label:"대출 관리",icon:Landmark}]} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="md" fullWidth className="mb-6" />

        <div className="custom-scrollbar max-h-[60vh] overflow-y-auto pr-2">
          <SurfaceLoader
            loading={isLoading}
            minHeightClassName="min-h-[24rem]"
            className="rounded-3xl"
            skeleton={
              <div className="space-y-4 p-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  <CardSkeleton
                    key={`bank-item-skeleton-${index}`}
                    bare
                    className="min-h-[12rem]"
                  />
                ))}
              </div>
            }
          >
            <div className="space-y-6">
              {items.length === 0 ? (
                <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 py-24 text-center">
                  <Clock size={48} className="mx-auto mb-4 text-slate-200" />
                  <p className="text-lg font-bold text-slate-400">
                    기록된 금융 내역이 없습니다.
                  </p>
                </div>
              ) : (
                items.map((item) => (
                  <BankItemCard
                    key={item.id}
                    item={item}
                    type={activeTab}
                    formatClassCurrency={formatClassCurrency}
                    onEditOpen={handleOpenEdit}
                    onAction={handleAction}
                    isProcessing={processingId === item.id}
                  />
                ))
              )}
            </div>
          </SurfaceLoader>
        </div>
      </Modal>

      <MasterEditModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        item={selectedItem}
        isProcessing={!!processingId}
        onConfirm={(fields) =>
          handleAction(selectedItem.id, "update_item_master", {
            category: activeTab,
            fields: {
              days: Number(fields.days),
              rate: Number(fields.rate),
            },
            adminNote: fields.adminNote,
          })
        }
      />
    </>
  );
};

export default BankManagementModal;
