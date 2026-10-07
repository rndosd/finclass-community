import { appConfirm } from "../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  ArrowLeft,
  ChevronRight,
  RefreshCw,
  School,
  ShieldCheck,
  Trophy,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AppLayout from "../../components/layout/AppLayout";
import {
  Alert,
  Button,
  Card,
  CardSkeleton,
  PageSkeleton,
  SurfaceLoader,
} from "../../components/ui";
import { useFeedback } from "../../contexts/FeedbackContext";
import { db, functions } from "../../firebase";
import ClassActivityModal from "./modals/ClassActivityModal";

const ACTIVITY_WINDOW_DAYS = 7;
const ACTIVITY_INDEX_DOC_PATH = ["system_stats", "activityIndex"];

const EMPTY_SUMMARY = {
  totalClasses: 0,
  totalStudents: 0,
};

const EMPTY_ACTIVITY_INDEX = {
  generatedAt: null,
  totalLogCount7d: 0,
  activeClassCount7d: 0,
  rankedClasses: [],
};

const STAT_ICON_STYLES = {
  blue: "bg-blue-50 text-blue-600",
  indigo: "bg-indigo-50 text-indigo-600",
  amber: "bg-amber-50 text-amber-600",
};

const getClassLabel = (classItem) =>
  classItem?.className || classItem?.classDocId || "이름 없는 학급";

const getRecentActivityCount = (classItem) =>
  Number(classItem?.recent7dCount || 0);

const formatTimestamp = (value) => {
  if (!value || typeof value.toDate !== "function") return "-";
  return value.toDate().toLocaleString("ko-KR");
};

const normalizeSummary = (raw = {}) => ({
  totalClasses: Number(raw.totalClasses || 0),
  totalStudents: Number(raw.totalStudents || 0),
});

const normalizeActivityIndex = (raw = {}) => ({
  generatedAt: raw.generatedAt || null,
  totalLogCount7d: Number(raw.totalLogCount7d || 0),
  activeClassCount7d: Number(raw.activeClassCount7d || 0),
  rankedClasses: Array.isArray(raw.rankedClasses) ? raw.rankedClasses : [],
});

