import { useNumberFormat as useConfiguredMoney } from "../../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Search,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { getDocs } from "firebase/firestore";

import { Button, Modal, Spinner } from "../../../../components/ui";
import { useUser } from "../../../../contexts/UserContext";
import { db } from "../../../../firebase";
import {
  ACTIVITY_LOG_SCOPE,
  buildActivityLogQuery,
  calculateActivityStatistics,
  convertFirestoreDocToActivity,
  getActivityDisplayInfo,
} from "../../../../utils/activityUtils";
import { getUserFacingRecordDescription } from "../../../../utils/userFacingRecordDescription";

dayjs.locale("ko");

const PAGE_SIZE = 12;

const normalizeLegacyStoreDescription = (item) => {
  const rawDescription = String(item?.description || "").trim();
  if (!rawDescription) return rawDescription;

  const category = String(item?.category || "");
  if (!category.includes("store")) return rawDescription;

  const legacyPurchaseMatch = rawDescription.match(/^(.*)\s+(\d+)\s+purchase$/i);
  if (!legacyPurchaseMatch) return rawDescription;

  const itemName = legacyPurchaseMatch[1].trim();
  const quantity = Number(legacyPurchaseMatch[2]);

  if (!Number.isFinite(quantity)) return rawDescription;
  return `${itemName} ${quantity}개 구매`;
};



const TransactionIcon = ({ type, category, tone }) => {
  let Icon = type === "income" ? ArrowDownLeft : ArrowUpRight;
  if (String(category || "").includes("store")) {
    Icon = ShoppingBag;
  }

  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    slate: "bg-slate-50 text-slate-500",
  };

  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
        toneClasses[tone] || toneClasses.slate
      }`}
    >
      <Icon size={20} strokeWidth={2.5} />
    </div>
  );
};

const MissionTokenHistoryModal = ({ isOpen, onClose, classId, studentUid }) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatNumber = (value) => Number(value || 0).toLocaleString("ko-KR");

  const { missionTokenLabel } = useUser();
  const [history, setHistory] = useState([]);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(
    async ({ isMore = false, cursor = null } = {}) => {
      if (!classId || !studentUid) return;

      setIsLoading(true);
      try {
        const historyQuery = buildActivityLogQuery({
          db,
          classId,
          studentUid,
          pageSize: PAGE_SIZE,
          lastVisible: isMore ? cursor : null,
          logScope: ACTIVITY_LOG_SCOPE.MISSION_TOKEN,
        });
        const snapshot = await getDocs(historyQuery);
        const nextLogs = snapshot.docs
          .map(convertFirestoreDocToActivity)
          .map((log) => ({
            ...log,
            description: getUserFacingRecordDescription(
              normalizeLegacyStoreDescription(log),
              "과제 활동",
            ),
          }));

        setHistory((prev) => (isMore ? [...prev, ...nextLogs] : nextLogs));
        setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (error) {
        console.error("[MissionTokenHistoryModal] failed to load history:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [classId, studentUid],
  );

  useEffect(() => {
    if (!isOpen) return;
    setHistory([]);
    setLastDoc(null);
    setHasMore(true);
    void loadData();
  }, [isOpen, loadData]);

  const stats = useMemo(() => calculateActivityStatistics(history), [history]);

  const groupedHistory = useMemo(() => {
    const groups = {};

    history.forEach((item) => {
      const dateKey = dayjs(item.timestamp).format("M월 D일 dddd");
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(item);
    });

    return groups;
  }, [history]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={`${missionTokenLabel} 내역`}
    >
      <div className="flex h-[85vh] flex-col overflow-hidden bg-white">
        <div className="shrink-0 border-b border-slate-50 bg-white px-5 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <p className="mb-0.5 text-[10px] font-bold text-slate-400">
                  순변동
                </p>
                <h2
                  className={`text-xl font-black ${
                    stats.netAmount >= 0 ? "text-slate-800" : "text-rose-600"
                  }`}
                >
                  {stats.netAmount >= 0 ? "+" : ""}
                  {formatConfiguredAmount(stats.netAmount)}
                  <span className="ml-1 text-xs font-bold text-slate-400">
                    {missionTokenLabel}
                  </span>
                </h2>
              </div>

              <div className="flex gap-4 border-l border-slate-100 pl-6">
                <div>
                  <p className="text-[9px] font-bold uppercase text-emerald-500">
                    지급
                  </p>
                  <p className="text-xs font-black text-emerald-600">
                    +{formatConfiguredAmount(stats.totalIncome)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-rose-400">
                    사용
                  </p>
                  <p className="text-xs font-black text-rose-600">
                    -{formatConfiguredAmount(stats.totalExpense)}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-500">
              <Sparkles size={18} />
            </div>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto bg-white px-5">
          {isLoading && history.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : Object.keys(groupedHistory).length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-20 text-slate-300">
              <Search size={48} strokeWidth={1} className="mb-4 opacity-20" />
              <p className="text-sm font-bold">{missionTokenLabel} 내역이 없습니다.</p>
            </div>
          ) : (
            <div className="pb-10">
              {Object.entries(groupedHistory).map(([date, items]) => (
                <div key={date} className="mt-6">
                  <div className="sticky top-0 z-10 bg-white/95 py-2 backdrop-blur-sm">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {date}
                    </h3>
                  </div>

                  <div className="divide-y divide-slate-50">
                    {items.map((item) => {
                      const info = getActivityDisplayInfo(
                        item,
                        missionTokenLabel,
                        formatNumber,
                        missionTokenLabel,
                      );

                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 py-4"
                        >
                          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                            <TransactionIcon
                              type={info.icon}
                              category={item.category}
                              tone={info.tone}
                            />

                            <div className="min-w-0">
                              <span className="block truncate text-sm font-bold leading-tight text-slate-800">
                                {item.description}
                              </span>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                                <span>{dayjs(item.timestamp).format("A h:mm")}</span>
                                {item.note ? (
                                  <>
                                    <span className="h-0.5 w-0.5 rounded-full bg-slate-300" />
                                    <span className="max-w-[120px] truncate">
                                      {item.note}
                                    </span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <span
                              className={`text-[15px] font-black tracking-tight ${info.color}`}
                            >
                              {info.amountText}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {hasMore ? (
                <div className="mt-6">
                  <Button size="xs"
                    onClick={() => void loadData({ isMore: true, cursor: lastDoc })}
                    isLoading={isLoading}
                    kind="soft"
                    tone="slate"
                    fullWidth
                    icon={ChevronDown}
                    
                  >
                    기록 더 보기
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default MissionTokenHistoryModal;
