import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import DOMPurify from "dompurify";
import { AlertTriangle } from "lucide-react";
import { db } from "../../firebase";
import { useUser } from "../../contexts/UserContext";
import { usePopupNewsData } from "../../contexts/PopupNewsDataContext";
import { Modal, Button, InputField } from "../ui";

const toDateSafe = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const toMillisSafe = (value) => {
  const date = toDateSafe(value);
  return date ? date.getTime() : 0;
};

const isWithinRange = (startAt, endAt, now = new Date()) => {
  const start = toDateSafe(startAt);
  const end = toDateSafe(endAt);
  if (!start || !end) return false;
  return start <= now && now <= end;
};

const endOfToday = () => {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
};

const endOfDaysFromNow = (days) => {
  const n = Math.max(1, Number(days || 1));
  const now = new Date();
  now.setDate(now.getDate() + n);
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
};

const isTeacherRole = (role) => role === "teacher" || role === "admin";

const sanitizeUidList = (value) => {
  if (!Array.isArray(value)) return [];
  const unique = new Set(
    value
      .map((uid) => String(uid || "").trim())
      .filter((uid) => uid.length > 0),
  );
  return Array.from(unique);
};

const matchesPopupTarget = (popupNews, uid, role) => {
  const target = String(popupNews?.popupTarget || "all");
  if (target === "all") return true;
  if (target === "selected_students") {
    if (!uid) return false;
    return sanitizeUidList(popupNews?.popupTargetUids).includes(uid);
  }
  if (target === "teacher") return isTeacherRole(role);
  if (target === "student") return !isTeacherRole(role);
  return true;
};

const normalizePopupNews = (news) => {
  const popupMode =
    news.popupMode === "mandatory_phrase" ? "mandatory_phrase" : "dismissible";
  const popupVersion = Math.max(1, Number(news.popupVersion || 1));
  const popupTarget =
    news.popupTarget === "selected_students"
      ? "selected_students"
      : news.popupTarget === "student" || news.popupTarget === "teacher"
        ? news.popupTarget
        : "all";
  const popupDismissUntilType =
    news.popupDismissUntilType === "days" ||
    news.popupDismissUntilType === "until_end"
      ? news.popupDismissUntilType
      : "today";

  return {
    ...news,
    popupMode,
    popupVersion,
    popupTarget,
    popupTargetUids: sanitizeUidList(news.popupTargetUids),
    popupDismissUntilType,
    popupDismissDays: Math.max(1, Number(news.popupDismissDays || 1)),
    popupAckPhrase: String(news.popupAckPhrase || ""),
  };
};

const buildDismissDocId = ({ classId, newsId, popupVersion }) =>
  `${classId}_${newsId}_v${popupVersion}`;

const buildAckDocId = ({ classId, newsId, popupVersion }) =>
  `${classId}_${newsId}_v${popupVersion}`;

const buildSessionCloseKey = ({ classId, newsId, popupVersion }) =>
  `news_popup_closed_${classId}_${newsId}_v${popupVersion}`;

const getClassAckRef = ({ classId, uid, newsId, popupVersion }) =>
  doc(
    db,
    `classes/${classId}/students/${uid}/newsPopupAcks/${buildAckDocId({
      classId,
      newsId,
      popupVersion,
    })}`,
  );

const getClassDismissRef = ({ classId, uid, newsId, popupVersion }) =>
  doc(
    db,
    `classes/${classId}/students/${uid}/newsPopupDismissals/${buildDismissDocId({
      classId,
      newsId,
      popupVersion,
    })}`,
  );

const computeDismissUntil = (popupNews) => {
  const endAt = toDateSafe(popupNews.popupEndAt);
  let until = endOfToday();

  if (popupNews.popupDismissUntilType === "days") {
    until = endOfDaysFromNow(popupNews.popupDismissDays);
  } else if (popupNews.popupDismissUntilType === "until_end") {
    until = endAt || endOfToday();
  }

  if (endAt && until > endAt) return endAt;
  return until;
};

const getDismissButtonLabel = (popupNews) => {
  if (popupNews.popupDismissUntilType === "days") {
    return `${popupNews.popupDismissDays}일 동안 보지 않기`;
  }
  if (popupNews.popupDismissUntilType === "until_end") {
    return "종료일까지 보지 않기";
  }
  return "오늘 안 보기";
};

const getPopupPriorityWeight = (priority) => {
  if (priority === "high") return 2;
  if (priority === "medium") return 1;
  return 0;
};

