import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Pencil,
  Timer,
} from "lucide-react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { Modal, Button } from "../ui";
import { useUser } from "../../contexts/UserContext";
import SurveyRenderer from "./SurveyRenderer";
import SurveyResults from "./SurveyResults";
import SurveyExtension from "./SurveyExtension";

function toDateValue(value) {
  if (!value) return null;
  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

function formatRemainingDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");

  if (days > 0) return `D-${days} ${hh}:${mm}`;
  return `${hh}:${mm}`;
}

const SurveyLauncher = ({
  surveyId,
  classId: classIdProp,
  userId: userIdProp,
  newsId,
}) => {
  const { classId: classIdCtx, userData, isTeacher, isAdmin } = useUser();

  const classId = classIdProp || classIdCtx;
  const userId = userIdProp || userData?.uid;
  const userName = userData?.name || userData?.displayName || "";

  const [open, setOpen] = useState(false);
  const [openResults, setOpenResults] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [survey, setSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [checking, setChecking] = useState(true);
  const [nowTs, setNowTs] = useState(Date.now());

  const surveyRef = useMemo(() => {
    if (!classId || !surveyId) return null;
    return doc(db, `classes/${classId}/surveys/${surveyId}`);
  }, [classId, surveyId]);

  const myRespRef = useMemo(() => {
    if (!classId || !surveyId || !userId) return null;
    return doc(db, `classes/${classId}/surveys/${surveyId}/responses/${userId}`);
  }, [classId, surveyId, userId]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        if (!surveyRef) return;

        const snap = await getDoc(surveyRef);
        if (!alive) return;
        if (snap.exists()) setSurvey(snap.data());
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [surveyRef]);

  useEffect(() => {
    if (!myRespRef) {
      setChecking(false);
      return;
    }

    setChecking(true);
    const unsub = onSnapshot(
      myRespRef,
      (snap) => {
        setSubmitted(snap.exists());
        setChecking(false);
      },
      () => setChecking(false),
    );

    return () => unsub();
  }, [myRespRef]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now());
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onSurveyUpdated = async (event) => {
      if (event?.detail?.surveyId !== surveyId || !surveyRef) return;
      try {
        const snap = await getDoc(surveyRef);
        if (snap.exists()) setSurvey(snap.data());
      } catch (error) {
        console.error(error);
      }
    };

    document.addEventListener("surveyUpdated", onSurveyUpdated);
    return () => document.removeEventListener("surveyUpdated", onSurveyUpdated);
  }, [surveyId, surveyRef]);

  if (loading || !survey) {
    return (
      <div className="border rounded-2xl p-4 bg-white shadow-sm">
        <div className="animate-pulse h-4 w-40 bg-gray-200 rounded mb-2" />
        <div className="h-3 w-24 bg-gray-100 rounded" />
      </div>
    );
  }

  const { title = "제목 없는 설문", description, isActive = true } = survey;
  const ownerUid = survey.ownerUid || survey.createdBy || null;
  const isOwner = !!userId && !!ownerUid && ownerUid === userId;
  const canManageSurvey = isTeacher || isAdmin || isOwner;
  const responseCount = Number(survey.responseCount || 0);
  const deadline = survey.deadline;
  const deadlineDate = toDateValue(deadline);
  const isAfterDeadline = !!deadlineDate && nowTs > deadlineDate.getTime();
  const isClosed = !isActive || isAfterDeadline;
  const remainingMs = deadlineDate ? Math.max(0, deadlineDate.getTime() - nowTs) : 0;
  const deadlineStatusText = (() => {
    if (!deadlineDate) return isClosed ? "마감됨" : "";
    if (isClosed) return "마감됨";
    return formatRemainingDuration(remainingMs);
  })();

  const canViewResults = (() => {
    if (!survey || !userId) return false;
    if (canManageSurvey) return true;

    const release = survey.resultsRelease || "after_deadline";
    if (release === "after_deadline") {
      if (!isClosed) return false;
    } else if (!submitted) {
      return false;
    }

    const wl = Array.isArray(survey.resultsWhitelistUids)
      ? survey.resultsWhitelistUids
      : [];
    if (wl.length === 0) return true;
    return wl.includes(userId);
  })();

  const userForResults = {
    uid: userId,
    role: isTeacher ? "teacher" : isAdmin ? "admin" : isOwner ? "owner" : "student",
    name: userName,
  };

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 rounded-xl bg-blue-100 p-2">
              <BarChart3 className="w-4 h-4 text-blue-700" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate">{title}</div>
              {!!description && (
                <div className="text-xs text-slate-500 line-clamp-2 mt-1">{description}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!!deadlineStatusText && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                  isClosed
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
                title={isClosed ? "설문이 마감되었습니다." : "자동 마감까지 남은 시간"}
              >
                <Timer className="h-3.5 w-3.5" />
                {isClosed ? "마감됨" : deadlineStatusText}
              </span>
            )}

            {canManageSurvey && (
              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700">
                응답 {responseCount}건
              </span>
            )}

            {canManageSurvey && (
              <Button
                size="icon-sm"
                variant="secondary"
                onClick={() => setOpenEdit(true)}
                title="설문 수정"
                aria-label="설문 수정"
              >
                <Pencil className="w-4 h-4" />
              </Button>
            )}

            <Button
              size={canManageSurvey ? "icon-sm" : "sm"}
              variant="secondary"
              onClick={() => setOpenResults(true)}
              disabled={!canViewResults}
              title={canManageSurvey
                ? (canViewResults ? "응답 확인" : "응답을 확인할 수 없습니다.")
                : (canViewResults ? "결과를 확인합니다." : "결과를 확인할 수 없습니다.")}
              aria-label={canManageSurvey ? "응답 확인" : "결과 보기"}
            >
              <BarChart2 className={`w-4 h-4 ${canManageSurvey ? "" : "mr-1"}`} />
              {!canManageSurvey && "결과 보기"}
            </Button>

            {submitted ? (
              <span className="inline-flex items-center text-emerald-600 text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                제출 완료
              </span>
            ) : (
              <Button
                size="sm"
                disabled={checking || (!canManageSurvey && isClosed)}
                onClick={() => setOpen(true)}
                tone="blue"
              >
                설문 참여
              </Button>
            )}
          </div>
        </div>

        {canManageSurvey && (
          <div className="mt-3 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            <ClipboardCheck className="w-3.5 h-3.5" />
            응답이 도착하면 여기에서 바로 확인할 수 있습니다.
          </div>
        )}
      </div>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <span className="truncate">{title}</span>
          </div>
        }
        size="lg"
      >
        <div className="max-h-[75vh] overflow-y-auto">
          <SurveyRenderer
            surveyId={surveyId}
            newsId={newsId}
            classId={classId}
            userId={userId}
            userName={userName}
            ignoreSurveyConditions={canManageSurvey}
            variant="bare"
            showHeader={false}
            onSubmitted={() => {
              setSubmitted(true);
              setOpen(false);
            }}
          />
        </div>
      </Modal>

      <Modal
        isOpen={openResults}
        onClose={() => setOpenResults(false)}
        title={
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-blue-600" />
            <span className="truncate">설문 결과 · {title}</span>
          </div>
        }
        size="xl"
      >
        <div className="max-h-[75vh] overflow-y-auto">
          <SurveyResults
            surveyId={surveyId}
            classId={classId}
            user={userForResults}
            hasSubmittedThisSurvey={submitted}
          />
        </div>
      </Modal>

      <Modal
        isOpen={openEdit}
        onClose={() => setOpenEdit(false)}
        title={
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-blue-600" />
            <span className="truncate">설문 수정</span>
          </div>
        }
        size="xl"
      >
        <div className="max-h-[75vh] overflow-y-auto">
          <SurveyExtension
            editingSurvey={{ ...(survey || {}), id: survey?.id || surveyId }}
            classId={classId}
            userId={userId}
            onClose={() => setOpenEdit(false)}
          />
        </div>
      </Modal>
    </>
  );
};

export default SurveyLauncher;
