import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useState } from "react";
import { auth, db } from "../../../firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { getPolicePath } from "../utils/policePathUtils";
import { buildPoliceRuleOption } from "../utils/ruleOptionLabel";
import StudentSelector from "../../../components/ui/StudentSelector";
import {
  Alert,
  Button,
  InputField,
  SelectField,
  Spinner,
} from "../../../components/ui";
import {
  AlertTriangle,
  BookOpen,
  MessageCircle,
  Send,
  ShieldAlert,
  User,
} from "lucide-react";

const UNKNOWN_STUDENT_NAME = "이름을 알 수 없는 학생";
const UNKNOWN_RULE_TEXT = "이름을 알 수 없는 규칙";
const MAX_RULE_REPEAT_COUNT = 1000;
const REPORT_TYPE_RULE = "rule";
const REPORT_TYPE_FREEFORM = "freeform";
const FREEFORM_REPORT_RULE_TEXT = "자유 신고";

const normalizeUidList = (uids = []) =>
  [
    ...new Set(
      (Array.isArray(uids) ? uids : [])
        .map((uid) => String(uid || "").trim())
        .filter(Boolean),
    ),
  ];

const normalizeRepeatCount = (value) => {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return NaN;
  return parsed;
};

const getLocalStudentName = (students = [], uid = "") => {
  const targetUid = String(uid || "").trim();
  if (!targetUid) return "";

  const student = (Array.isArray(students) ? students : []).find(
    (item) => String(item?.uid || item?.id || "").trim() === targetUid,
  );

  return student?.name || student?.studentName || "";
};

