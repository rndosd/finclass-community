import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Badge, Button } from '../../../components/ui';
import { db } from '../../../firebase';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { useUser } from '../../../contexts/UserContext';
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
} from '../../../utils/safeXlsxImport';
import { getPath } from '../utils/taxPathUtils';
import TaxExcelPanel from './TaxExcelPanel';

const parseSalaryValue = (value) => {
  if (value === null || value === undefined) return NaN;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return NaN;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.floor(parsed) : NaN;
};

const parseOptionalHeadcountValue = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  return Math.floor(parsed);
};

const normalizeDescription = (value) => String(value ?? '').trim();

const formatHeadcountForPreview = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return value.toLocaleString();
  return value;
};

const getStatusBadge = (status) => {
  switch (status) {
    case 'new':
      return <Badge tone="emerald">신규</Badge>;
    case 'update':
      return <Badge tone="blue">수정</Badge>;
    case 'invalid':
      return <Badge tone="red">오류</Badge>;
    default:
      return <Badge tone="slate">대기</Badge>;
  }
};

const getRowClassName = (status) => {
  if (status === 'invalid') return 'bg-rose-50';
  if (status === 'update') return 'bg-blue-50';
  if (status === 'new') return 'bg-emerald-50';
  return 'bg-white';
};

const JobDefinitionByXLSX = ({ onProcessingDone, jobDefinitions = [] }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classId } = useUser();
  const { showFeedback } = useFeedback();

  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [jobsToProcess, setJobsToProcess] = useState([]);

  const counts = useMemo(
    () => ({
      new: jobsToProcess.filter((job) => job.status === 'new').length,
      update: jobsToProcess.filter((job) => job.status === 'update').length,
      invalid: jobsToProcess.filter((job) => job.status === 'invalid').length,
    }),
    [jobsToProcess],
  );

  const resetPreview = () => {
    setJobsToProcess([]);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
    }
  };

  const handleDownloadSample = () => {
    const worksheetData = [
      ['직업명', '직업 설명 (선택)', '급여', '목표 인원'],
      ['학급 기자', '학급 소식을 정리하고 전달합니다.', 200, 2],
      ['디자이너', '포스터와 안내 자료를 제작합니다.', 180, 1],
      ['도서 관리자', '교실 도서를 정리하고 대출을 돕습니다.', 150, ''],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '직업정의');
    XLSX.writeFile(workbook, '직업정의_샘플.xlsx');
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      validateXlsxImportFile(file);
    } catch (error) {
      showFeedback(getXlsxImportErrorMessage(error), 'error');
      event.target.value = '';
      return;
    }

    setFileName(file.name);
    setJobsToProcess([]);
    setIsProcessing(true);

    const reader = new FileReader();

    reader.onload = (loadEvent) => {
      try {
        const { rows } = parseFirstXlsxWorksheet(loadEvent.target?.result, {
          file,
        });

        const existingJobsByName = new Map(
          jobDefinitions
            .filter((job) => typeof job?.name === 'string' && job.name.trim())
            .map((job) => [job.name.trim().toLowerCase(), job]),
        );

        const processedRows = rows
          .map((row) => {
            const nameValue = row['직업명'] ?? row.jobName ?? row.name ?? '';
            const descriptionValue =
              row['직업 설명'] ??
              row['직업 설명 (선택)'] ??
              row.description ??
              row.desc ??
              '';
            const salaryValue = row['급여'] ?? row.baseSalary ?? row.salary ?? '';
            const targetHeadcountValue =
              row['목표 인원'] ??
              row.targetHeadcount ??
              row.headcount ??
              row.capacity ??
              '';

            const name = String(nameValue).trim();
            const description = normalizeDescription(descriptionValue);
            const baseSalary = parseSalaryValue(salaryValue);
            const targetHeadcount = parseOptionalHeadcountValue(targetHeadcountValue);

            if (!name || Number.isNaN(baseSalary) || Number.isNaN(targetHeadcount)) {
              return {
                name: name || '이름 없음',
                description,
                baseSalary: Number.isNaN(baseSalary) ? '유효하지 않음' : baseSalary,
                targetHeadcount: Number.isNaN(targetHeadcount) ? '유효하지 않음' : targetHeadcount,
                status: 'invalid',
              };
            }

            const existing = existingJobsByName.get(name.toLowerCase());

            return {
              name,
              description,
              baseSalary,
              targetHeadcount,
              status: existing?.id ? 'update' : 'new',
              existingId: existing?.id || null,
            };
          })
          .filter((item) => item.name);

        setJobsToProcess(processedRows);

        if (processedRows.length === 0) {
          showFeedback('엑셀에서 처리할 직업 정보를 찾지 못했습니다.', 'warning');
        } else {
          showFeedback(`엑셀 내용을 ${processedRows.length}건 확인했습니다.`, 'success');
        }
      } catch (error) {
        console.error('[JobDefinitionByXLSX] parse error:', error);
        showFeedback(getXlsxImportErrorMessage(error), 'error');
      } finally {
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setIsProcessing(false);
      showFeedback('파일을 읽지 못했습니다.', 'error');
    };

    reader.readAsArrayBuffer(file);
  };

  const handleUpload = async () => {
    const validJobs = jobsToProcess.filter((job) => job.status !== 'invalid');

    if (!classId || validJobs.length === 0) {
      showFeedback('업로드할 유효한 직업 정보가 없습니다.', 'warning');
      return;
    }

    const collectionPath = getPath('jobDefinitions', classId);
    if (!collectionPath) {
      showFeedback('직업 정의 저장 경로를 찾지 못했습니다.', 'error');
      return;
    }

    setIsUploading(true);
    try {
      const batch = writeBatch(db);

      validJobs.forEach((job) => {
        const payload = {
          name: job.name,
          description: normalizeDescription(job.description),
          baseSalary: job.baseSalary,
          targetHeadcount: job.targetHeadcount,
          updatedAt: serverTimestamp(),
        };

        if (job.status === 'update' && job.existingId) {
          batch.set(
            doc(db, getPath('jobDefinition', classId, { docId: job.existingId })),
            payload,
            { merge: true },
          );
          return;
        }

        batch.set(doc(collection(db, collectionPath)), {
          ...payload,
          linkedPermissionKeys: [],
          createdAt: serverTimestamp(),
        });
      });

      await batch.commit();

      showFeedback(`직업 정의 ${validJobs.length}건을 저장했습니다.`, 'success');

      if (typeof onProcessingDone === 'function') {
        onProcessingDone();
      }

      resetPreview();
    } catch (error) {
      console.error('[JobDefinitionByXLSX] upload error:', error);
      showFeedback(`업로드 중 오류가 발생했습니다: ${error.message}`, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <TaxExcelPanel
      title="직업 정의 엑셀 업로드"
      description="샘플 파일을 내려받아 수정한 뒤 업로드하세요. xlsx 형식만 지원합니다."
      helper={
        <div className="space-y-2">
          <p className="font-semibold text-indigo-900">
            직업명, 급여, 목표 인원을 엑셀에서 한 번에 정리해 반영할 수 있습니다.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>
              사용 가능한 컬럼은 <code>직업명</code>, <code>직업 설명 (선택)</code>,{' '}
              <code>급여</code>, <code>목표 인원</code>입니다.
            </li>
            <li>같은 직업명이 이미 있으면 새로 만들지 않고 기존 직업을 수정합니다.</li>
            <li>목표 인원을 비워두면 미설정 상태로 저장됩니다.</li>
          </ul>
        </div>
      }
      fileInputRef={fileInputRef}
      onFileChange={handleFileChange}
      onOpenFilePicker={() => fileInputRef.current?.click()}
      onDownloadSample={handleDownloadSample}
      fileName={fileName}
      isProcessing={isProcessing}
      processingLabel="엑셀 파일을 분석하는 중입니다."
    >
      {jobsToProcess.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">
                업로드 미리보기 <span className="text-slate-500">({jobsToProcess.length}건)</span>
              </h4>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="emerald">신규 {counts.new}</Badge>
                <Badge tone="blue">수정 {counts.update}</Badge>
                <Badge tone="red">오류 {counts.invalid}</Badge>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" kind="ghost" tone="blue" onClick={resetPreview} disabled={isUploading}>
                초기화
              </Button>
              <Button
                size="sm"
                tone="blue"
                onClick={handleUpload}
                disabled={isUploading}
                isLoading={isUploading}
              >
                미리보기 업로드
              </Button>
            </div>
          </div>

          <div className="max-h-72 overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-slate-700">
                  <th className="p-2 text-center font-medium">상태</th>
                  <th className="p-2 text-center font-medium">직업명</th>
                  <th className="p-2 text-left font-medium">직업 설명</th>
                  <th className="p-2 text-right font-medium">급여</th>
                  <th className="p-2 text-right font-medium">목표 인원</th>
                </tr>
              </thead>
              <tbody>
                {jobsToProcess.map((job, index) => (
                  <tr
                    key={`${job.name}-${index}`}
                    className={`border-b hover:bg-slate-100 ${getRowClassName(job.status)}`}
                  >
                    <td className="p-2 text-center">{getStatusBadge(job.status)}</td>
                    <td className="p-2 text-center font-medium text-slate-800">{job.name}</td>
                    <td className="whitespace-pre-line p-2 text-slate-600">
                      {job.description || '-'}
                    </td>
                    <td className="p-2 text-right font-mono text-slate-700">
                      {typeof job.baseSalary === 'number'
                        ? formatDisplayMoney(job.baseSalary)
                        : job.baseSalary}
                    </td>
                    <td className="p-2 text-right font-mono text-slate-700">
                      {formatHeadcountForPreview(job.targetHeadcount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </TaxExcelPanel>
  );
};

export default JobDefinitionByXLSX;
