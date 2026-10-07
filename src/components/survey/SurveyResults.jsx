// src/components/survey/SurveyResults.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { formatDateKeyInKST } from "../../utils/kstDate";
import {
  BarChart3,
  Lock,
  Users,
  Calendar,
  Eye,
  Download,
  PieChart,
  Star,
  TrendingUp,
  MessageSquare,
} from "lucide-react";
import Spinner from "../ui/Spinner";
import { Button } from "../ui";
import QuestionCard from "./QuestionCard";

/* =========================
   ?????????????
   ========================= */

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

function _isAfterDeadline(deadline) {
  const date = toDateValue(deadline);
  if (!date) return false;
  return Date.now() > date.getTime();
}

function _isWhitelistOpenToAll(resultsWhitelistUids) {
  return !resultsWhitelistUids || resultsWhitelistUids.length === 0;
}

function _canViewResults({ user, survey, hasSubmitted }) {
  if (!survey || !user) return false;
  const ownerUid = survey.ownerUid || survey.createdBy;
  if (
    user.role === "teacher" ||
    user.role === "admin" ||
    user.role === "owner" ||
    (ownerUid && user.uid && ownerUid === user.uid)
  ) {
    return true;
  }

  const mode = survey.resultsRelease || "after_deadline";
  const isClosed = survey.isActive === false || _isAfterDeadline(survey.deadline);
  if (mode === "after_deadline") {
    if (!isClosed) return false;
  } else {
    if (!hasSubmitted) return false;
  }

  const minN = Number(survey.minResponsesToShow ?? 0);
  if ((survey.responseCount || 0) < minN) return false;

  if (_isWhitelistOpenToAll(survey.resultsWhitelistUids)) return true;
  return (survey.resultsWhitelistUids || []).includes(user.uid);
}

function getQuestionTypeInfo(type) {
  const icons = {
    multiple_choice: <PieChart className="w-4 h-4" />,
    rating: <Star className="w-4 h-4" />,
    scale: <TrendingUp className="w-4 h-4" />,
    text: <MessageSquare className="w-4 h-4" />,
  };

  return {
    icon: icons[type] || <BarChart3 className="w-4 h-4" />,
    label: type,
  };
}

function formatDateTime(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleString("ko-KR") : "-";
}

function normalizeAnswerList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeAnswerList(item))
      .filter((item) => item !== "");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }
  return [toTextCell(value)];
}