const NewsPopupGate = () => {
  const { classId, userData } = useUser();
  const uid = userData?.uid;
  const role = userData?.role;
  const {
    newsList,
    readPopupStatus,
    rememberPopupStatus,
  } = usePopupNewsData();

  const [activePopupNews, setActivePopupNews] = useState(null);
  const [phraseInput, setPhraseInput] = useState("");
  const [processing, setProcessing] = useState(false);

  const isMandatory = activePopupNews?.popupMode === "mandatory_phrase";
  const dismissButtonLabel = useMemo(
    () =>
      activePopupNews ? getDismissButtonLabel(activePopupNews) : "오늘 안 보기",
    [activePopupNews],
  );

  const findNextPopupNews = useCallback(
    async (newsList) => {
      if (!classId || !uid) return null;

      const sorted = [...newsList]
        .filter((item) => !!item.popupEnabled)
        .map(normalizePopupNews)
        .sort((a, b) => {
          const aPriority = getPopupPriorityWeight(a.priority);
          const bPriority = getPopupPriorityWeight(b.priority);
          if (aPriority !== bPriority) return bPriority - aPriority;
          return toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt);
        });

      for (const popupNews of sorted) {
        if (
          popupNews.popupMode === "mandatory_phrase" &&
          isTeacherRole(role)
        ) {
          continue;
        }
        if (
          popupNews.popupMode === "dismissible" &&
          !isWithinRange(popupNews.popupStartAt, popupNews.popupEndAt)
        ) {
          continue;
        }
        if (!matchesPopupTarget(popupNews, uid, role)) {
          continue;
        }

        const sessionKey = buildSessionCloseKey({
          classId,
          newsId: popupNews.id,
          popupVersion: popupNews.popupVersion,
        });
        if (sessionStorage.getItem(sessionKey) === "1") {
          continue;
        }

        if (popupNews.popupMode === "mandatory_phrase") {
          if (!popupNews.popupAckPhrase.trim()) {
            continue;
          }
          const ackSnap = await readPopupStatus({
            kind: "ack",
            newsId: popupNews.id,
            popupVersion: popupNews.popupVersion,
          });
          if (ackSnap.exists) {
            continue;
          }
          return popupNews;
        }

        const dismissSnap = await readPopupStatus({
          kind: "dismiss",
          newsId: popupNews.id,
          popupVersion: popupNews.popupVersion,
        });
        if (dismissSnap.exists) {
          const dismissedUntil = toDateSafe(dismissSnap.data?.dismissedUntil);
          if (!dismissedUntil || dismissedUntil > new Date()) {
            continue;
          }
        }

        return popupNews;
      }

      return null;
    },
    [classId, uid, role, readPopupStatus],
  );

  useEffect(() => {
    if (!classId || !uid) {
      setActivePopupNews(null);
      return;
    }
    let cancelled = false;
    void findNextPopupNews(newsList).then((nextPopupNews) => {
      if (cancelled) return;
      setActivePopupNews(nextPopupNews);
      setPhraseInput("");
    });

    return () => {
      cancelled = true;
    };
  }, [classId, uid, findNextPopupNews, newsList]);

  if (!activePopupNews) return null;

  const handleSessionClose = () => {
    if (!activePopupNews || !classId) return;
    sessionStorage.setItem(
      buildSessionCloseKey({
        classId,
        newsId: activePopupNews.id,
        popupVersion: activePopupNews.popupVersion,
      }),
      "1",
    );
    setActivePopupNews(null);
  };

  const handleDismissPersist = async () => {
    if (!activePopupNews || !classId || !uid) return;
    setProcessing(true);

    try {
      const dismissedUntil = computeDismissUntil(activePopupNews);
      const dismissKey = {
        classId,
        uid,
        newsId: activePopupNews.id,
        popupVersion: activePopupNews.popupVersion,
      };

      await setDoc(
        getClassDismissRef(dismissKey),
        {
          classId,
          newsId: activePopupNews.id,
          popupVersion: activePopupNews.popupVersion,
          dismissedUntil,
          dismissedAt: serverTimestamp(),
          dismissRule: activePopupNews.popupDismissUntilType,
        },
        { merge: true },
      );

      rememberPopupStatus({
        kind: "dismiss",
        newsId: activePopupNews.id,
        popupVersion: activePopupNews.popupVersion,
        data: { dismissedUntil },
      });

      setActivePopupNews(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!activePopupNews || !classId || !uid) return;
    if (phraseInput.trim() !== activePopupNews.popupAckPhrase.trim()) return;

    setProcessing(true);
    try {
      const ackKey = {
        classId,
        uid,
        newsId: activePopupNews.id,
        popupVersion: activePopupNews.popupVersion,
      };

      await setDoc(
        getClassAckRef(ackKey),
        {
          classId,
          newsId: activePopupNews.id,
          popupVersion: activePopupNews.popupVersion,
          ackPhrase: activePopupNews.popupAckPhrase,
          ackedAt: serverTimestamp(),
        },
        { merge: true },
      );

      rememberPopupStatus({
        kind: "ack",
        newsId: activePopupNews.id,
        popupVersion: activePopupNews.popupVersion,
        data: { ackedAt: new Date() },
      });

      setActivePopupNews(null);
      setPhraseInput("");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={!!activePopupNews}
      onClose={isMandatory ? undefined : handleSessionClose}
      closeOnOverlayClick={!isMandatory}
      showDefaultCloseButton={!isMandatory}
      size="lg"
    >
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-100 text-rose-600">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-lg font-black text-slate-900">긴급 공지</h2>
            <p className="text-xs text-slate-500">
              {isMandatory
                ? "안내 문구를 정확히 입력해야 계속 진행할 수 있습니다."
                : "지금 바로 확인이 필요한 공지입니다."}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-base font-bold text-slate-900 mb-3">
            {activePopupNews.title || "제목 없음"}
          </h3>
          <div
            className="text-sm text-slate-700 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(activePopupNews.content || ""),
            }}
          />
        </div>

        {isMandatory ? (
          <div className="space-y-3">
            <InputField
              label="확인 문구 입력"
              value={phraseInput}
              onChange={(event) => setPhraseInput(event.target.value)}
              placeholder={activePopupNews.popupAckPhrase || ""}
            />
            <p className="text-xs text-slate-500">
              아래 문구를 그대로 입력하세요:{" "}
              <span className="font-semibold text-slate-700">
                {activePopupNews.popupAckPhrase}
              </span>
            </p>
            <div className="flex justify-end">
              <Button
                tone="indigo"
                onClick={handleAcknowledge}
                isLoading={processing}
                disabled={
                  processing ||
                  phraseInput.trim() !== activePopupNews.popupAckPhrase.trim()
                }
              >
                확인하고 계속
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={handleSessionClose}
              disabled={processing}
            >
              닫기
            </Button>
            <Button
              tone="blue"
              onClick={handleDismissPersist}
              isLoading={processing}
              disabled={processing}
            >
              {dismissButtonLabel}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default NewsPopupGate;
