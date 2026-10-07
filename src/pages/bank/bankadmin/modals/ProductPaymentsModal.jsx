import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDaysIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { collection, onSnapshot } from "firebase/firestore";
import { Button, IconButton, Modal } from "../../../../components/ui";
import StudentSelector from "../../../../components/ui/StudentSelector";
import { db } from "../../../../firebase";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useClassStudents } from "../../../../hooks/user/useClassStudents";
import { formatBankMoney } from "../../../../utils/bankMoney";
import {
  cancelPayment,
  terminateSubscription,
} from "../../services/subscriptionService";

const PAGE_SIZE = 20;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.toMillis === "function") return new Date(value.toMillis());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMillis(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function flattenRows(subscriptionDocs, productId, fallbackCurrencyUnit) {
  const rows = [];

  subscriptionDocs.forEach((docSnap) => {
    const uid = docSnap.id;
    const subData = docSnap.data() || {};
    const productSub = subData?.activeSubscriptions?.[productId];
    if (!productSub) return;

    const history = Array.isArray(productSub.paymentHistory)
      ? productSub.paymentHistory
      : [];

    history.forEach((payment, index) => {
      const rawPaymentNum =
        payment?.num ?? payment?.paymentNumber ?? payment?.paymentNum ?? null;
      const paymentNum = Number(rawPaymentNum);

      rows.push({
        id: `${uid}-${rawPaymentNum ?? "unknown"}-${index}`,
        studentUid: uid,
        paymentNum: Number.isFinite(paymentNum) ? paymentNum : null,
        originalPaymentNum: Number(payment?.originalNum || 0) || null,
        amount: Number(payment?.amount || 0),
        paymentDate: payment?.date || payment?.paymentDate || null,
        isCancelled: !!payment?.isCancelled,
        currencyUnit: payment?.unit || fallbackCurrencyUnit,
        isTerminated: !!productSub?.isTerminated,
        isWithdrawn: !!productSub?.isWithdrawn,
      });
    });
  });

  return rows;
}

function buildStudentGroups(rows, studentMap) {
  const groupMap = new Map();

  rows.forEach((row) => {
    const current = groupMap.get(row.studentUid) || {
      studentUid: row.studentUid,
      studentLabel: studentMap[row.studentUid] || row.studentUid,
      rows: [],
    };
    current.rows.push(row);
    groupMap.set(row.studentUid, current);
  });

  return Array.from(groupMap.values())
    .map((group) => {
      const sortedRows = [...group.rows].sort((a, b) => {
        const aNum = Number.isFinite(a.paymentNum)
          ? a.paymentNum
          : Number.MAX_SAFE_INTEGER;
        const bNum = Number.isFinite(b.paymentNum)
          ? b.paymentNum
          : Number.MAX_SAFE_INTEGER;
        if (aNum !== bNum) return aNum - bNum;
        return toMillis(a.paymentDate) - toMillis(b.paymentDate);
      });

      const validRows = sortedRows.filter((row) => !row.isCancelled);

      return {
        ...group,
        rows: sortedRows,
        totalCount: sortedRows.length,
        validCount: validRows.length,
        totalAmount: sortedRows.reduce(
          (sum, row) => sum + Number(row.amount || 0),
          0,
        ),
        validAmount: validRows.reduce(
          (sum, row) => sum + Number(row.amount || 0),
          0,
        ),
        isTerminated: !!sortedRows[0]?.isTerminated,
        isWithdrawn: !!sortedRows[0]?.isWithdrawn,
      };
    })
    .sort((a, b) => a.studentLabel.localeCompare(b.studentLabel, "ko"));
}

function sortStudents(students = []) {
  return [...students].sort((a, b) => {
    const aNum = Number(a.studentNumber || 0);
    const bNum = Number(b.studentNumber || 0);
    if (aNum !== bNum) return aNum - bNum;
    return String(a.name || "").localeCompare(String(b.name || ""), "ko");
  });
}

function buildStudentLabelMap(students = []) {
  const nextMap = {};
  students.forEach((student) => {
    const studentNo = String(student.studentNumber ?? "").padStart(2, "0");
    nextMap[student.uid] = `${studentNo}번 ${student.name ?? student.uid}`;
  });
  return nextMap;
}

export default function ProductPaymentsModal({
  isOpen,
  onClose,
  classId,
  productId,
  currencyUnit = "원",
  earlyTerminationBlocked = false,
  canCancel = false,
}) {
  const { showFeedback } = useFeedback();

  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [studentMap, setStudentMap] = useState({});
  const [viewMode, setViewMode] = useState("student");
  const [selectedStudentUid, setSelectedStudentUid] = useState("");
  const [page, setPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [terminateTarget, setTerminateTarget] = useState(null);
  const [terminateLoading, setTerminateLoading] = useState(false);

  const {
    data: classStudents = [],
    isLoading: studentsLoading,
  } = useClassStudents(classId, {
    enabled: isOpen && !!classId,
    realtime: false,
  });

  const studentOptions = useMemo(() => sortStudents(classStudents), [classStudents]);

  useEffect(() => {
    if (!isOpen) return;

    setStudentMap(buildStudentLabelMap(studentOptions));

    const firstStudent = studentOptions[0];
    if (!selectedStudentUid && firstStudent) {
      setSelectedStudentUid(firstStudent.uid);
      return;
    }

    if (
      selectedStudentUid &&
      !studentOptions.some((student) => student.uid === selectedStudentUid)
    ) {
      setSelectedStudentUid(firstStudent?.uid || "");
    }
  }, [isOpen, selectedStudentUid, studentOptions]);

  useEffect(() => {
    if (!isOpen || !classId || !productId) return undefined;

    setRowsLoading(true);
    const subsRef = collection(db, "classes", classId, "subscriptions");

    const unsubscribe = onSnapshot(
      subsRef,
      (snap) => {
        setRows(flattenRows(snap.docs, productId, currencyUnit));
        setRowsLoading(false);
      },
      (error) => {
        console.error(error);
        setRows([]);
        setRowsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, currencyUnit, isOpen, productId]);

  const isLoading = rowsLoading || studentsLoading;

  const dateRows = useMemo(
    () => [...rows].sort((a, b) => toMillis(b.paymentDate) - toMillis(a.paymentDate)),
    [rows],
  );

  const studentGroups = useMemo(
    () => buildStudentGroups(rows, studentMap),
    [rows, studentMap],
  );

  const visibleStudentGroups = useMemo(() => {
    if (!selectedStudentUid) return studentGroups;
    return studentGroups.filter((group) => group.studentUid === selectedStudentUid);
  }, [selectedStudentUid, studentGroups]);

  const selectedStudentRows = useMemo(() => {
    if (!selectedStudentUid) return [];
    return dateRows.filter((row) => row.studentUid === selectedStudentUid);
  }, [dateRows, selectedStudentUid]);

  useEffect(() => {
    setPage(1);
  }, [viewMode]);

  const activeRows = viewMode === "date" ? dateRows : selectedStudentRows;
  const totalCount = activeRows.length;
  const validCount = activeRows.filter((row) => !row.isCancelled).length;
  const totalPaid = activeRows
    .filter((row) => !row.isCancelled)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const totalPages = Math.max(1, Math.ceil(dateRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rowsToRender =
    viewMode === "date"
      ? dateRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
      : selectedStudentRows;

  const labelOf = (uid) => studentMap[uid] || uid;

  const handleCancel = async () => {
    if (!cancelTarget) return;
    if (!Number.isFinite(cancelTarget.paymentNum)) {
      showFeedback("회차 정보가 없는 납입은 취소할 수 없습니다.", "error");
      return;
    }

    setCancelLoading(true);
    try {
      await cancelPayment({
        classId,
        productId,
        paymentNum: cancelTarget.paymentNum,
        studentUid: cancelTarget.studentUid,
      });
      showFeedback("납입 취소가 완료되었습니다.", "success");
      setCancelTarget(null);
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "납입 취소에 실패했습니다.", "error");
    } finally {
      setCancelLoading(false);
    }
  };

  const handleTerminate = async () => {
    if (!terminateTarget) return;

    setTerminateLoading(true);
    try {
      await terminateSubscription({
        classId,
        productId,
        studentUid: terminateTarget.studentUid,
      });
      showFeedback("학생 청약을 종료했습니다.", "success");
      setTerminateTarget(null);
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "청약 종료 처리에 실패했습니다.", "error");
    } finally {
      setTerminateLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="청약 납입 내역"
      size="xl"
      closeOnOverlayClick
    >
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="전체 건수" value={totalCount} tone="slate" />
            <Stat label="유효 납입 건수" value={validCount} tone="emerald" />
            <Stat
              label="유효 납입 총액"
              value={`${formatBankMoney(totalPaid)} ${currencyUnit}`}
              tone="blue"
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <Button
                type="button"
                onClick={() => setViewMode("student")}
                tone="slate"
                kind={viewMode === "student" ? "solid" : "ghost"}
                size="xs"
                rounded="lg"
                className={`inline-flex items-center gap-1.5 transition  ${
                  viewMode === "student"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <UserGroupIcon className="h-4 w-4" />
                학생별 보기
              </Button>
              <Button
                type="button"
                onClick={() => setViewMode("date")}
                tone="slate"
                kind={viewMode === "date" ? "solid" : "ghost"}
                size="xs"
                rounded="lg"
                className={`inline-flex items-center gap-1.5 transition  ${
                  viewMode === "date"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <CalendarDaysIcon className="h-4 w-4" />
                날짜순 보기
              </Button>
            </div>

            {viewMode === "student" ? (
              <div className="w-full sm:w-[340px]">
                <StudentSelector
                  label="학생 선택"
                  singleSelect
                  selectedUids={selectedStudentUid ? [selectedStudentUid] : []}
                  onChange={(uids) => setSelectedStudentUid(uids[0] || "")}
                  allStudents={studentOptions}
                  includeTeacher={false}
                  includeAdmin={false}
                  dropdownAbsolute
                />
              </div>
            ) : null}
          </div>
        </section>

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-500">
            납입 내역을 불러오는 중입니다...
          </div>
        ) : viewMode === "student" ? (
          <div className="space-y-4">
            {visibleStudentGroups.length === 0 ? (
              <EmptyState />
            ) : (
              visibleStudentGroups.map((group) => (
                <section
                  key={group.studentUid}
                  className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                    selectedStudentUid === group.studentUid
                      ? "border-blue-300 ring-2 ring-blue-100"
                      : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h4 className="text-base font-black text-slate-900">
                        {group.studentLabel}
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        전체 {group.totalCount}건 / 유효 {group.validCount}건
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canCancel &&
                      group.validCount > 0 &&
                      !group.isTerminated &&
                      !group.isWithdrawn &&
                      !earlyTerminationBlocked ? (
                        <Button
                          tone="red"
                          kind="soft"
                          size="xs"
                          onClick={() =>
                            setTerminateTarget({
                              studentUid: group.studentUid,
                              studentLabel: group.studentLabel,
                              validAmount: group.validAmount,
                            })
                          }
                        >
                          청약 종료
                        </Button>
                      ) : null}
                      {canCancel &&
                      group.validCount > 0 &&
                      !group.isTerminated &&
                      !group.isWithdrawn &&
                      earlyTerminationBlocked ? (
                        <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">
                          중도해지 제한
                        </span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right text-sm md:grid-cols-2">
                      <MetricChip
                        label="전체 금액"
                        value={`${formatBankMoney(group.totalAmount)} ${currencyUnit}`}
                      />
                      <MetricChip
                        label="유효 금액"
                        value={`${formatBankMoney(group.validAmount)} ${currencyUnit}`}
                        tone="emerald"
                      />
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {group.rows.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="flex items-start gap-4">
                          <div className="min-w-[72px] rounded-xl bg-slate-100 px-3 py-2 text-center text-sm font-black text-slate-700">
                            {row.isCancelled
                              ? `취소${row.originalPaymentNum ? ` (${row.originalPaymentNum}회차)` : ""}`
                              : Number.isFinite(row.paymentNum)
                                ? `${row.paymentNum}회차`
                                : "-"}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">
                              {formatBankMoney(row.amount)} {row.currencyUnit || currencyUnit}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {formatDateTime(row.paymentDate)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 md:justify-end">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              row.isCancelled
                                ? "bg-rose-100 text-rose-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {row.isCancelled ? "취소됨" : "유효"}
                          </span>
                          {canCancel &&
                          !row.isCancelled &&
                          Number.isFinite(row.paymentNum) ? (
                            <Button
                              tone="red"
                              kind="soft"
                              size="xs"
                              onClick={() => setCancelTarget(row)}
                            >
                              납입 취소
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-[4] bg-slate-100/95 backdrop-blur">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold text-slate-600">학생</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-600">납입 금액</th>
                    <th className="px-4 py-3 text-center font-bold text-slate-600">회차</th>
                    <th className="px-4 py-3 text-center font-bold text-slate-600">납입 일시</th>
                    <th className="px-4 py-3 text-center font-bold text-slate-600">상태</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-600">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rowsToRender.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <ExclamationTriangleIcon className="h-6 w-6" />
                          <span>표시할 납입 내역이 없습니다.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rowsToRender.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {labelOf(row.studentUid)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-800">
                          {formatBankMoney(row.amount)} {row.currencyUnit || currencyUnit}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-700">
                          {row.isCancelled
                            ? `취소${row.originalPaymentNum ? ` (${row.originalPaymentNum}회차)` : ""}`
                            : Number.isFinite(row.paymentNum)
                              ? `${row.paymentNum}회차`
                              : "-"}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600">
                          {formatDateTime(row.paymentDate)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              row.isCancelled
                                ? "bg-rose-100 text-rose-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {row.isCancelled ? "취소됨" : "유효"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canCancel &&
                          !row.isCancelled &&
                          Number.isFinite(row.paymentNum) ? (
                            <Button
                              tone="red"
                              kind="soft"
                              size="xs"
                              onClick={() => setCancelTarget(row)}
                            >
                              납입 취소
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                <span>
                  {currentPage} / {totalPages} 페이지
                </span>
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    kind="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  >
                    이전
                  </Button>
                  <Button
                    size="xs"
                    kind="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  >
                    다음
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {cancelTarget ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-black text-slate-900">납입 취소 확인</h4>
                <p className="mt-2 text-sm text-slate-600">
                  {labelOf(cancelTarget.studentUid)} 학생의{" "}
                  {Number.isFinite(cancelTarget.paymentNum)
                    ? `${cancelTarget.paymentNum}회차`
                    : "선택한"}{" "}
                  납입을 취소하시겠습니까?
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  취소 후에도 기록은 남고 상태만 취소됨으로 바뀝니다.
                </p>
              </div>
              <IconButton
                type="button"
                onClick={() => setCancelTarget(null)}
                icon={XMarkIcon}
                label="닫기"
                tone="slate"
                size="sm"
                className="rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              />
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">납입 금액</span>
                <span className="font-bold text-slate-900">
                  {formatBankMoney(cancelTarget.amount)} {cancelTarget.currencyUnit || currencyUnit}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">납입 일시</span>
                <span className="font-medium text-slate-700">
                  {formatDateTime(cancelTarget.paymentDate)}
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button kind="outline" onClick={() => setCancelTarget(null)}>
                닫기
              </Button>
              <Button tone="red" onClick={handleCancel} isLoading={cancelLoading}>
                납입 취소
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {terminateTarget ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-black text-slate-900">청약 종료 확인</h4>
                <p className="mt-2 text-sm text-slate-600">
                  {terminateTarget.studentLabel} 학생의 청약을 종료하시겠습니까?
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  이후 추가 납입은 막히고, 기존 기록은 그대로 유지됩니다.
                </p>
              </div>
              <IconButton
                type="button"
                onClick={() => setTerminateTarget(null)}
                icon={XMarkIcon}
                label="닫기"
                tone="slate"
                size="sm"
                className="rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              />
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">현재 유효 납입 총액</span>
                <span className="font-bold text-slate-900">
                  {formatBankMoney(terminateTarget.validAmount)} {currencyUnit}
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button kind="outline" onClick={() => setTerminateTarget(null)}>
                닫기
              </Button>
              <Button
                tone="red"
                onClick={handleTerminate}
                isLoading={terminateLoading}
              >
                청약 종료
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function Stat({ label, value, tone }) {
  const toneClassMap = {
    slate: "border-slate-200 bg-white text-slate-800",
    emerald: "border-emerald-200 bg-emerald-50/50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50/50 text-blue-700",
  };

  return (
    <div className={`rounded-xl border p-3 ${toneClassMap[tone] || toneClassMap.slate}`}>
      <p className="text-xs font-semibold">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function MetricChip({ label, value, tone = "slate" }) {
  const toneClassMap = {
    slate: "bg-white text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div className={`rounded-xl px-3 py-2 ${toneClassMap[tone] || toneClassMap.slate}`}>
      <p className="text-[11px] font-semibold">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
      <div className="flex flex-col items-center gap-2">
        <ExclamationTriangleIcon className="h-6 w-6" />
        <span>표시할 납입 내역이 없습니다.</span>
      </div>
    </div>
  );
}
