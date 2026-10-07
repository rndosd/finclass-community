import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import {
  CheckSquare,
  ChevronDown,
  Filter,
  Minus,
  Plus,
  Square,
  X,
} from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from "firebase/firestore";

import { Button, Modal, Spinner } from "../../../components/ui";
import { fetchCreditLogsSince } from "../utils/creditLogReads";
import { db } from "../../../firebase";

dayjs.locale("ko");

const PAGE_SIZE = 12;

export default function CreditHistoryModal({ student, onClose }) {
  const classId = student?.classId;
  const studentUid = student?.uid;
  const studentName = student?.name || "학생";

  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [lastVisible, setLastVisible] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [recentStats, setRecentStats] = useState({
    plus: 0,
    minus: 0,
    net: 0,
    loading: true,
  });

  useEffect(() => {
    if (!classId || !studentUid) {
      setLogs([]);
      setLastVisible(null);
      setHasMore(false);
      setRecentStats({ plus: 0, minus: 0, net: 0, loading: false });
      return;
    }

    let cancelled = false;

    const loadInitial = async () => {
      setIsLoading(true);
      setShowFilters(false);
      setFilterType("all");
      setLogs([]);
      setLastVisible(null);
      setHasMore(true);
      setRecentStats((prev) => ({ ...prev, loading: true }));

      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const [statsSnapshot, logsSnapshot] = await Promise.all([
          fetchCreditLogsSince(classId, studentUid, sevenDaysAgo),
          getDocs(
            query(
              collection(db, `classes/${classId}/students/${studentUid}/creditLogs`),
              orderBy("timestamp", "desc"),
              limit(PAGE_SIZE),
            ),
          ),
        ]);

        if (cancelled) return;

        const stats = statsSnapshot.docs.reduce(
          (acc, doc) => {
            const data = doc.data() || {};
            const delta = Number(data?.delta ?? data?.amount ?? 0);
            if (delta > 0) acc.plus += delta;
            if (delta < 0) acc.minus += Math.abs(delta);
            return acc;
          },
          { plus: 0, minus: 0 },
        );

        const nextLogs = logsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setRecentStats({
          plus: stats.plus,
          minus: stats.minus,
          net: stats.plus - stats.minus,
          loading: false,
        });
        setLogs(nextLogs);
        setLastVisible(logsSnapshot.docs[logsSnapshot.docs.length - 1] || null);
        setHasMore(logsSnapshot.docs.length === PAGE_SIZE);
      } catch (error) {
        if (cancelled) return;
        console.error("[CreditHistoryModal] fetch failed:", error);
        setRecentStats({ plus: 0, minus: 0, net: 0, loading: false });
        setLogs([]);
        setLastVisible(null);
        setHasMore(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [classId, studentUid]);

  const handleLoadMore = async () => {
    if (!classId || !studentUid || !hasMore || !lastVisible || isFetchingMore) {
      return;
    }

    setIsFetchingMore(true);

    try {
      const snapshot = await getDocs(
        query(
          collection(db, `classes/${classId}/students/${studentUid}/creditLogs`),
          orderBy("timestamp", "desc"),
          startAfter(lastVisible),
          limit(PAGE_SIZE),
        ),
      );

      const nextLogs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setLogs((prev) => [...prev, ...nextLogs]);
      setLastVisible(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } finally {
      setIsFetchingMore(false);
    }
  };

  const filteredLogs = useMemo(() => {
    if (filterType === "all") return logs;
    return logs.filter((log) => {
      const delta = Number(log?.delta ?? log?.amount ?? 0);
      return filterType === "up" ? delta > 0 : delta < 0;
    });
  }, [filterType, logs]);

  const groupedLogs = useMemo(
    () =>
      filteredLogs.reduce((groups, log) => {
        const dateKey = log.timestamp?.toDate
          ? dayjs(log.timestamp.toDate()).format("M월 D일 dddd")
          : "날짜 정보 없음";

        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(log);
        return groups;
      }, {}),
    [filteredLogs],
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="md"
      title={`${studentName} 신용로그`}
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
                    recentStats.net >= 0 ? "text-slate-800" : "text-rose-600"
                  }`}
                >
                  {recentStats.loading
                    ? "..."
                    : `${recentStats.net > 0 ? "+" : ""}${recentStats.net}점`}
                </h2>
              </div>

              <div className="flex gap-4 border-l border-slate-100 pl-6">
                <div>
                  <p className="text-[9px] font-bold uppercase text-emerald-500">
                    상승
                  </p>
                  <p className="text-xs font-black text-emerald-600">
                    {recentStats.loading ? "..." : `+${recentStats.plus}점`}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-rose-400">
                    하락
                  </p>
                  <p className="text-xs font-black text-rose-600">
                    {recentStats.loading ? "..." : `-${recentStats.minus}점`}
                  </p>
                </div>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`rounded-xl p-2 transition-all ${
                showFilters
                  ? "bg-slate-800 text-white"
                  : "bg-slate-50 text-slate-400"
              }`}
              aria-label="필터 열기"
            >
              {showFilters ? <X size={18} /> : <Filter size={18} />}
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="shrink-0 space-y-3 border-b border-slate-50 bg-white px-5 py-4 animate-in slide-in-from-top-1">
            <div className="flex gap-2">
              <FilterChip
                active={filterType === "all"}
                label="전체"
                onClick={() => setFilterType("all")}
              />
              <FilterChip
                active={filterType === "up"}
                label="상승만"
                onClick={() => setFilterType("up")}
              />
              <FilterChip
                active={filterType === "down"}
                label="하락만"
                onClick={() => setFilterType("down")}
              />
            </div>
          </div>
        ) : null}

        <div className="custom-scrollbar flex-1 overflow-y-auto bg-white px-5">
          {isLoading && logs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : Object.keys(groupedLogs).length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-20 text-slate-300">
              <p className="text-sm font-bold">표시할 신용로그가 없습니다.</p>
            </div>
          ) : (
            <div className="select-none pb-10">
              {Object.entries(groupedLogs).map(([date, items]) => (
                <div key={date} className="mt-6">
                  <div className="sticky top-0 z-10 bg-white/95 py-2 backdrop-blur-sm">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {date}
                    </h3>
                  </div>

                  <div className="divide-y divide-slate-50">
                    {items.map((log) => (
                      <LogRow key={log.id} log={log} />
                    ))}
                  </div>
                </div>
              ))}

              {hasMore ? (
                <div className="mt-6">
                  <Button
                    onClick={handleLoadMore}
                    size="md"
                    kind="ghost"
                    tone="slate"
                    fullWidth
                    icon={ChevronDown}
                    disabled={isFetchingMore}
                    
                  >
                    {isFetchingMore ? "불러오는 중..." : "기록 더 보기"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FilterChip({ active, label, onClick }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-xs font-bold transition ${
        active
          ? "border-indigo-200 bg-indigo-600 text-white shadow-sm shadow-indigo-100"
          : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-slate-100"
      }`}
    >
      {label}
    </Button>
  );
}

function LogRow({ log }) {
  const delta = Number(log?.delta ?? log?.amount ?? 0);
  const isPositive = delta > 0;
  const isSelected = isPositive;

  return (
    <div className="group flex items-center justify-between gap-3 py-4 transition-colors">
      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        <div className="shrink-0 text-slate-300">
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-slate-300" />
          ) : (
            <Square className="h-5 w-5" />
          )}
        </div>

        <CreditDeltaIcon isPositive={isPositive} />

        <div className="min-w-0">
          <span className="block truncate text-sm font-bold leading-tight text-slate-800">
            {log.reason || "사유 없음"}
          </span>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
            <span>
              {log.timestamp?.toDate
                ? dayjs(log.timestamp.toDate()).format("A h:mm")
                : "시간 정보 없음"}
            </span>
          </div>
        </div>
      </div>

      <div
        className={`shrink-0 text-[15px] font-black tracking-tight ${
          isPositive ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-500"
        }`}
      >
        {delta > 0 ? "+" : ""}
        {delta}점
      </div>
    </div>
  );
}

function CreditDeltaIcon({ isPositive }) {
  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
        isPositive
          ? "bg-emerald-50 text-emerald-600"
          : "bg-rose-50 text-rose-600"
      }`}
    >
      {isPositive ? (
        <Plus size={20} strokeWidth={2.5} />
      ) : (
        <Minus size={20} strokeWidth={2.5} />
      )}
    </div>
  );
}
