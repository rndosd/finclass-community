import missionIllustration from "../../../assets/dashboard/home-mission-v2.webp";
import { HomeCardFrame, HomeCardHeading, HomeCardAction } from "./HomeCardChrome";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Spinner } from "../../../components/ui";
import { CaretRightIcon, TargetIcon } from "@phosphor-icons/react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useNavigate } from "react-router-dom";
import { db, functions } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { isAlwaysAvailableOnDay, isWithinAlwaysTimeRange } from "../../missions/utils/alwaysMissionState";
const DASHBOARD_MISSION_SUMMARY_ID = "missions";
const COMPLETED_STATUSES = new Set(["approved", "late-approved"]);
const PENDING_STATUSES = new Set(["pending", "late"]);
const ACTION_PRIORITY = {
  urgent: 0,
  overdue: 1,
  available: 2,
  always: 3
};
const EMPTY_SUMMARY = {
  visibleActions: [],
  extraActionCount: 0,
  regularCompleted: 0,
  regularTotal: 0
};
const BACKFILLABLE_SUMMARY_SOURCES = new Set(["needs_backfill", "summary_error"]);
const toDate = value => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const getMissionTitle = title => typeof title === "string" && title.trim() ? title.trim() : "과제";
const classifyRegularMissionEntry = (mission, now) => {
  const status = mission?.completionStatus || null;
  const start = toDate(mission?.startAt);
  const end = toDate(mission?.endAt);
  if (COMPLETED_STATUSES.has(status)) return "completed";
  if (PENDING_STATUSES.has(status)) return "pending";
  if (start && start > now) return "upcoming";
  if (end && end <= now) return "overdue";
  if (end && (end - now) / 36e5 <= 24) return "urgent";
  return "available";
};
const normalizeMissionSummaryData = data => {
  const regularMissions = Array.isArray(data?.regularMissions) ? data.regularMissions.filter(mission => mission && mission.id).map(mission => ({
    id: mission.id,
    title: getMissionTitle(mission?.title),
    startAt: mission?.startAt ?? null,
    endAt: mission?.endAt ?? null,
    completionStatus: mission?.completionStatus || null
  })) : [];
  const alwaysMissions = Array.isArray(data?.alwaysMissions) ? data.alwaysMissions.filter(mission => mission && mission.id).map(mission => ({
    id: mission.id,
    title: getMissionTitle(mission?.title),
    isActive: typeof mission?.isActive === "boolean" ? mission.isActive : true,
    availability: mission?.availability || {}
  })) : [];
  const completedMissionCount = regularMissions.filter(mission => COMPLETED_STATUSES.has(mission.completionStatus)).length;
  const configuredTotal = Number(data?.regularTotal);
  const configuredCompleted = Number(data?.regularCompleted);
  const regularTotal = Number.isFinite(configuredTotal) ? Math.max(0, configuredTotal) : regularMissions.length;
  const regularCompleted = Number.isFinite(configuredCompleted) ? Math.max(0, configuredCompleted) : completedMissionCount;
  return {
    regularMissions,
    alwaysMissions,
    regularTotal,
    regularCompleted: Math.min(regularCompleted, regularTotal)
  };
};
const buildMissionCardSummary = ({
  regularMissions = [],
  alwaysMissions = [],
  regularCompleted = 0,
  regularTotal = 0
}) => {
  const now = new Date();
  const actionCandidates = [];
  regularMissions.forEach(mission => {
    const kind = classifyRegularMissionEntry(mission, now);
    if (!["available", "urgent", "overdue"].includes(kind)) return;
    actionCandidates.push({
      id: mission.id,
      title: getMissionTitle(mission?.title),
      type: kind,
      end: toDate(mission?.endAt)
    });
  });
  alwaysMissions.forEach(mission => {
    const availability = mission?.availability || {};
    const isActive = typeof mission?.isActive === "boolean" ? mission.isActive : true;
    const canDoNow = isActive && isAlwaysAvailableOnDay(availability) && isWithinAlwaysTimeRange(availability);
    if (!canDoNow) return;
    actionCandidates.push({
      id: mission.id,
      title: getMissionTitle(mission?.title),
      type: "always",
      end: null
    });
  });
  const sorted = [...actionCandidates].sort((a, b) => {
    const pA = ACTION_PRIORITY[a.type] ?? 99;
    const pB = ACTION_PRIORITY[b.type] ?? 99;
    if (pA !== pB) return pA - pB;
    const tA = a.end ? a.end.getTime() : Number.MAX_SAFE_INTEGER;
    const tB = b.end ? b.end.getTime() : Number.MAX_SAFE_INTEGER;
    return tA - tB;
  });
  return {
    visibleActions: sorted.slice(0, 3),
    extraActionCount: Math.max(0, sorted.length - 3),
    regularCompleted,
    regularTotal
  };
};
const readDashboardMissionSummary = async (classId, uid) => {
  if (!classId || !uid) return null;
  const summaryRef = doc(db, `classes/${classId}/students/${uid}/dashboardSummary/${DASHBOARD_MISSION_SUMMARY_ID}`);
  const summarySnap = await getDoc(summaryRef);
  if (!summarySnap.exists()) return null;
  const data = summarySnap.data() || {};
  const hasPayload = Array.isArray(data?.regularMissions) || Array.isArray(data?.alwaysMissions) || Number.isFinite(Number(data?.regularTotal)) || Number.isFinite(Number(data?.regularCompleted));
  return hasPayload ? data : null;
};
const fetchMissionCardData = async (classId, uid) => {
  if (!classId || !uid) return {
    source: "empty",
    data: null
  };
  try {
    const summaryData = await readDashboardMissionSummary(classId, uid);
    if (summaryData) {
      return {
        source: "summary",
        data: summaryData
      };
    }
  } catch (error) {
    console.error("[HomeMissionCard] summary fetch failed:", error);
    return {
      source: "summary_error",
      data: null
    };
  }
  return {
    source: "needs_backfill",
    data: null
  };
};
const formatRemainingTime = date => {
  if (!date) return "상시";
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs >= 0) {
    if (diffMs < minuteMs) return "곧 마감";
    if (diffMs < hourMs) return `${Math.ceil(diffMs / minuteMs)}분 남음`;
    if (diffMs < dayMs) return `${Math.ceil(diffMs / hourMs)}시간 남음`;
    return `${Math.ceil(diffMs / dayMs)}일 남음`;
  }
  if (absMs < minuteMs) return "방금 지남";
  if (absMs < hourMs) return `${Math.ceil(absMs / minuteMs)}분 지남`;
  if (absMs < dayMs) return `${Math.ceil(absMs / hourMs)}시간 지남`;
  return `${Math.ceil(absMs / dayMs)}일 지남`;
};
const getRemainingTone = action => {
  if (action?.type === "always" || !action?.end) {
    return "bg-emerald-100 text-emerald-700";
  }
  const diffMs = action.end.getTime() - Date.now();
  if (diffMs <= 0) return "bg-rose-100 text-rose-700";
  if (diffMs <= 24 * 60 * 60 * 1000) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
};
const HomeMissionCard = ({
  displayVariant = "featured"
}) => {
  const {
    classId,
    userData,
    loading: userLoading
  } = useUser();
  const uid = userData?.uid || null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestedBackfillRef = useRef(new Set());
  const [isBackfillPending, setIsBackfillPending] = useState(false);
  const {
    data: missionCardData,
    isLoading
  } = useQuery({
    queryKey: ["dashboardMissionCard", classId, uid],
    queryFn: () => fetchMissionCardData(classId, uid),
    enabled: !userLoading && !!classId && !!uid,
    staleTime: 1000 * 60 * 3,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false
  });
  useEffect(() => {
    if (userLoading || !classId || !uid || !BACKFILLABLE_SUMMARY_SOURCES.has(missionCardData?.source)) {
      setIsBackfillPending(false);
      return;
    }
    const requestKey = `${classId}:${uid}`;
    if (requestedBackfillRef.current.has(requestKey)) {
      return;
    }
    requestedBackfillRef.current.add(requestKey);
    setIsBackfillPending(true);
    const backfillSummary = httpsCallable(functions, "backfillMissionDashboardSummary");
    backfillSummary({
      classId
    }).then(() => queryClient.invalidateQueries({
      queryKey: ["dashboardMissionCard", classId, uid]
    })).catch(error => {
      console.error("[HomeMissionCard] summary backfill failed:", error);
      requestedBackfillRef.current.delete(requestKey);
    }).finally(() => {
      setIsBackfillPending(false);
    });
  }, [classId, uid, userLoading, missionCardData?.source, queryClient]);
  const summary = useMemo(() => {
    if (!uid || !missionCardData) return EMPTY_SUMMARY;
    if (missionCardData.source === "summary") {
      return buildMissionCardSummary(normalizeMissionSummaryData(missionCardData.data));
    }
    return EMPTY_SUMMARY;
  }, [missionCardData, uid]);
  const loading = userLoading || isLoading || isBackfillPending;
  return <HomeCardFrame type="mission" displayVariant={displayVariant}>
    <HomeCardHeading icon={TargetIcon}>오늘의 과제</HomeCardHeading>
    <img className="fc-home-art fc-home-mission-art" src={missionIllustration} alt="" decoding="async" />
    {loading ? <div className="fc-home-empty"><Spinner size="md" /></div> : <>
      <div className="fc-home-mission-list">{summary.visibleActions.length ? <>
        {summary.visibleActions.map(action => <button type="button" onClick={() => navigate("/missions")} key={action.id}><strong>{action.title}</strong><span className={"fc-home-deadline " + getRemainingTone(action)}>{formatRemainingTime(action.end)}</span></button>)}

      </> : <div className="fc-home-empty"><p className="font-bold">지금 진행할 과제가 없습니다.</p><p className="mt-2 text-xs">새 과제는 과제 페이지에서 확인할 수 있어요.</p><p className="mt-4 text-xs">등록 과제 {summary.regularTotal}개 · 완료한 과제 {summary.regularCompleted}개</p></div>}</div>
{summary.extraActionCount > 0 && <button type="button" className="fc-home-more" onClick={() => navigate("/missions")}>+ {summary.extraActionCount}개 더 보기</button>}
      <HomeCardAction icon={CaretRightIcon} onClick={() => navigate("/missions")}>과제 보러 가기</HomeCardAction>
    </>}
  </HomeCardFrame>;
};
export default HomeMissionCard;
