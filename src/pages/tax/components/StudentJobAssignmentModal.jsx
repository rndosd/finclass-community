import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  Search,
  User,
  Users,
} from "lucide-react";

import { Badge, Button, Modal } from "../../../components/ui";

const EMPTY_JOB_VALUE = "없음";

const normalizeJobValues = (jobs = []) => {
  const rawJobs = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];

  return Array.from(
    new Set(
      rawJobs
        .map((job) => String(job || "").trim())
        .filter((jobName) => jobName && jobName !== EMPTY_JOB_VALUE),
    ),
  );
};

const normalizeJobs = (student = {}) => {
  const rawJobs = Array.isArray(student.jobs)
    ? student.jobs
    : student.jobs
      ? [student.jobs]
      : student.job
        ? [student.job]
        : [];

  return normalizeJobValues(rawJobs);
};

const normalizeTargetHeadcount = (value) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.floor(parsed);
};

const toSelectionKey = (items = []) =>
  Array.from(
    new Set(
      (Array.isArray(items) ? items : [items])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  )
    .sort((left, right) => left.localeCompare(right, "ko-KR"))
    .join("||");

const matchesKeyword = (...values) => {
  const lastValue = values[values.length - 1];
  const keyword = String(lastValue || "").trim().toLowerCase();
  if (!keyword) return true;

  return values.slice(0, -1).some((value) =>
    String(value || "").toLowerCase().includes(keyword),
  );
};

const getStudentNumberSortValue = (student = {}) => {
  const rawValue = String(student?.studentNumber ?? "").trim();
  if (!rawValue) return { hasNumber: false, number: 0, text: "" };

  const numericValue = Number(rawValue.replace(/[^\d.-]/g, ""));
  return {
    hasNumber: Number.isFinite(numericValue),
    number: Number.isFinite(numericValue) ? numericValue : 0,
    text: rawValue,
  };
};

const compareStudentsByNumber = (left, right) => {
  const leftNumber = getStudentNumberSortValue(left);
  const rightNumber = getStudentNumberSortValue(right);

  if (leftNumber.hasNumber && rightNumber.hasNumber) {
    if (leftNumber.number !== rightNumber.number) {
      return leftNumber.number - rightNumber.number;
    }
  } else if (leftNumber.hasNumber !== rightNumber.hasNumber) {
    return leftNumber.hasNumber ? -1 : 1;
  }

  const numberTextCompare = leftNumber.text.localeCompare(
    rightNumber.text,
    "ko-KR",
    { numeric: true },
  );
  if (numberTextCompare !== 0) return numberTextCompare;

  return String(left?.name || "").localeCompare(String(right?.name || ""), "ko-KR");
};

const sortStudents = (students = []) => [...students].sort(compareStudentsByNumber);

const hasOwnPendingAssignment = (assignments, studentUid) =>
  Object.prototype.hasOwnProperty.call(assignments, studentUid);

const buildJobCatalog = (students = [], jobDefinitions = []) => {
  const jobMap = new Map();

  jobDefinitions.forEach((job) => {
    const jobName = String(job?.name || "").trim();
    if (!jobName || jobMap.has(jobName)) return;

    jobMap.set(jobName, {
      id: job.id || jobName,
      name: jobName,
      description: String(job?.description || "").trim(),
      baseSalary: Number(job?.baseSalary || 0),
      targetHeadcount: normalizeTargetHeadcount(job?.targetHeadcount),
      isUndefined: false,
      studentUids: [],
    });
  });

  students.forEach((student) => {
    student.currentJobs.forEach((jobName) => {
      if (!jobMap.has(jobName)) {
        jobMap.set(jobName, {
          id: jobName,
          name: jobName,
          description: "",
          baseSalary: 0,
          targetHeadcount: null,
          isUndefined: true,
          studentUids: [],
        });
      }

      jobMap.get(jobName).studentUids.push(student.uid);
    });
  });

  return Array.from(jobMap.values())
    .map((job) => {
      const studentUids = Array.from(new Set(job.studentUids));
      const currentCount = studentUids.length;
      const shortageCount =
        job.targetHeadcount === null
          ? null
          : Math.max(job.targetHeadcount - currentCount, 0);

      return {
        ...job,
        studentUids,
        currentCount,
        shortageCount,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
};

const JobBadges = ({ jobs = [], emptyLabel = "미배정" }) =>
  jobs.length > 0 ? (
    <p className="text-sm font-semibold leading-6 text-slate-600">
      {jobs.join(" / ")}
    </p>
  ) : (
    <p className="text-sm font-semibold text-amber-600">{emptyLabel}</p>
  );

const JobTargetSummary = ({ job }) => {
  if (!job) return null;

  const headcountText =
    job.targetHeadcount === null
      ? `${job.currentCount} / -`
      : `${job.currentCount} / ${job.targetHeadcount}명`;

  return (
    <p className="text-sm font-semibold text-slate-700">{headcountText}</p>
  );
};

const StudentInlineSummary = ({ student, isEmphasized = false }) => {
  const metaClass = isEmphasized ? "text-blue-100" : "text-slate-400";
  const titleClass = isEmphasized ? "text-white" : "text-slate-900";
  const jobText =
    student.currentJobs.length > 0 ? student.currentJobs.join(" / ") : "직업 미배정";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`truncate text-base font-black ${titleClass}`}>{student.name}</span>
      <span className={`text-[11px] font-semibold ${metaClass}`}>
        /
        {jobText}
      </span>
    </div>
  );
};

const SearchField = ({
  value,
  onChange,
  placeholder,
}) => (
  <div className="relative">
    <Search
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      size={14}
    />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border-none bg-slate-100 py-2.5 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-blue-100"
    />
  </div>
);

const StudentJobAssignmentModal = ({
  isOpen,
  onClose,
  mode = "student",
  title,
  description,
  students = [],
  jobDefinitions = [],
  initialStudentUid = "",
  initialJobName = "",
  isSubmitting = false,
  onSubmit,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const normalizedStudents = useMemo(
    () =>
      sortStudents(
        (students || [])
          .filter((student) => student?.uid)
          .map((student) => ({
            ...student,
            uid: String(student.uid || "").trim(),
            currentJobs: normalizeJobs(student),
          })),
      ),
    [students],
  );

  const [targetSearch, setTargetSearch] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [activeStudentUid, setActiveStudentUid] = useState("");
  const [activeJobName, setActiveJobName] = useState("");
  const [selectedJobs, setSelectedJobs] = useState([]);
  const [selectedStudentUids, setSelectedStudentUids] = useState([]);
  const [pendingAssignments, setPendingAssignments] = useState({});
  const wasOpenRef = useRef(false);

  const originalStudentMap = useMemo(
    () => new Map(normalizedStudents.map((student) => [student.uid, student])),
    [normalizedStudents],
  );

  const effectiveStudents = useMemo(
    () =>
      normalizedStudents.map((student) => {
        const hasPending = hasOwnPendingAssignment(pendingAssignments, student.uid);
        const currentJobs = hasPending
          ? normalizeJobValues(pendingAssignments[student.uid])
          : student.currentJobs;

        return {
          ...student,
          currentJobs,
          hasPendingAssignment: hasPending,
        };
      }),
    [normalizedStudents, pendingAssignments],
  );

  const studentMap = useMemo(
    () => new Map(effectiveStudents.map((student) => [student.uid, student])),
    [effectiveStudents],
  );

  const jobCatalog = useMemo(
    () => buildJobCatalog(effectiveStudents, jobDefinitions),
    [effectiveStudents, jobDefinitions],
  );

  const jobMap = useMemo(
    () => new Map(jobCatalog.map((job) => [job.name, job])),
    [jobCatalog],
  );

  const originalJobCatalog = useMemo(
    () => buildJobCatalog(normalizedStudents, jobDefinitions),
    [jobDefinitions, normalizedStudents],
  );

  const originalJobMap = useMemo(
    () => new Map(originalJobCatalog.map((job) => [job.name, job])),
    [originalJobCatalog],
  );

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      setPendingAssignments((current) =>
        Object.keys(current).length > 0 ? {} : current,
      );
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    setTargetSearch("");
    setCandidateSearch("");
    setPendingAssignments({});

    if (mode === "job") {
      const nextActiveJobName = jobMap.has(initialJobName)
        ? initialJobName
        : jobCatalog[0]?.name || "";

      setActiveJobName(nextActiveJobName);
      setSelectedStudentUids(jobMap.get(nextActiveJobName)?.studentUids || []);
      setActiveStudentUid("");
      setSelectedJobs([]);
      return;
    }

    const nextActiveStudentUid = studentMap.has(initialStudentUid)
      ? initialStudentUid
      : normalizedStudents[0]?.uid || "";

    setActiveStudentUid(nextActiveStudentUid);
    setSelectedJobs(studentMap.get(nextActiveStudentUid)?.currentJobs || []);
    setActiveJobName("");
    setSelectedStudentUids([]);
  }, [
    initialJobName,
    initialStudentUid,
    isOpen,
    jobCatalog,
    jobMap,
    mode,
    normalizedStudents,
    studentMap,
  ]);

  const activeStudent = activeStudentUid
    ? studentMap.get(activeStudentUid) || null
    : null;
  const activeJob = activeJobName ? jobMap.get(activeJobName) || null : null;
  const pendingRows = useMemo(
    () =>
      Object.entries(pendingAssignments)
        .map(([studentUid, jobs]) => {
          const student =
            originalStudentMap.get(studentUid) || studentMap.get(studentUid);
          if (!student) return null;

          return {
            studentUid,
            studentName: student.name || "학생",
            jobs: normalizeJobValues(jobs),
          };
        })
        .filter(Boolean)
        .sort((left, right) =>
          left.studentName.localeCompare(right.studentName, "ko-KR"),
        ),
    [originalStudentMap, pendingAssignments, studentMap],
  );
  const pendingCount = pendingRows.length;

  const filteredStudents = useMemo(
    () =>
      effectiveStudents.filter((student) =>
        matchesKeyword(
          student.name,
          student.studentNumber,
          student.currentJobs.join(" "),
          targetSearch,
        ),
      ),
    [effectiveStudents, targetSearch],
  );

  const filteredJobs = useMemo(
    () =>
      jobCatalog.filter((job) =>
        matchesKeyword(job.name, job.description, targetSearch),
      ),
    [jobCatalog, targetSearch],
  );

  const filteredCandidateJobs = useMemo(
    () =>
      jobCatalog.filter((job) =>
        matchesKeyword(job.name, job.description, candidateSearch),
      ),
    [candidateSearch, jobCatalog],
  );

  const filteredCandidateStudents = useMemo(
    () =>
      effectiveStudents.filter((student) =>
        matchesKeyword(
          student.name,
          student.studentNumber,
          student.currentJobs.join(" "),
          candidateSearch,
        ),
      ),
    [candidateSearch, effectiveStudents],
  );

  const handleStudentTargetSelect = (studentUid) => {
    const nextStudent = studentMap.get(studentUid);
    if (!nextStudent) return;

    setActiveStudentUid(studentUid);
    setSelectedJobs(nextStudent.currentJobs);
  };

  const handleJobTargetSelect = (jobName) => {
    const nextJob = jobMap.get(jobName);
    if (!nextJob) return;

    setActiveJobName(jobName);
    setSelectedStudentUids(nextJob.studentUids);
  };

  const applyPendingAssignmentToDraft = (draft, studentUid, jobs) => {
    const normalizedStudentUid = String(studentUid || "").trim();
    if (!normalizedStudentUid) return;

    const normalizedJobs = normalizeJobValues(jobs);
    const originalJobs =
      originalStudentMap.get(normalizedStudentUid)?.currentJobs || [];

    if (toSelectionKey(normalizedJobs) === toSelectionKey(originalJobs)) {
      delete draft[normalizedStudentUid];
      return;
    }

    draft[normalizedStudentUid] = normalizedJobs;
  };

  const queuePendingAssignment = (studentUid, jobs) => {
    if (isSubmitting) return;

    setPendingAssignments((prev) => {
      const next = { ...prev };
      applyPendingAssignmentToDraft(next, studentUid, jobs);
      return next;
    });
  };

  const toggleJobSelection = (jobName) => {
    if (!activeStudent) return;

    const nextJobs = selectedJobs.includes(jobName)
      ? selectedJobs.filter((currentJob) => currentJob !== jobName)
      : normalizeJobValues([...selectedJobs, jobName]);

    setSelectedJobs(nextJobs);
    queuePendingAssignment(activeStudentUid, nextJobs);
  };

  const toggleStudentSelection = (studentUid) => {
    if (!activeJob) return;

    const student = studentMap.get(studentUid);
    if (!student) return;

    const isSelected = selectedStudentUids.includes(studentUid);
    const nextStudentUids = isSelected
      ? selectedStudentUids.filter((uid) => uid !== studentUid)
      : [...selectedStudentUids, studentUid];
    const nextJobs = isSelected
      ? student.currentJobs.filter((jobName) => jobName !== activeJobName)
      : normalizeJobValues([...student.currentJobs, activeJobName]);

    setSelectedStudentUids(nextStudentUids);
    queuePendingAssignment(studentUid, nextJobs);
  };

  const handleClearPendingAssignments = async () => {
    if (pendingCount === 0) return;

    const confirmed =
      typeof window === "undefined" || typeof window.confirm !== "function"
        ? true
        : (await appConfirm("대기 중인 직업 변경을 모두 비울까요?"));

    if (!confirmed) return;

    setPendingAssignments({});

    if (mode === "job") {
      setSelectedStudentUids(originalJobMap.get(activeJobName)?.studentUids || []);
      return;
    }

    setSelectedJobs(originalStudentMap.get(activeStudentUid)?.currentJobs || []);
  };

  const isSubmitDisabled = isSubmitting || pendingCount === 0;

  const handleSubmit = async () => {
    if (!onSubmit || isSubmitDisabled) return;

    const success = await onSubmit({
      assignments: pendingRows.map(({ studentUid, jobs }) => ({
        studentUid,
        jobs,
      })),
    });

    if (success) onClose?.();
  };

  const handleRequestClose = async () => {
    if (isSubmitting) return;

    if (pendingCount > 0) {
      const confirmed =
        typeof window === "undefined" || typeof window.confirm !== "function"
          ? true
          : (await appConfirm("아직 적용하지 않은 직업 변경이 있습니다. 닫을까요?"));

      if (!confirmed) return;
    }

    onClose?.();
  };

  const resolvedTitle =
    title ||
    (mode === "job" ? "직업 기준 학생 배정" : "학생 기준 직업 배정");
  const resolvedDescription =
    description ||
    (mode === "job"
      ? "왼쪽에서 직업 하나를 고르고, 오른쪽에서 그 직업에 포함할 학생을 정합니다."
      : "왼쪽에서 학생 하나를 고르고, 오른쪽에서 그 학생에게 저장할 직업을 정합니다.");

  const leftPanelTitle = mode === "job" ? "직업 선택" : "학생 선택";
  const leftSearchPlaceholder =
    mode === "job" ? "직업 이름 검색" : "학생 이름 또는 번호 검색";
  const rightPanelTitle = mode === "job" ? "학생 배정" : "직업 선택";
  const rightSearchPlaceholder =
    mode === "job" ? "학생 이름 또는 번호 검색" : "직업 이름 검색";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      size="xl"
      closeOnOverlayClick={!isSubmitting}
      showDefaultCloseButton={!isSubmitting}
    >
      <Modal.Header>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-100">
              {mode === "job" ? <Briefcase className="h-5 w-5" /> : <User className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">{resolvedTitle}</h2>
              <p className="text-sm leading-6 text-slate-500">{resolvedDescription}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">학생 {normalizedStudents.length}명</Badge>
            <Badge tone="indigo">직업 {jobCatalog.length}개</Badge>
            <Badge tone={mode === "job" ? "emerald" : "blue"}>
              {mode === "job"
                ? `선택 학생 ${selectedStudentUids.length}명`
                : `선택 직업 ${selectedJobs.length}개`}
            </Badge>
            <Badge tone={pendingCount > 0 ? "amber" : "slate"}>
              대기 {pendingCount}명
            </Badge>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="flex h-[78vh] flex-col overflow-hidden bg-white p-0 lg:flex-row">
        <div className="flex w-full flex-col border-r border-slate-100 bg-slate-50/30 lg:w-1/2">
          <div className="border-b border-slate-100 bg-white p-4">
            <SearchField
              value={targetSearch}
              onChange={setTargetSearch}
              placeholder={leftSearchPlaceholder}
            />

            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-800">{leftPanelTitle}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {mode === "job"
                      ? activeJob
                        ? `${activeJob.name} 직업에 들어갈 학생을 오른쪽에서 정할 수 있습니다.`
                        : "직업을 먼저 하나 선택해 주세요."
                      : activeStudent
                        ? `${activeStudent.name} 학생에게 저장할 직업을 오른쪽에서 고를 수 있습니다.`
                        : "학생을 먼저 하나 선택해 주세요."}
                  </p>
                </div>
                <Badge tone={mode === "job" ? (activeJob ? "blue" : "slate") : activeStudent ? "blue" : "slate"}>
                  {mode === "job"
                    ? activeJob?.name || "직업 선택 필요"
                    : activeStudent?.name || "학생 선택 필요"}
                </Badge>
              </div>
            </div>
          </div>

          <div className="scrollbar-hide flex-1 overflow-y-auto">
            {mode === "job" ? (
              filteredJobs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-400">
                  <Search size={20} />
                  <p className="text-sm font-bold">표시할 직업이 없습니다.</p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredJobs.map((job) => {
                      const isActive = activeJobName === job.name;

                      return (
                        <tr
                          key={job.id}
                          onClick={() => handleJobTargetSelect(job.name)}
                          className={`cursor-pointer transition-all ${
                            isActive
                              ? "bg-blue-600 text-white shadow-lg"
                              : "bg-white hover:bg-blue-50"
                          }`}
                        >
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-base font-black">
                                    {job.name}
                                  </span>
                                  {isActive ? (
                                    <CheckCircle2
                                      size={16}
                                      className="shrink-0 text-blue-100"
                                    />
                                  ) : null}
                                </div>
                                <p
                                  className={`mt-1 text-[11px] font-bold ${
                                    isActive ? "text-blue-100" : "text-slate-400"
                                  }`}
                                >
                                  {job.currentCount} / {job.targetHeadcount ?? "-"}
                                  {job.targetHeadcount !== null ? "명" : ""}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : filteredStudents.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-400">
                <Search size={20} />
                <p className="text-sm font-bold">표시할 학생이 없습니다.</p>
              </div>
            ) : (
              <table className="w-full text-left">
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredStudents.map((student) => {
                    const isActive = activeStudentUid === student.uid;

                    return (
                      <tr
                        key={student.uid}
                        onClick={() => handleStudentTargetSelect(student.uid)}
                        className={`cursor-pointer transition-all ${
                          isActive
                            ? "bg-blue-600 text-white shadow-lg"
                            : "bg-white hover:bg-blue-50"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <StudentInlineSummary
                                  student={student}
                                  isEmphasized={isActive}
                                />
                                {isActive ? (
                                  <CheckCircle2
                                    size={16}
                                    className="shrink-0 text-blue-100"
                                  />
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col overflow-hidden bg-white lg:w-1/2">
          <div className="border-b border-slate-100 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {rightPanelTitle}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {mode === "job"
                    ? activeJob
                      ? `${activeJob.name} 직업에 포함할 학생을 선택하거나 해제할 수 있습니다.`
                      : "왼쪽에서 직업을 먼저 선택해 주세요."
                    : activeStudent
                      ? `${activeStudent.name} 학생에게 저장할 직업을 선택해 주세요.`
                      : "왼쪽에서 학생을 먼저 선택해 주세요."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    mode === "job"
                      ? activeJob
                        ? "blue"
                        : "slate"
                      : activeStudent
                        ? "blue"
                        : "slate"
                  }
                  variant="soft"
                >
                  {mode === "job"
                    ? `선택 직업 ${activeJob?.name || "없음"}`
                    : `선택 학생 ${activeStudent?.name || "없음"}`}
                </Badge>
              </div>
            </div>

            {mode === "job" ? (
              <div className="mt-4 space-y-3">
                {activeJob ? <JobTargetSummary job={activeJob} /> : null}
                <SearchField
                  value={candidateSearch}
                  onChange={setCandidateSearch}
                  placeholder={rightSearchPlaceholder}
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {activeStudent ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <p className="text-xs font-black text-slate-800">현재 선택 직업</p>
                    <div className="mt-2">
                      <JobBadges jobs={activeStudent.currentJobs} />
                    </div>
                  </div>
                ) : null}
                <SearchField
                  value={candidateSearch}
                  onChange={setCandidateSearch}
                  placeholder={rightSearchPlaceholder}
                />
              </div>
            )}
          </div>

          <div className="scrollbar-hide flex-1 overflow-y-auto bg-slate-50/20 p-5">
            {mode === "job" ? (
              !activeJob ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-300">
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
                    <Briefcase size={32} strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-medium">
                    왼쪽에서 직업을 선택하면
                    <br />
                    오른쪽에서 학생을 배정할 수 있습니다.
                  </p>
                </div>
              ) : filteredCandidateStudents.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-400">
                  <Search size={20} />
                  <p className="text-sm font-bold">조건에 맞는 학생이 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredCandidateStudents.map((student) => {
                    const isSelected = selectedStudentUids.includes(student.uid);

                    return (
                      <Button
                        key={student.uid}
                        type="button"
                        onClick={() => toggleStudentSelection(student.uid)}
                        tone="blue"
                        kind={isSelected ? "soft" : "outline"}
                        rounded="xl"
                        className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left shadow-sm transition ${
                          isSelected
                            ? "border-blue-200 bg-blue-50"
                            : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                            isSelected
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-300 bg-white text-transparent"
                          }`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <StudentInlineSummary student={student} />
                        </div>
                      </Button>
                    );
                  })}
                </div>
              )
            ) : !activeStudent ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <Users size={32} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-medium">
                  왼쪽에서 학생을 선택하면
                  <br />
                  오른쪽에서 직업을 저장할 수 있습니다.
                </p>
              </div>
            ) : filteredCandidateJobs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-400">
                <Search size={20} />
                <p className="text-sm font-bold">조건에 맞는 직업이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCandidateJobs.map((job) => {
                  const isSelected = selectedJobs.includes(job.name);

                  return (
                    <Button
                      key={job.id}
                      type="button"
                      onClick={() => toggleJobSelection(job.name)}
                      tone="blue"
                      kind={isSelected ? "soft" : "outline"}
                      rounded="xl"
                      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left shadow-sm transition ${
                        isSelected
                          ? "border-indigo-200 bg-indigo-50"
                          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div
                        className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-slate-900">{job.name}</p>
                          <Badge tone="blue">
                            주급 {formatDisplayMoney(Number(job.baseSalary || 0))}
                          </Badge>
                          {job.isUndefined ? (
                            <Badge tone="amber">정의 필요</Badge>
                          ) : null}
                        </div>
                        {job.description ? (
                          <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-500">
                            {job.description}
                          </p>
                        ) : null}
                        <div className="mt-2">
                          <JobTargetSummary job={job} />
                        </div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 bg-white px-5 py-4">
            <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black uppercase text-amber-600">
                    변경 대기열
                  </span>
                  <Badge tone={pendingCount > 0 ? "amber" : "slate"}>
                    {pendingCount}명 대기
                  </Badge>
                  <span className="truncate text-xs font-semibold text-slate-500">
                    {pendingCount > 0
                      ? pendingRows
                          .slice(0, 2)
                          .map((row) => row.studentName)
                          .join(", ") +
                        (pendingCount > 2 ? ` 외 ${pendingCount - 2}명` : "")
                      : "선택하면 자동으로 담깁니다"}
                  </span>
                </div>
                {pendingCount > 0 ? (
                  <Button
                    type="button"
                    onClick={handleClearPendingAssignments}
                    disabled={isSubmitting}
                    tone="amber"
                    kind="ghost"
                    size="xs"
                    rounded="lg"
                    className="shrink-0 underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    비우기
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-[10px] font-black uppercase text-slate-400">
                  현재 편집
                </p>
                {mode === "job" ? (
                  <div className="space-y-1">
                    <p className="truncate text-sm font-semibold leading-6 text-slate-700">
                      {activeJob?.name || "직업 선택 필요"} / 학생{" "}
                      {selectedStudentUids.length}명
                    </p>
                    <p className="text-xs text-slate-500">
                      선택 변경은 바로 대기열에 반영됩니다.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="truncate text-sm font-semibold leading-6 text-slate-700">
                      {activeStudent?.name || "학생 선택 필요"}
                    </p>
                    <JobBadges
                      jobs={selectedJobs}
                      emptyLabel="직업 없음으로 변경됩니다"
                    />
                  </div>
                )}
              </div>

              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:min-w-[280px]">
                <Button
                  fullWidth
                  kind="outline"
                  tone="slate"
                  onClick={handleRequestClose}
                  disabled={isSubmitting}
                >
                  닫기
                </Button>
                <Button
                  fullWidth
                  tone="blue"
                  isLoading={isSubmitting}
                  disabled={isSubmitDisabled}
                  onClick={handleSubmit}
                >
                  대기열 적용
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default StudentJobAssignmentModal;