const ReportForm = ({
  allStudents = [],
  policeRules = [],
  onSubmitSuccess,
  onCancel,
  isSubmitting = false,
  setIsSubmitting,
}) => {
  const { userData, classId, loading: userContextLoading } = useUser();
  const { formatClassCurrency } = useNumberFormat();
  const { showFeedback } = useFeedback();

  const reporterUid = auth.currentUser?.uid || userData?.uid || null;
  const reporterName = userData?.name || userData?.nickname || "알 수 없는 신고자";
  const effectiveClassId =
    classId || userData?.classId || userData?.classDocId || null;

  const [accusedStudentUids, setAccusedStudentUids] = useState([]);
  const [reportType, setReportType] = useState(REPORT_TYPE_RULE);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [reason, setReason] = useState("");
  const [repeatCount, setRepeatCount] = useState("1");
  const [isSensitive, setIsSensitive] = useState(false);
  const [formError, setFormError] = useState("");

  const ruleOptions = useMemo(
    () =>
      (Array.isArray(policeRules) ? policeRules : []).map((rule) => ({
        value: rule.id,
        label: `${rule.order}. ${rule.text} (벌금 ${rule.fineAmount} / 신용 ${rule.creditChange} / 토큰 ${rule.missionTokenChange || 0})`,
        searchText: `${rule.order || ""} ${rule.text || ""} ${rule.fineAmount || ""} ${rule.creditChange || ""} ${rule.missionTokenChange || ""}`,
      })),
    [policeRules],
  );

  const normalizedRuleOptions = useMemo(
    () =>
      ruleOptions.map((option) => {
        const matchedRule = (Array.isArray(policeRules) ? policeRules : []).find(
          (rule) => rule?.id === option.value,
        );

        return buildPoliceRuleOption(
          matchedRule || { id: option.value, text: option.label },
          formatClassCurrency,
        );
      }),
    [policeRules, ruleOptions, formatClassCurrency],
  );

  const resolveStudentName = async (uid, cache) => {
    const targetUid = String(uid || "").trim();
    if (!targetUid) return UNKNOWN_STUDENT_NAME;

    if (cache.has(targetUid)) return cache.get(targetUid);

    let resolvedName = getLocalStudentName(allStudents, targetUid);

    if (!resolvedName && effectiveClassId) {
      try {
        const studentRef = doc(
          db,
          `classes/${effectiveClassId}/students/${targetUid}`,
        );
        const studentSnap = await getDoc(studentRef);
        if (studentSnap.exists()) {
          const data = studentSnap.data() || {};
          resolvedName = data?.name || data?.studentName || "";
        }
      } catch (error) {
        console.warn(
          "[ReportForm] failed to resolve accused student name:",
          targetUid,
          error,
        );
      }
    }

    const safeName = resolvedName || UNKNOWN_STUDENT_NAME;
    cache.set(targetUid, safeName);
    return safeName;
  };

  const handleSubmitReport = async (event) => {
    if (event) event.preventDefault();
    setFormError("");

    if (!reporterUid) {
      showFeedback(
        "로그인 정보가 확인되지 않아 신고를 제출할 수 없습니다. 다시 로그인해 주세요.",
        "error",
      );
      return;
    }

    const normalizedAccusedUids = normalizeUidList(accusedStudentUids);
    if (normalizedAccusedUids.length === 0) {
      setFormError("피신고자를 선택해 주세요.");
      return;
    }

    if (reportType === REPORT_TYPE_RULE && !selectedRuleId) {
      setFormError("규칙 신고는 규칙을 선택해 주세요.");
      return;
    }

    if (!reason.trim() || reason.trim().length < 5) {
      setFormError("신고 사유를 5자 이상 구체적으로 입력해 주세요.");
      return;
    }

    const normalizedRepeatCount =
      reportType === REPORT_TYPE_RULE
        ? normalizeRepeatCount(repeatCount)
        : 1;

    if (
      reportType === REPORT_TYPE_RULE &&
      (!Number.isFinite(normalizedRepeatCount) || normalizedRepeatCount < 1)
    ) {
      setFormError("x N은 1 이상의 숫자로 입력해 주세요.");
      return;
    }

    if (
      reportType === REPORT_TYPE_RULE &&
      normalizedRepeatCount > MAX_RULE_REPEAT_COUNT
    ) {
      setFormError(
        `x N은 최대 ${MAX_RULE_REPEAT_COUNT}까지만 입력할 수 있습니다.`,
      );
      return;
    }

    if (setIsSubmitting) setIsSubmitting(true);

    try {
      if (!effectiveClassId) {
        throw new Error("학급 정보를 확인할 수 없습니다.");
      }

      const ruleData = (Array.isArray(policeRules) ? policeRules : []).find(
        (rule) => rule.id === selectedRuleId,
      );
      const reportsPath = getPolicePath("policeReports", effectiveClassId);

      if (!reportsPath) {
        throw new Error("신고 저장 경로를 확인할 수 없습니다.");
      }

      const studentNameCache = new Map();
      await Promise.all(
        normalizedAccusedUids.map(async (accusedUid) => {
          const accusedStudentName = await resolveStudentName(
            accusedUid,
            studentNameCache,
          );

          const reportDocData = {
            reporterUid,
            reporterName,
            accusedStudentUid: accusedUid,
            accusedStudentName,
            reportType,
            ruleId: reportType === REPORT_TYPE_RULE ? selectedRuleId : null,
            ruleText:
              reportType === REPORT_TYPE_RULE
                ? ruleData?.text || UNKNOWN_RULE_TEXT
                : FREEFORM_REPORT_RULE_TEXT,
            reason: reason.trim(),
            repeatCount: normalizedRepeatCount,
            status: "pending",
            createdAt: serverTimestamp(),
            classId: effectiveClassId,
            isSensitive,
            resolvedAt: null,
            resolverUid: null,
            resolverName: null,
            actionTaken: null,
          };

          await addDoc(collection(db, reportsPath), reportDocData);
        }),
      );

      const successMessage = "신고가 정상적으로 접수되었습니다.";
      if (typeof onSubmitSuccess === "function") {
        onSubmitSuccess(successMessage);
      } else {
        showFeedback(successMessage, "success");
      }
    } catch (error) {
      if (error?.code === "permission-denied") {
        showFeedback(
          "신고를 제출할 권한이 없습니다. 다시 로그인하거나 권한을 확인해 주세요.",
          "error",
        );
        return;
      }

      console.error("[ReportForm] submit failed:", error);
      showFeedback("신고 제출 중 오류가 발생했습니다.", "error");
    } finally {
      if (setIsSubmitting) setIsSubmitting(false);
    }
  };

  if (userContextLoading) {
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmitReport}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-black text-slate-700">
          <AlertTriangle size={16} className="text-indigo-500" /> 신고 유형
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            onClick={() => setReportType(REPORT_TYPE_RULE)}
            disabled={isSubmitting}
            kind="ghost"
            tone="blue"
            aria-pressed={reportType === REPORT_TYPE_RULE}
            className={`block h-full w-full rounded-2xl border-2 px-4 py-3 text-left transition-all ${
              reportType === REPORT_TYPE_RULE
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <div className="text-sm font-black">규칙 신고</div>
            <div className="mt-1 text-[11px] font-medium">
              규칙을 선택하고 해당 위반을 접수합니다.
            </div>
          </Button>
          <Button
            type="button"
            onClick={() => setReportType(REPORT_TYPE_FREEFORM)}
            disabled={isSubmitting}
            kind="ghost"
            tone="red"
            aria-pressed={reportType === REPORT_TYPE_FREEFORM}
            className={`block h-full w-full rounded-2xl border-2 px-4 py-3 text-left transition-all ${
              reportType === REPORT_TYPE_FREEFORM
                ? "border-rose-500 bg-rose-50 text-rose-700"
                : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <div className="whitespace-nowrap text-sm font-black">자유 신고</div>
            <div className="mt-1 text-[11px] font-medium">
              규칙과 무관한 사안을 자유문으로 접수합니다.
            </div>
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-black text-slate-700">
          <User size={16} className="text-indigo-500" /> 피신고자 선택
        </label>
        <StudentSelector
          label="피신고자 선택 (개인/모둠)"
          selectedUids={accusedStudentUids}
          onChange={setAccusedStudentUids}
          multiple={true}
          disabled={isSubmitting}
        />
        <p className="text-[11px] font-medium text-slate-500">
          모둠이 설정된 반에서는 선택 영역 상단에 <b>개인/모둠</b> 전환
          버튼이 표시됩니다.
        </p>
      </div>

      {reportType === REPORT_TYPE_RULE ? (
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
          <div className="space-y-2">
            <label
              htmlFor="ruleSelect"
              className="flex items-center gap-2 text-sm font-black text-slate-700"
            >
              <BookOpen size={16} className="text-indigo-500" /> 규칙 선택
            </label>
            <SelectField
              id="ruleSelect"
              value={selectedRuleId}
              onChange={(event) => setSelectedRuleId(event.target.value)}
              disabled={isSubmitting}
              options={normalizedRuleOptions}
              placeholder="규칙을 선택해 주세요"
              searchable
              combobox
              searchPlaceholder="번호 또는 규칙명"
              className="border-slate-100 bg-slate-50 text-sm font-bold"
              dropdownClassName="min-w-[min(92vw,32rem)]"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="reportRepeatCount"
              className="block text-sm font-black text-slate-700"
            >
              x N
            </label>
            <InputField
              id="reportRepeatCount"
              type="number"
              min={1}
              max={MAX_RULE_REPEAT_COUNT}
              step={1}
              value={repeatCount}
              onChange={(event) => setRepeatCount(event.target.value)}
              disabled={isSubmitting}
              className="border-slate-300 bg-white text-sm font-bold"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="reportReason"
          className="flex items-center gap-2 text-sm font-black text-slate-700"
        >
          <MessageCircle size={16} className="text-indigo-500" /> 신고 사유
        </label>
        <textarea
          id="reportReason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="사건의 경위를 구체적으로 적어주세요"
          disabled={isSubmitting}
          className="min-h-[120px] w-full resize-none rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition-all focus:border-blue-500"
        />
      </div>

      <div className="text-[11px] font-medium leading-relaxed text-slate-500">
        {reportType === REPORT_TYPE_RULE
          ? "신고가 처리될 때 같은 규칙은 같은 대상에게 x N만큼 반복 적용됩니다."
          : "자유 신고는 선택한 규칙 없이 신고 사유를 접수합니다. 접수 후 검토 결과를 확인해 주세요."}
      </div>

      <div
        onClick={() => !isSubmitting && setIsSensitive((prev) => !prev)}
        className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition-all ${
          isSensitive
            ? "border-rose-200 bg-rose-50"
            : "border-slate-100 bg-slate-50 hover:border-slate-200"
        }`}
      >
        <div
          className={`mt-0.5 rounded-md p-1 ${
            isSensitive ? "bg-rose-500 text-white" : "bg-slate-200 text-slate-400"
          }`}
        >
          <ShieldAlert size={16} />
        </div>
        <div>
          <p
            className={`text-sm font-black ${
              isSensitive ? "text-rose-700" : "text-slate-600"
            }`}
          >
            민감한 사안으로 신고하기
          </p>
          <p className="mt-0.5 text-[11px] font-medium leading-tight text-slate-500">
            선택하면 선생님과 신고자만 볼 수 있고, 다른 학생에게는
            숨겨집니다.
          </p>
        </div>
      </div>

      {formError && <Alert type="error" message={formError} />}

      <div className="sticky bottom-0 z-20 -mx-4 grid grid-cols-2 gap-3 border-t border-slate-100 bg-white/95 px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:flex sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4">
        <Button size="md"
          type="button"
          tone="slate"
          kind="soft"
          onClick={onCancel}
          disabled={isSubmitting}
          
        >
          취소
        </Button>
        <Button size="md"
          type="submit"
          tone={isSensitive ? "rose" : "indigo"}
          disabled={isSubmitting}
          isLoading={isSubmitting}
          icon={Send}
          
        >
          신고 제출하기
        </Button>
      </div>
    </form>
  );
};

export default ReportForm;
