import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Badge, Button } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
} from "../../../utils/safeXlsxImport";
import { assignStudentJobs } from "../services/jobPermissionSyncService";
import TaxExcelPanel from "./TaxExcelPanel";

const JOB_COLUMNS = [
  "직업1",
  "직업2",
  "직업3",
  "직업4",
  "직업5",
  "직업6",
  "직업7",
  "직업8",
];

const getStatusBadge = (status) => {
  switch (status) {
    case "updated":
      return <Badge tone="emerald">업데이트</Badge>;
    case "unchanged":
      return <Badge tone="slate">변경 없음</Badge>;
    case "error":
      return <Badge tone="red">오류</Badge>;
    default:
      return <Badge tone="slate">확인 필요</Badge>;
  }
};

const getRowClassName = (status) => {
  if (status === "error") return "bg-rose-50";
  if (status === "updated") return "bg-emerald-50";
  return "bg-slate-50";
};

const JobAssignByXLSX = ({ students = [], jobDefinitions = [], onProcessingDone }) => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();

  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [lastProcessingResult, setLastProcessingResult] = useState(null);

  const counts = useMemo(
    () => ({
      updated: previewData.filter((row) => row.status === "updated").length,
      unchanged: previewData.filter((row) => row.status === "unchanged").length,
      error: previewData.filter((row) => row.status === "error").length,
    }),
    [previewData],
  );

  const resetPreview = () => {
    setPreviewData([]);
    setLastProcessingResult(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  const handleDownloadSampleXLSX = () => {
    const worksheetData = [
      ["학번", "이름", "직업1", "직업2", "직업3", "직업4", "직업5"],
      ["1", "김철수", "프로그래머", "", "", "", ""],
      ["2", "이영희", "디자이너", "청소부", "", "", ""],
      ["3", "박민수", "없음", "", "", "", ""],
      ["4", "최민지", "급식도우미", "환경미화원", "체육도우미", "", ""],
      ["5", "정수아", "도서관 사서", "방송부", "학급 관리자", "보건실 도우미", ""],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    worksheet["!cols"] = [
      { width: 10 },
      { width: 15 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "직업배정샘플");
    XLSX.writeFile(workbook, "직업배정_샘플파일_다중직업.xlsx");
  };

  const extractJobsFromRow = (row) => {
    const jobs = JOB_COLUMNS.map((column, index) => {
      const rawValue = row[column] || row[`job${index + 1}`] || "";
      return String(rawValue).trim();
    }).filter((job) => job && job !== "없음");

    return jobs.length > 0 ? jobs : ["없음"];
  };

  const validateJobs = (jobs, studentName) => {
    const errors = [];

    jobs.forEach((jobName) => {
      if (jobName === "없음") return;
      const exists = jobDefinitions.some(
        (jobDefinition) => jobDefinition.name === jobName,
      );
      if (!exists) {
        errors.push(`직업명 '${jobName}'이 정의되지 않았습니다. (학생: ${studentName})`);
      }
    });

    return errors;
  };

  const handleConfirmAndApply = () => {
    if (lastProcessingResult && typeof onProcessingDone === "function") {
      onProcessingDone(lastProcessingResult);
    }
    resetPreview();
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !classId) return;

    try {
      validateXlsxImportFile(file);
    } catch (error) {
      showFeedback(getXlsxImportErrorMessage(error), "error");
      event.target.value = "";
      return;
    }

    setFileName(file.name);
    setPreviewData([]);
    setLastProcessingResult(null);
    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const { rows } = parseFirstXlsxWorksheet(loadEvent.target?.result, {
          file,
        });

        const processedRows = [];
        const errors = [];
        let updatedCount = 0;
        const updatedAssignments = [];

        rows.forEach((row) => {
          const studentNumber = String(
            row["학번"] || row.studentNumber || "",
          ).trim();
          const student = students.find(
            (item) => String(item.studentNumber || "").trim() === studentNumber,
          );

          if (!student) {
            errors.push(`학번 ${studentNumber} 학생을 찾지 못했습니다.`);
            processedRows.push({
              studentNumber: studentNumber || "-",
              studentName: "찾을 수 없음",
              extractedJobs: [],
              previousJobs: [],
              status: "error",
              message: "학생을 찾지 못했습니다.",
            });
            return;
          }

          const extractedJobs = extractJobsFromRow(row);
          const jobErrors = validateJobs(extractedJobs, student.name);
          if (jobErrors.length > 0) {
            errors.push(...jobErrors);
            processedRows.push({
              studentNumber,
              studentName: student.name,
              extractedJobs,
              previousJobs: [],
              status: "error",
              message: "정의되지 않은 직업명이 포함되어 있습니다.",
            });
            return;
          }

          const previousJobs = Array.isArray(student.jobs)
            ? student.jobs.filter((job) => job !== "없음")
            : student.job && student.job !== "없음"
            ? [student.job]
            : [];
          const nextJobs = extractedJobs.filter((job) => job !== "없음");

          const isChanged =
            nextJobs.length !== previousJobs.length ||
            !nextJobs.every((job) => previousJobs.includes(job)) ||
            !previousJobs.every((job) => nextJobs.includes(job));

          if (isChanged) {
            updatedAssignments.push({
              studentUid: student.uid,
              jobs: extractedJobs,
            });
            updatedCount += 1;
          }

          processedRows.push({
            studentNumber,
            studentName: student.name,
            extractedJobs,
            previousJobs,
            status: isChanged ? "updated" : "unchanged",
            message: isChanged ? "직업 배정을 반영했습니다." : "변경사항이 없습니다.",
          });
        });

        if (updatedCount > 0) {
          await assignStudentJobs({
            classId,
            source: "xlsx_upload",
            assignments: updatedAssignments,
          });
        }

        if (updatedCount > 0 && errors.length === 0) {
          showFeedback(`직업 배정 ${updatedCount}건을 반영했습니다.`, "success");
        } else if (updatedCount > 0) {
          showFeedback(
            `직업 배정 ${updatedCount}건을 반영했고 ${errors.length}건은 확인이 필요합니다.`,
            "warning",
          );
        } else if (errors.length > 0) {
          showFeedback("반영된 변경은 없고 오류만 확인되었습니다.", "warning");
        } else {
          showFeedback("변경된 직업 배정이 없습니다.", "info");
        }

        setPreviewData(processedRows);
        setLastProcessingResult({
          type: "excel-upload",
          success: true,
          updatedCount,
          errorCount: errors.length,
          errors,
          processedData: processedRows,
        });
      } catch (error) {
        console.error("[JobAssignByXLSX] upload error:", error);
        showFeedback(
          getXlsxImportErrorMessage(
            error,
            "엑셀 파일을 처리하는 중 오류가 발생했습니다.",
          ),
          "error",
        );
        setLastProcessingResult({
          type: "excel-upload",
          success: false,
          error: error.message,
          updatedCount: 0,
          errorCount: 1,
        });
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = null;
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <TaxExcelPanel
      title="직업 배정 엑셀 업로드"
      description="샘플 파일을 내려받아 수정한 뒤 업로드하세요. xlsx 형식만 지원합니다."
      helper={
        <div className="space-y-2">
          <p className="font-semibold text-indigo-900">
            한 학생에게 여러 직업을 동시에 배정할 수 있습니다.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>
              직업 컬럼은 <code>직업1</code>, <code>직업2</code>,{" "}
              <code>직업3</code>처럼 필요한 만큼 채우면 됩니다.
            </li>
            <li>빈 칸은 자동으로 무시하고, 직업이 없으면 첫 칸에 없음만 적으면 됩니다.</li>
            <li>엑셀에 적은 직업명은 먼저 직업정의 탭에 등록되어 있어야 합니다.</li>
          </ul>
        </div>
      }
      fileInputRef={fileInputRef}
      onFileChange={handleFileUpload}
      onOpenFilePicker={() => fileInputRef.current?.click()}
      onDownloadSample={handleDownloadSampleXLSX}
      fileName={fileName}
      isProcessing={isProcessing}
      processingLabel="직업 배정 엑셀을 처리하는 중입니다."
    >
      {previewData.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">
                처리 결과 미리보기{" "}
                <span className="text-slate-500">({previewData.length}건)</span>
              </h4>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="emerald">업데이트 {counts.updated}</Badge>
                <Badge tone="slate">변경 없음 {counts.unchanged}</Badge>
                <Badge tone="red">오류 {counts.error}</Badge>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                kind="ghost"
                tone="lightBlue"
                onClick={resetPreview}
              >
                닫기
              </Button>
              <Button
                size="sm"
                kind="solid"
                tone="lightBlue"
                onClick={handleConfirmAndApply}
                disabled={!lastProcessingResult}
              >
                확인
              </Button>
            </div>
          </div>

          <div className="max-h-72 overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-slate-700">
                  <th className="p-2 text-center font-medium">학번</th>
                  <th className="p-2 text-center font-medium">이름</th>
                  <th className="p-2 text-center font-medium">추출된 직업</th>
                  <th className="p-2 text-center font-medium">이전 직업</th>
                  <th className="p-2 text-center font-medium">상태</th>
                  <th className="p-2 text-left font-medium">메시지</th>
                </tr>
              </thead>
              <tbody>
                {previewData.map((row, index) => (
                  <tr
                    key={`${row.studentNumber}-${index}`}
                    className={`border-b hover:bg-slate-100 ${getRowClassName(row.status)}`}
                  >
                    <td className="p-2 text-center">{row.studentNumber || "-"}</td>
                    <td className="p-2 text-center font-medium text-slate-800">
                      {row.studentName || "-"}
                    </td>
                    <td className="p-2">
                      {row.extractedJobs?.length ? (
                        <div className="flex flex-wrap justify-center gap-1">
                          {row.extractedJobs.map((job, jobIndex) => (
                            <span
                              key={`${row.studentNumber}-new-${jobIndex}`}
                              className={`rounded-full border px-2 py-1 text-[11px] leading-4 ${
                                job === "없음"
                                  ? "border-slate-200 bg-slate-100 text-slate-700"
                                  : "border-indigo-200 bg-indigo-100 text-indigo-700"
                              }`}
                            >
                              {job}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-2">
                      {row.previousJobs?.length ? (
                        <div className="flex flex-wrap justify-center gap-1">
                          {row.previousJobs.map((job, jobIndex) => (
                            <span
                              key={`${row.studentNumber}-old-${jobIndex}`}
                              className="rounded-full border border-amber-200 bg-amber-100 px-2 py-1 text-[11px] leading-4 text-amber-800"
                            >
                              {job}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">없음</span>
                      )}
                    </td>
                    <td className="p-2 text-center">{getStatusBadge(row.status)}</td>
                    <td className="p-2 text-xs text-slate-600">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </TaxExcelPanel>
  );
};

export default JobAssignByXLSX;
