import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { Button, Card, InputField, Textarea } from '../../../components/ui';
import JobDefinitionByXLSX from '../components/JobDefinitionByXLSX';
import JobRowEditable, { JobCardEditable } from '../components/JobRowEditable';
import { useJobDefinitionsManager } from '../hooks/useJobDefinitionsManager';
import { PERMISSION_CONFIG } from '../../admin/PermissionConfig';

const displayText = (value) => String(value ?? '').trim();
const displayNumber = (value) => String(value ?? '').replace(/,/g, '').trim();

const JobDefinitionTab = ({ jobDefinitions = [], currencyUnit, isReadOnly = false }) => {
  const displayCurrencyUnit = currencyUnit || '원';
  const { isLoading, handleAddJob, handleUpdateJob, handleDeleteJob, showFeedback } =
    useJobDefinitionsManager();

  const [newJobName, setNewJobName] = useState('');
  const [newJobDescription, setNewJobDescription] = useState('');
  const [newJobSalary, setNewJobSalary] = useState('');
  const [newJobTargetHeadcount, setNewJobTargetHeadcount] = useState('');
  const [draftsByJobId, setDraftsByJobId] = useState({});

  const isAnyMutating = isLoading.add || isLoading.update || isLoading.delete;

  const permissionOptions = useMemo(
    () =>
      PERMISSION_CONFIG.map((permission) => ({
        key: permission.key,
        label: permission.label,
        color: permission.color,
        group: permission.group,
      })),
    [],
  );

  const existingNameSet = useMemo(
    () =>
      new Set(
        jobDefinitions
          .map((job) => String(job?.name ?? '').trim().toLowerCase())
          .filter(Boolean),
      ),
    [jobDefinitions],
  );

  const jobsById = useMemo(
    () => new Map(jobDefinitions.map((job) => [job.id, job])),
    [jobDefinitions],
  );

  const isDraftEqualToJob = useCallback((job, draft) => {
    if (!job || !draft) return false;

    return (
      displayText(draft.description) === displayText(job.description) &&
      displayNumber(draft.baseSalary) === displayNumber(job.baseSalary) &&
      displayNumber(draft.targetHeadcount) === displayNumber(job.targetHeadcount)
    );
  }, []);

  const handleDraftChange = useCallback(
    (jobId, partialDraft) => {
      setDraftsByJobId((prev) => {
        const job = jobsById.get(jobId);
        if (!job) return prev;

        const nextDraft = {
          description:
            partialDraft.description ?? prev[jobId]?.description ?? job.description ?? '',
          baseSalary: partialDraft.baseSalary ?? prev[jobId]?.baseSalary ?? job.baseSalary ?? '',
          targetHeadcount:
            partialDraft.targetHeadcount ??
            prev[jobId]?.targetHeadcount ??
            job.targetHeadcount ??
            '',
        };

        if (isDraftEqualToJob(job, nextDraft)) {
          const { [jobId]: _removedDraft, ...rest } = prev;
          return rest;
        }

        return {
          ...prev,
          [jobId]: nextDraft,
        };
      });
    },
    [isDraftEqualToJob, jobsById],
  );

  const dirtyJobIds = useMemo(() => Object.keys(draftsByJobId), [draftsByJobId]);

  const handleSaveAll = async () => {
    if (dirtyJobIds.length === 0) {
      showFeedback('저장할 변경사항이 없습니다.', 'info');
      return;
    }

    const savedJobIds = [];
    let failedCount = 0;

    for (const jobId of dirtyJobIds) {
      const draft = draftsByJobId[jobId];
      const success = await handleUpdateJob(jobId, draft, {
        suppressSuccessFeedback: true,
      });

      if (success) {
        savedJobIds.push(jobId);
      } else {
        failedCount += 1;
      }
    }

    if (savedJobIds.length > 0) {
      setDraftsByJobId((prev) => {
        const next = { ...prev };
        savedJobIds.forEach((jobId) => {
          delete next[jobId];
        });
        return next;
      });
    }

    if (savedJobIds.length > 0 && failedCount === 0) {
      showFeedback(`${savedJobIds.length}개 직업을 저장했습니다.`, 'success');
      return;
    }

    if (savedJobIds.length > 0) {
      showFeedback(
        `${savedJobIds.length}개 저장, ${failedCount}개는 다시 확인해 주세요.`,
        'warning',
      );
      return;
    }

    showFeedback('변경사항을 저장하지 못했습니다.', 'error');
  };

  const onAddJobClick = async () => {
    const trimmedName = String(newJobName ?? '').trim();

    if (!trimmedName) {
      showFeedback('직업명을 입력해 주세요.', 'error');
      return;
    }

    if (existingNameSet.has(trimmedName.toLowerCase())) {
      showFeedback(`직업 '${trimmedName}'은(는) 이미 존재합니다.`, 'error');
      return;
    }

    await handleAddJob(
      trimmedName,
      newJobDescription,
      newJobSalary,
      newJobTargetHeadcount,
      () => {
        setNewJobName('');
        setNewJobDescription('');
        setNewJobSalary('');
        setNewJobTargetHeadcount('');
      },
    );
  };

  return (
    <div className="space-y-6">
      <div data-tour="tax-job-definition-table">
        <Card>
          <Card.Header className="flex-wrap items-center gap-3">
            <Card.Title>직업 관리</Card.Title>

            {!isReadOnly ? (
              <div className="ml-auto flex items-center gap-3 self-start sm:self-auto">
                <span className="inline-flex min-h-[2.25rem] items-center text-sm text-slate-500">
                  변경 {dirtyJobIds.length}개
                </span>
                <Button
                  size="sm"
                  tone="blue"
                  icon={Save}
                  onClick={handleSaveAll}
                  disabled={dirtyJobIds.length === 0 || isAnyMutating}
                  isLoading={isLoading.update}
                  className="min-w-[6.5rem] justify-center"
                >
                  전체 저장
                </Button>
              </div>
            ) : null}
          </Card.Header>

          <Card.Content noPadding>
            <div className="space-y-3 md:hidden">
              {jobDefinitions.map((job) => (
                <JobCardEditable
                  key={job.id}
                  job={job}
                  draft={draftsByJobId[job.id]}
                  onDraftChange={handleDraftChange}
                  onUpdate={handleUpdateJob}
                  onDelete={() => handleDeleteJob(job.id, job.name)}
                  isLoading={isAnyMutating}
                  currencyUnit={displayCurrencyUnit}
                  readOnly={isReadOnly}
                  permissionOptions={permissionOptions}
                />
              ))}

              {!isReadOnly ? (
                <section className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4">
                  <p className="mb-4 font-bold text-slate-800">새 직업 추가</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="col-span-2 space-y-1.5">
                      <span className="text-xs font-semibold text-slate-500">직업명</span>
                      <InputField
                        placeholder="새 직업명"
                        value={newJobName}
                        onChange={(event) => setNewJobName(event.target.value)}
                        disabled={isLoading.add}
                        className="h-11"
                      />
                    </label>
                    <label className="col-span-2 space-y-1.5">
                      <span className="text-xs font-semibold text-slate-500">직업 설명</span>
                      <Textarea
                        placeholder="직업 설명"
                        value={newJobDescription}
                        onChange={(event) => setNewJobDescription(event.target.value)}
                        disabled={isLoading.add}
                        rows={3}
                        className="min-h-24 resize-y"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold text-slate-500">
                        급여 ({displayCurrencyUnit})
                      </span>
                      <InputField
                        type="number"
                        placeholder="급여"
                        value={newJobSalary}
                        onChange={(event) => setNewJobSalary(event.target.value)}
                        min="0"
                        disabled={isLoading.add}
                        className="h-11 text-right"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold text-slate-500">목표 인원</span>
                      <InputField
                        type="number"
                        placeholder="미설정"
                        value={newJobTargetHeadcount}
                        onChange={(event) =>
                          setNewJobTargetHeadcount(event.target.value)
                        }
                        min="0"
                        disabled={isLoading.add}
                        className="h-11 text-right"
                      />
                    </label>
                  </div>
                  <Button
                    size="sm"
                    tone="blue"
                    onClick={onAddJobClick}
                    disabled={!newJobName.trim() || !newJobSalary || isLoading.add}
                    isLoading={isLoading.add}
                    icon={Plus}
                    className="mt-4 w-full justify-center"
                  >
                    직업 추가
                  </Button>
                </section>
              ) : null}

              {jobDefinitions.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  아직 등록된 직업이 없습니다.
                </div>
              ) : null}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[880px] w-full table-fixed text-sm">
              <thead className="bg-slate-100 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-32 px-3 py-3.5 align-middle font-semibold">직업명</th>
                  <th className="px-3 py-3.5 align-middle font-semibold">직업 설명</th>
                  <th className="w-28 px-3 py-3.5 align-middle text-right font-semibold">
                    급여 ({displayCurrencyUnit})
                  </th>
                  <th className="w-24 px-3 py-3.5 align-middle text-right font-semibold">
                    목표 인원
                  </th>
                  <th className="w-36 px-3 py-3.5 align-middle font-semibold">연결 권한</th>
                  <th className="w-28 px-3 py-3.5 align-middle text-center font-semibold">
                    관리
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobDefinitions.map((job) => (
                  <JobRowEditable
                    key={job.id}
                    job={job}
                    draft={draftsByJobId[job.id]}
                    onDraftChange={handleDraftChange}
                    onUpdate={handleUpdateJob}
                    onDelete={() => handleDeleteJob(job.id, job.name)}
                    isLoading={isAnyMutating}
                    currencyUnit={displayCurrencyUnit}
                    readOnly={isReadOnly}
                    permissionOptions={permissionOptions}
                  />
                ))}

                {!isReadOnly ? (
                  <tr className="bg-slate-50/60">
                    <td className="px-3 py-3 align-middle">
                      <InputField
                        placeholder="새 직업명"
                        value={newJobName}
                        onChange={(event) => setNewJobName(event.target.value)}
                        disabled={isLoading.add}
                        className="h-10"
                      />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <Textarea
                        placeholder="직업 설명"
                        value={newJobDescription}
                        onChange={(event) => setNewJobDescription(event.target.value)}
                        disabled={isLoading.add}
                        rows={2}
                        className="min-h-16 resize-y"
                      />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <InputField
                        type="number"
                        placeholder="급여"
                        value={newJobSalary}
                        onChange={(event) => setNewJobSalary(event.target.value)}
                        min="0"
                        disabled={isLoading.add}
                        className="h-10 text-right"
                      />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <InputField
                        type="number"
                        placeholder="미설정"
                        value={newJobTargetHeadcount}
                        onChange={(event) => setNewJobTargetHeadcount(event.target.value)}
                        min="0"
                        disabled={isLoading.add}
                        className="h-10 text-right"
                      />
                    </td>
                    <td className="px-3 py-3 align-middle text-xs text-slate-400">
                      <div className="flex min-h-[2.75rem] items-center">
                        새 직업은 여기서 바로 추가할 수 있습니다.
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle text-center">
                      <Button
                        size="sm"
                        tone="blue"
                        onClick={onAddJobClick}
                        disabled={!newJobName.trim() || !newJobSalary || isLoading.add}
                        isLoading={isLoading.add}
                        icon={Plus}
                        className="min-w-[6rem] justify-center"
                      >
                        추가
                      </Button>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            {jobDefinitions.length === 0 ? (
              <div className="py-10 text-center text-slate-500">
                아직 등록된 직업이 없습니다.
                {!isReadOnly ? ' 위 입력칸에서 새 직업을 추가해 보세요.' : ''}
              </div>
            ) : null}
            </div>
          </Card.Content>
        </Card>
      </div>

      {!isReadOnly ? (
        <div data-tour="tax-job-definition-upload">
          <JobDefinitionByXLSX jobDefinitions={jobDefinitions} />
        </div>
      ) : null}
    </div>
  );
};

export default JobDefinitionTab;