const MasterDashboard = () => {
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();

  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [chartData, setChartData] = useState([]);
  const [activityIndex, setActivityIndex] = useState(EMPTY_ACTIVITY_INDEX);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRankingModalOpen, setIsRankingModalOpen] = useState(false);
  const hasLoadedStatsRef = useRef(false);

  const fetchAllStats = useCallback(
    async ({ preserveCurrent = false } = {}) => {
      if (preserveCurrent && hasLoadedStatsRef.current) {
        setIsRefreshing(true);
      } else {
        setIsInitialLoading(true);
      }

      try {
        const [summarySnap, activityIndexSnap, dailySnap] = await Promise.all([
          getDoc(doc(db, "system_stats", "summary")),
          getDoc(doc(db, ...ACTIVITY_INDEX_DOC_PATH)),
          getDocs(
            query(
              collection(db, "daily_stats"),
              orderBy("date", "desc"),
              limit(ACTIVITY_WINDOW_DAYS),
            ),
          ),
        ]);

        setSummary(
          summarySnap.exists()
            ? normalizeSummary(summarySnap.data())
            : EMPTY_SUMMARY,
        );

        setActivityIndex(
          activityIndexSnap.exists()
            ? normalizeActivityIndex(activityIndexSnap.data())
            : EMPTY_ACTIVITY_INDEX,
        );

        setChartData(
          dailySnap.docs
            .map((docSnap) => ({
              name: docSnap.id.slice(5),
              logs: Number(docSnap.data()?.logCount || 0),
            }))
            .reverse(),
        );
      } catch (error) {
        console.error(error);
        showFeedback("통계 데이터를 불러오지 못했습니다.", "error");
      } finally {
        hasLoadedStatsRef.current = true;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    },
    [showFeedback],
  );

  useEffect(() => {
    fetchAllStats({ preserveCurrent: hasLoadedStatsRef.current });
  }, [fetchAllStats]);

  const handleSystemSync = async () => {
    const shouldSync = (await appConfirm(
      "최근 7일 활동 추이와 학급 활동 순위를 원본 로그 기준으로 다시 계산할까요?",
    ));
    if (!shouldSync) return;

    setIsSyncing(true);
    try {
      const syncFunc = httpsCallable(functions, "manualStatsSync");
      await syncFunc();
      showFeedback("시스템 데이터 보정이 완료되었습니다.", "success");
      await fetchAllStats({ preserveCurrent: true });
    } catch (error) {
      console.error(error);
      showFeedback("보정 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const rankingPreview = useMemo(
    () => activityIndex.rankedClasses.slice(0, 10),
    [activityIndex.rankedClasses],
  );

  if (isInitialLoading) {
    return (
      <AppLayout title="운영 통계">
        <div className="mx-auto max-w-7xl space-y-6 p-8">
          <PageSkeleton summaryCards={3} showChart showTable={false} />
          <CardSkeleton rows={8} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="운영 통계">
      <div className="mx-auto max-w-7xl space-y-6 p-8">
        <div className="flex items-center justify-between">
          <Button tone="slate" kind="ghost" size="md"
            type="button"
            onClick={() => navigate("/admin/master")}
            className="flex items-center gap-2 transition-colors"
          >
            <ArrowLeft size={18} />
            마스터 허브
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              icon={RefreshCw}
              onClick={() => fetchAllStats({ preserveCurrent: true })}
              disabled={isSyncing}
              isLoading={isRefreshing}
            >
              새로고침
            </Button>
            <Button
              tone="blue"
              icon={ShieldCheck}
              onClick={handleSystemSync}
              isLoading={isSyncing}
            >
              시스템 데이터 보정
            </Button>
          </div>
        </div>

        <SurfaceLoader
          loading={isRefreshing}
          variant="refreshing"
          message="운영 통계를 새로고침하는 중입니다..."
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatCard
              title="전체 학급"
              value={summary.totalClasses}
              icon={School}
              tone="blue"
            />
            <StatCard
              title="전체 학생"
              value={summary.totalStudents}
              icon={Users}
              tone="indigo"
            />
            <StatCard
              title="최근 7일 활동"
              value={activityIndex.totalLogCount7d}
              icon={Zap}
              tone="amber"
            />
          </div>

          <Card>
            <Card.Header className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="text-emerald-500" size={20} />
                <div>
                  <Card.Title>시스템 활동 추이 (최근 7일)</Card.Title>
                  <Card.Description>
                    마지막 갱신 {formatTimestamp(activityIndex.generatedAt)}
                  </Card.Description>
                </div>
              </div>
            </Card.Header>

            <Card.Content noPadding className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#f1f5f9"
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="logs"
                    stroke="#6366f1"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card.Content>
          </Card>

          <RankingCard
            title="최근 7일 활동 순위"
            data={rankingPreview}
            onMore={() => setIsRankingModalOpen(true)}
          />

          <Alert
            type="info"
            message={`최근 7일 시스템 활동 추이와 학급 순위는 manualStatsSync 보정 결과를 기준으로 표시됩니다. 최근 7일 활성 학급 수는 ${activityIndex.activeClassCount7d.toLocaleString()}개입니다.`}
          />
        </SurfaceLoader>
      </div>

      <ClassActivityModal
        isOpen={isRankingModalOpen}
        onClose={() => setIsRankingModalOpen(false)}
        rankedClasses={activityIndex.rankedClasses}
        generatedAt={activityIndex.generatedAt}
      />
    </AppLayout>
  );
};

const StatCard = ({ title, value, icon: Icon, tone }) => (
  <Card
    variant="outline"
    className="flex flex-row items-center gap-5 p-6 shadow-sm"
  >
    <div
      className={`rounded-2xl p-4 ${STAT_ICON_STYLES[tone] || STAT_ICON_STYLES.blue}`}
    >
      <Icon size={28} />
    </div>
    <div>
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <h2 className="text-3xl font-black text-slate-800">
        {Number(value || 0).toLocaleString()}
      </h2>
    </div>
  </Card>
);

const RankingCard = ({ title, data, onMore }) => (
  <Card>
    <Card.Header className="flex flex-row items-center justify-between pb-2">
      <div className="flex items-center gap-2">
        <Trophy className="text-amber-500" size={20} />
        <Card.Title className="text-lg">{title}</Card.Title>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onMore}
        
      >
        더보기
        <ChevronRight size={14} />
      </Button>
    </Card.Header>

    <Card.Content noPadding>
      <div className="space-y-3">
        {data.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            최근 7일 활동 데이터가 없습니다.
          </p>
        ) : (
          data.map((classItem, index) => (
            <div
              key={classItem.classId || index}
              className="flex items-center justify-between rounded-xl bg-slate-50 p-3"
            >
              <div>
                <span className="text-sm font-bold text-slate-700">
                  {index + 1}. {getClassLabel(classItem)}
                </span>
                <p className="text-xs text-slate-400">
                  활동일 {Number(classItem?.recent7dActiveDays || 0)}일
                </p>
              </div>
              <span className="font-mono text-sm font-bold text-indigo-600">
                {getRecentActivityCount(classItem).toLocaleString()} logs
              </span>
            </div>
          ))
        )}
      </div>
    </Card.Content>
  </Card>
);

export default MasterDashboard;