function tokenizeText(value) {
  if (!value) return [];
  return String(value)
    .toLowerCase()
    .split(/[\s,.;:!?/()[\]{}"'`~<>@#$%^&*+=|\\-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

// Legacy client-side summary rebuild is intentionally kept out of the main flow.
// eslint-disable-next-line no-unused-vars
function buildSummaryFromResponses(questions, rows) {
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const questionSummary = {};

  safeQuestions.forEach((q) => {
    if (!q?.id) return;
    const base = {
      type: q.type || "text",
      title: q.question || "질문",
    };

    if (q.type === "multiple_choice") {
      const optionCounts = {};
      (q.options || []).forEach((opt) => {
        if (opt !== null && opt !== undefined && String(opt).trim() !== "") {
          optionCounts[String(opt)] = 0;
        }
      });
      questionSummary[q.id] = { ...base, optionCounts };
      return;
    }

    if (q.type === "rating") {
      questionSummary[q.id] = {
        ...base,
        ratingCounts: {},
        average: 0,
        sampleCount: 0,
      };
      return;
    }

    if (q.type === "scale") {
      questionSummary[q.id] = { ...base, scaleBuckets: {} };
      return;
    }

    questionSummary[q.id] = { ...base, sampleCount: 0, topKeywords: {} };
  });

  safeRows.forEach((row) => {
    const answers = row?.responses || {};
    safeQuestions.forEach((q) => {
      if (!q?.id) return;
      const raw = answers[q.id];
      if (raw === null || raw === undefined || raw === "") return;
      const qsum = questionSummary[q.id];
      if (!qsum) return;

      if (q.type === "multiple_choice") {
        normalizeAnswerList(raw).forEach((answer) => {
          qsum.optionCounts[answer] = (qsum.optionCounts[answer] || 0) + 1;
        });
        return;
      }

      if (q.type === "rating") {
        const score = Number(Array.isArray(raw) ? raw[0] : raw);
        if (!Number.isFinite(score)) return;
        const key = String(score);
        qsum.ratingCounts[key] = (qsum.ratingCounts[key] || 0) + 1;
        qsum.sampleCount += 1;
        qsum.average += score;
        return;
      }

      if (q.type === "scale") {
        normalizeAnswerList(raw).forEach((answer) => {
          qsum.scaleBuckets[answer] = (qsum.scaleBuckets[answer] || 0) + 1;
        });
        return;
      }

      const text = toTextCell(raw).trim();
      if (!text) return;
      qsum.sampleCount += 1;
      tokenizeText(text).forEach((token) => {
        qsum.topKeywords[token] = (qsum.topKeywords[token] || 0) + 1;
      });
    });
  });

  Object.values(questionSummary).forEach((qsum) => {
    if (qsum.type === "rating") {
      if (qsum.sampleCount > 0) {
        qsum.average = qsum.average / qsum.sampleCount;
      } else {
        delete qsum.average;
      }
    }

    if (qsum.type === "text") {
      qsum.topKeywords = Object.fromEntries(
        Object.entries(qsum.topKeywords || {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 12)
      );
    }
  });

  return {
    responseCount: safeRows.length,
    questions: questionSummary,
  };
}

function toDisplayAnswer(rawValue, question) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "-";

  if (question?.type === "multiple_choice") {
    const options = Array.isArray(question?.options) ? question.options : [];
    const formatOption = (value) => {
      if (typeof value === "number" && options[value] !== undefined) {
        return String(options[value]);
      }
      return String(value);
    };

    if (Array.isArray(rawValue)) {
      const text = rawValue.map((item) => formatOption(item)).join(", ");
      return text || "-";
    }

    return formatOption(rawValue);
  }

  if (question?.type === "rating") {
    const score = Number(rawValue);
    return Number.isFinite(score) ? `${score}점` : toTextCell(rawValue);
  }

  if (Array.isArray(rawValue)) return rawValue.map((v) => String(v)).join(", ");
  return toTextCell(rawValue);
}

function toTextCell(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(" | ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsvCell(value) {
  const text = toTextCell(value).replaceAll('"', '""');
  return `"${text}"`;
}

/* =========================
   ?????????椰???????????????????????????됰뼸???
   ========================= */

export default function SurveyResults({
  classId,
  surveyId,
  user,
  hasSubmittedThisSurvey = false,
}) {
  const [survey, setSurvey] = useState(null);
  const [summary, setSummary] = useState(null);
  const [responses, setResponses] = useState([]);
  const [namesByUid, setNamesByUid] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [error, setError] = useState(null);
  const [expandedQuestions, setExpandedQuestions] = useState(new Set());
  const [activeTab, setActiveTab] = useState("overview");
  const [responseSearchQuery, setResponseSearchQuery] = useState("");

  const surveyRef = useMemo(() => {
    if (!classId || !surveyId) return null;
    return doc(db, `classes/${classId}/surveys/${surveyId}`);
  }, [classId, surveyId]);

  const summaryRef = useMemo(() => {
    if (!classId || !surveyId) return null;
    return doc(db, `classes/${classId}/surveys/${surveyId}/stats/summary`);
  }, [classId, surveyId]);

  // ??????????椰?????????癲됱빖???嶺????????????????傭?끆???????
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!surveyRef) {
        setError("???????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const [surveySnap, summarySnap] = await Promise.all([
          getDoc(surveyRef),
          summaryRef ? getDoc(summaryRef) : Promise.resolve(null),
        ]);
        if (!mounted) return;
        if (!surveySnap.exists()) {
          setError("???????????????????? ???????????????????살몝??");
          setLoading(false);
          return;
        }
        setSurvey(surveySnap.data());
        setSummary(summarySnap?.exists() ? summarySnap.data() : null);
      } catch (e) {
        console.error(e);
        if (mounted) setError("?????癲ル슢?싩땟??????????????????? ????????????????? ??????椰????????????????????");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [surveyRef, summaryRef]);

  const canView = useMemo(() => {
    return _canViewResults({
      user: user || {},
      survey: survey || {},
      hasSubmitted: !!hasSubmittedThisSurvey,
    });
  }, [user, survey, hasSubmittedThisSurvey]);

  const showIdentifiable =
    !!survey?.exposeIdentifiableResponses &&
    (user?.role === "teacher" || user?.role === "admin" || canView);

  const effectiveSummary = summary?.questions ? summary : null;
  const responseCount =
    effectiveSummary?.responseCount ?? Number(survey?.responseCount || 0);
  const questionEntries = useMemo(() => {
    const questions = effectiveSummary?.questions;
    return questions ? Object.entries(questions) : [];
  }, [effectiveSummary?.questions]);
  const questionMap = useMemo(() => {
    const map = {};
    const questions = Array.isArray(survey?.questions) ? survey.questions : [];
    questions.forEach((q) => {
      if (q?.id) map[q.id] = q;
    });
    return map;
  }, [survey?.questions]);
  const deadlineText = formatDateTime(survey?.deadline);
  const isDeadlinePassed = _isAfterDeadline(survey?.deadline);
  const isManualClosed = survey?.isActive === false;
  const isClosed = isManualClosed || isDeadlinePassed;
  const searchKeyword = responseSearchQuery.trim().toLowerCase();
  const filteredResponses = useMemo(() => {
    if (!searchKeyword) return responses;

    return responses.filter((r) => {
      const nameText = String(namesByUid[r.userId] || r.userName || "").toLowerCase();
      if (nameText.includes(searchKeyword)) return true;

      const answerText = Object.entries(r.responses || {})
        .map(([qid, value]) => {
          const questionLabel = questionMap[qid]?.question || qid || "";
          return `${questionLabel} ${toTextCell(value)}`;
        })
        .join(" ")
        .toLowerCase();

      return answerText.includes(searchKeyword);
    });
  }, [searchKeyword, responses, namesByUid, questionMap]);

  // ???????????????????????????????傭?끆???????
  useEffect(() => {
    let mounted = true;
    const loadResponsesIfNeeded = async () => {
      if (
        !canView ||
        !classId ||
        !surveyId ||
        activeTab !== "responses" ||
        !showIdentifiable
      ) {
        if (mounted) {
          setLoadingResponses(false);
          setResponses([]);
          setNamesByUid({});
        }
        return;
      }

      try {
        setLoadingResponses(true);
        const respCol = collection(
          db,
          `classes/${classId}/surveys/${surveyId}/responses`
        );
        const snap = await getDocs(respCol);
        if (!mounted) return;
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        setResponses(rows);

        const uids = Array.from(
          new Set(rows.map((r) => r.userId).filter(Boolean))
        );
        if (uids.length) {
          const studentsCol = collection(db, `classes/${classId}/students`);
          const chunks = [];
          for (let i = 0; i < uids.length; i += 10) {
            chunks.push(uids.slice(i, i + 10));
          }
          const nameEntries = {};
          for (const chunk of chunks) {
            const q = query(studentsCol, where("__name__", "in", chunk));
            const ss = await getDocs(q);
            ss.forEach((docSnap) => {
              const d = docSnap.data();
              nameEntries[docSnap.id] = d.name || d.displayName || "";
            });
          }
          if (mounted) setNamesByUid(nameEntries);
        } else {
          setNamesByUid({});
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoadingResponses(false);
      }
    };
    loadResponsesIfNeeded();
    return () => {
      mounted = false;
    };
  }, [activeTab, canView, showIdentifiable, classId, surveyId]);

  useEffect(() => {
    if (activeTab !== "questions") return;
    if (!questionEntries.length) return;
    if (expandedQuestions.size > 0) return;
    setExpandedQuestions(new Set(questionEntries.map(([qid]) => qid)));
  }, [activeTab, questionEntries, expandedQuestions.size]);

  const toggleQuestion = (qid) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) {
        next.delete(qid);
      } else {
        next.add(qid);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (effectiveSummary?.questions) {
      setExpandedQuestions(new Set(Object.keys(effectiveSummary.questions)));
    }
  };

  const collapseAll = () => {
    setExpandedQuestions(new Set());
  };

  const handleDownloadResponsesCsv = () => {
    if (!responses.length) return;

    const questions = Array.isArray(survey?.questions) ? survey.questions : [];
    const header = ["이름", "제출 시각", ...questions.map((q) => q.question || q.id)];

    const rows = responses.map((r) => {
      const submittedAt = formatDateTime(r.submittedAt);
      const answers = questions.map((q) => toTextCell(r.responses?.[q.id]));
      return [namesByUid[r.userId] || r.userName || "", submittedAt, ...answers];
    });

    const csvLines = [header, ...rows]
      .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\r\n");

    const blob = new Blob([`\uFEFF${csvLines}`], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const dateStamp = formatDateKeyInKST(new Date()).replaceAll("-", "");
    anchor.href = url;
    anchor.download = `설문응답_${dateStamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="p-6 border-2 border-blue-200 rounded-xl bg-blue-50">
        <div className="flex justify-center">
          <Spinner size="sm" tone="blue" />
        </div>
        <p className="text-center text-sm text-gray-600 mt-2">결과를 불러오는 중...</p>
      </div>
    );
  }

  if (error || !survey) {
    return (
      <div className="p-6 border-2 border-red-200 rounded-xl bg-red-50 text-red-700">
        {error || "설문 결과를 표시할 수 없습니다."}
      </div>
    );
  }

  if (!canView && !(user?.role === "teacher" || user?.role === "admin")) {
    return (
      <div className="p-6 border rounded-xl bg-gray-50 text-gray-700">
        <div className="flex items-center gap-2 font-medium">
          <Lock className="w-4 h-4" />
          아직 결과를 볼 수 없어요.
        </div>
        <ul className="list-disc ml-5 mt-2 text-sm text-gray-600">
          <li>선생님과 관리자는 결과를 볼 수 있어요.</li>
          <li>결과 공개 시간이 되어야 해요.</li>
          <li>정해진 수만큼 응답이 모여야 해요.</li>
          <li>공개 대상이 정해져 있다면 그 대상에 포함되어야 해요.</li>
        </ul>
      </div>
    );
  }

  const title = survey.title || "설문 결과";

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <BarChart3 className="w-8 h-8" />
          <h2 className="text-2xl font-bold">{title}</h2>
        </div>
        <p className="text-blue-100 text-sm">설문 결과 분석 대시보드</p>
      </div>

      <div className="flex gap-2 border-b-2 border-gray-200">
        <Button variant="ghost" kind="ghost"
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 font-medium transition-colors relative ${
            activeTab === "overview"
              ? "text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          요약
          {activeTab === "overview" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
          )}
        </Button>

        <Button variant="ghost" kind="ghost"
          onClick={() => setActiveTab("questions")}
          className={`px-4 py-2 font-medium transition-colors relative ${
            activeTab === "questions"
              ? "text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          질문별 결과
          {activeTab === "questions" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
          )}
        </Button>

        {showIdentifiable && (
          <Button variant="ghost" kind="ghost"
            onClick={() => setActiveTab("responses")}
            className={`px-4 py-2 font-medium transition-colors relative ${
              activeTab === "responses"
                ? "text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            개별 응답
            {activeTab === "responses" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
            )}
          </Button>
        )}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-5 shadow-md border-l-4 border-blue-500">
              <div className="flex items-center gap-3 mb-2">
                <Users className="w-5 h-5 text-blue-600" />
                <div className="text-xs text-gray-500 font-medium">응답 수</div>
              </div>
              <div className="text-3xl font-bold text-gray-900">{responseCount}</div>
            </div>

            <div className="bg-white rounded-xl p-5 shadow-md border-l-4 border-green-500">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="w-5 h-5 text-green-600" />
                <div className="text-xs text-gray-500 font-medium">공개 시점</div>
              </div>
              <div className="text-lg font-semibold text-gray-900">
                {survey.resultsRelease === "after_deadline"
                  ? "마감(자동/수동) 후 공개"
                  : "제출 후 공개"}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {survey.resultsRelease === "after_deadline"
                  ? `기준: ${
                      isClosed ? "마감됨" : "진행 중"
                    } (${isManualClosed ? "수동 마감" : `자동 마감: ${deadlineText}`})`
                  : "기준: 제출 즉시 공개"}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 shadow-md border-l-4 border-purple-500">
              <div className="flex items-center gap-3 mb-2">
                <Eye className="w-5 h-5 text-purple-600" />
                <div className="text-xs text-gray-500 font-medium">공개 대상</div>
              </div>
              <div className="text-lg font-semibold text-gray-900">
                {_isWhitelistOpenToAll(survey.resultsWhitelistUids)
                  ? "전체"
                  : `${survey.resultsWhitelistUids?.length || 0}명`}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 shadow-md border-l-4 border-orange-500">
              <div className="flex items-center gap-3 mb-2">
                <Lock className="w-5 h-5 text-orange-600" />
                <div className="text-xs text-gray-500 font-medium">식별 가능 정보</div>
              </div>
              <div className="text-lg font-semibold text-gray-900">
                {survey.exposeIdentifiableResponses ? "공개" : "비공개"}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-md">
            <h3 className="text-lg font-bold text-gray-900 mb-4">질문 요약</h3>
            {questionEntries.length === 0 ? (
              <div className="space-y-2 text-sm text-gray-500">
                <div>집계 데이터가 아직 없습니다.</div>
                <div>summary가 준비되면 차트와 질문별 요약이 표시됩니다.</div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {questionEntries.slice(0, 4).map(([qid, qsum]) => {
                    const { icon } = getQuestionTypeInfo(qsum.type);
                    return (
                      <div
                        key={qid}
                        className="p-4 border rounded-lg hover:shadow-sm transition-shadow"
                      >
                        <div className="flex items-start gap-3">
                          <div className="text-gray-500 mt-1">{icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 text-sm truncate">
                              {qsum.title || "질문"}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {qsum.type === "text" &&
                                `${qsum.sampleCount || 0}개 응답`}
                              {qsum.type === "rating" &&
                                qsum.average &&
                                `평균 ${Number(qsum.average).toFixed(1)}점`}
                              {qsum.type === "multiple_choice" &&
                                `${
                                  Object.keys(qsum.optionCounts || {}).length
                                }개 선택지`}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {questionEntries.length > 4 && (
                  <Button variant="ghost" kind="ghost"
                    onClick={() => setActiveTab("questions")}
                    className="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    모든 질문 보기 ({questionEntries.length})
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "questions" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="ghost" kind="ghost"
              onClick={expandAll}
              className="px-4 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
            >
              모두 펼치기
            </Button>
            <Button variant="ghost" kind="ghost"
              onClick={collapseAll}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              모두 접기
            </Button>
          </div>

          {questionEntries.length === 0 ? (
            <div className="bg-white rounded-xl p-6 shadow-md text-sm text-gray-500">
              질문별 통계가 아직 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {questionEntries.map(([qid, qsum]) => (
                <QuestionCard
                  key={qid}
                  qid={qid}
                  qsum={qsum}
                  responseCount={responseCount}
                  isExpanded={expandedQuestions.has(qid)}
                  onToggle={() => toggleQuestion(qid)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "responses" && showIdentifiable && (
        <div className="bg-white rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">개별 응답</h3>
            <Button variant="ghost" kind="ghost"
              onClick={handleDownloadResponsesCsv}
              disabled={loadingResponses || responses.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              CSV 내보내기
            </Button>
          </div>

          <div className="mb-4 space-y-2">
            <input
              type="text"
              value={responseSearchQuery}
              onChange={(e) => setResponseSearchQuery(e.target.value)}
              placeholder="이름/질문/응답 내용 검색"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="text-xs text-gray-500">
              검색 결과 {filteredResponses.length}건 / 전체 {responses.length}건
            </p>
          </div>

          {loadingResponses ? (
            <div className="text-center py-8">
              <Spinner size="sm" tone="blue" />
              <p className="text-sm text-gray-500 mt-2">응답을 불러오는 중...</p>
            </div>
          ) : responses.length === 0 ? (
            <div className="text-center py-8 text-gray-500">표시할 응답이 없습니다.</div>
          ) : filteredResponses.length === 0 ? (
            <div className="text-center py-8 text-gray-500">검색 결과가 없습니다.</div>
          ) : (
            <div className="space-y-4">
              {filteredResponses.map((r) => (
                <div
                  key={r.id}
                  className="border rounded-lg p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-medium text-gray-900">
                      {namesByUid[r.userId] || r.userName || "이름 없음"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDateTime(r.submittedAt)}
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded p-3 space-y-2">
                    {(Array.isArray(survey?.questions) ? survey.questions : []).map((q) => {
                      if (!q?.id) return null;
                      const answer = r.responses?.[q.id];
                      if (answer === null || answer === undefined || answer === "") {
                        return null;
                      }

                      return (
                        <div
                          key={`${r.id}_${q.id}`}
                          className="grid grid-cols-1 gap-1 md:grid-cols-[minmax(0,260px)_1fr] md:gap-3"
                        >
                          <div className="text-xs font-medium text-gray-500">
                            {q.question || q.id}
                          </div>
                          <div className="text-sm text-gray-800 break-words">
                            {toDisplayAnswer(answer, questionMap[q.id])}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
