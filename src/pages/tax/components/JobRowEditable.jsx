import { appConfirm } from "../../../utils/appDialogs";
import React, { useMemo, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { Badge, Button, InputField, Modal, Textarea } from '../../../components/ui';
import JobPermissionModal from './JobPermissionModal';
import { filterJobLinkedPermissionKeys } from './jobLinkedPermissionUtils';

const formatSalary = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString();
};

const formatTargetHeadcount = (value) => {
  if (value === null || value === undefined || value === '') return '미설정';
  const num = Number(value);
  if (!Number.isFinite(num)) return '미설정';
  return `${Math.floor(num).toLocaleString()}명`;
};

const normalizeText = (value) => String(value ?? '').trim();
const normalizeNumberText = (value) => String(value ?? '').replace(/,/g, '').trim();

const renderPermissionBadges = (linkedPermissionKeys = [], permissionOptions = []) => {
  const visiblePermissionKeys = filterJobLinkedPermissionKeys(linkedPermissionKeys);

  if (visiblePermissionKeys.length === 0) {
    return (
      <span className="inline-flex min-h-[1.75rem] items-center text-[11px] text-slate-400">
        연결 권한 없음
      </span>
    );
  }

  return visiblePermissionKeys.map((permissionKey) => {
    const permission = permissionOptions.find((item) => item.key === permissionKey);

    return (
      <Badge
        key={permissionKey}
        color={permission?.color || 'slate'}
        size="sm"
        variant="soft"
        className="min-h-[1.75rem] px-2.5 py-0.5 text-center text-[10px] leading-4"
      >
        {permission?.label || permissionKey}
      </Badge>
    );
  });
};

const PermissionCell = ({
  linkedPermissionKeys = [],
  permissionOptions = [],
  editable = false,
  isLoading = false,
  onOpen = null,
  compact = false,
}) => (
  <div className={`flex min-h-[2.75rem] gap-2 ${compact ? 'flex-col items-start' : 'items-center justify-between'}`}>
    <div className="flex flex-1 flex-wrap items-center content-center gap-1.5 overflow-hidden">
      {compact ? <span className="text-xs text-slate-600">{filterJobLinkedPermissionKeys(linkedPermissionKeys).length ? `관리 권한 ${filterJobLinkedPermissionKeys(linkedPermissionKeys).length}개` : '연결 권한 없음'}</span> : renderPermissionBadges(linkedPermissionKeys, permissionOptions)}
    </div>

    {editable ? (
      <Button
        size="sm"
        kind="outline"
        tone="blue"
        onClick={onOpen}
        disabled={isLoading}
        icon={KeyRound}
        className={compact ? "whitespace-nowrap px-2 text-xs justify-center" : "min-w-[7rem] shrink-0 justify-center"}
      >
        권한 설정
      </Button>
    ) : null}
  </div>
);

const JobRowEditable = ({
  job,
  draft = null,
  onDraftChange = null,
  onUpdate,
  onDelete,
  isLoading,
  currencyUnit,
  readOnly = false,
  permissionOptions = [],
}) => {
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);

  const descriptionValue = draft?.description ?? job.description ?? '';
  const salaryValue = draft?.baseSalary ?? job.baseSalary ?? 0;
  const targetHeadcountValue = draft?.targetHeadcount ?? job.targetHeadcount ?? '';

  const isChanged = useMemo(
    () =>
      normalizeText(descriptionValue) !== normalizeText(job.description) ||
      normalizeNumberText(salaryValue) !== normalizeNumberText(job.baseSalary) ||
      normalizeNumberText(targetHeadcountValue) !== normalizeNumberText(job.targetHeadcount),
    [
      descriptionValue,
      salaryValue,
      targetHeadcountValue,
      job.description,
      job.baseSalary,
      job.targetHeadcount,
    ],
  );

  const handleDeleteClick = async () => {
    if ((await appConfirm(`'${job.name}' 직업을 삭제하시겠습니까?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) {
      onDelete();
    }
  };

  if (readOnly) {
    return (
      <tr className="bg-white hover:bg-slate-50">
        <td className="px-3 py-3.5 align-middle font-medium text-slate-800">{job.name}</td>
        <td className="whitespace-pre-line px-3 py-3.5 align-middle text-slate-700">
          {job.description || '-'}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 align-middle text-right">
          {formatSalary(job.baseSalary)} {currencyUnit}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 align-middle text-right text-slate-700">
          {formatTargetHeadcount(job.targetHeadcount)}
        </td>
        <td className="px-3 py-3.5 align-middle">
          <PermissionCell
            linkedPermissionKeys={job.linkedPermissionKeys}
            permissionOptions={permissionOptions}
          />
        </td>
        <td className="px-3 py-3.5 align-middle text-center text-slate-400">-</td>
      </tr>
    );
  }

  return (
    <>
      <tr className={`hover:bg-slate-50 ${isChanged ? 'bg-yellow-50' : 'bg-white'}`}>
        <td className="px-3 py-3 align-middle font-medium text-slate-800">{job.name}</td>
        <td className="min-w-[240px] px-3 py-3 align-middle">
          <Textarea
            aria-label={`${job.name} 설명`}
            value={descriptionValue}
            onChange={(event) =>
              onDraftChange?.(job.id, {
                description: event.target.value,
              })
            }
            placeholder="직업 설명"
            disabled={isLoading}
            rows={2}
            className="min-h-16 resize-y"
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <InputField
            aria-label={`${job.name} 급여`}
            type="number"
            value={salaryValue}
            onChange={(event) =>
              onDraftChange?.(job.id, {
                baseSalary: event.target.value,
              })
            }
            min="0"
            className="h-10 text-right"
            disabled={isLoading}
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <InputField
            aria-label={`${job.name} 목표 인원`}
            type="number"
            value={targetHeadcountValue}
            onChange={(event) =>
              onDraftChange?.(job.id, {
                targetHeadcount: event.target.value,
              })
            }
            min="0"
            placeholder="미설정"
            className="h-10 text-right"
            disabled={isLoading}
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <PermissionCell
            compact
            linkedPermissionKeys={job.linkedPermissionKeys}
            permissionOptions={permissionOptions}
            editable
            isLoading={isLoading}
            onOpen={() => setIsPermissionModalOpen(true)}
          />
        </td>
        <td className="px-3 py-3 align-middle text-center">
          <div className="flex min-h-[2.75rem] flex-col items-center justify-center gap-2">
            <span
              className={`inline-flex min-h-[1.75rem] items-center text-xs ${
                isChanged ? 'text-amber-600' : 'text-slate-400'
              }`}
            >
              {isChanged ? '저장 대기' : '변경 없음'}
            </span>
            <Button
              size="sm"
              kind="outline"
              tone="red"
              onClick={handleDeleteClick}
              disabled={isLoading}
              icon={Trash2}
              className="whitespace-nowrap px-2 text-xs justify-center"
            >
              삭제
            </Button>
          </div>
        </td>
      </tr>

      <JobPermissionModal
        job={job}
        permissionOptions={permissionOptions}
        isOpen={isPermissionModalOpen}
        isSaving={isLoading}
        onClose={() => setIsPermissionModalOpen(false)}
        onSave={async (jobId, payload) => {
          await onUpdate(jobId, payload);
          setIsPermissionModalOpen(false);
        }}
      />
    </>
  );
};

export const JobCardEditable = ({
  job,
  draft = null,
  onDraftChange = null,
  onUpdate,
  onDelete,
  isLoading,
  currencyUnit,
  readOnly = false,
  permissionOptions = [],
}) => {
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const descriptionValue = draft?.description ?? job.description ?? '';
  const salaryValue = draft?.baseSalary ?? job.baseSalary ?? 0;
  const targetHeadcountValue = draft?.targetHeadcount ?? job.targetHeadcount ?? '';
  const isChanged =
    normalizeText(descriptionValue) !== normalizeText(job.description) ||
    normalizeNumberText(salaryValue) !== normalizeNumberText(job.baseSalary) ||
    normalizeNumberText(targetHeadcountValue) !== normalizeNumberText(job.targetHeadcount);

  const handleDeleteClick = async () => {
    if ((await appConfirm(`'${job.name}' 직업을 삭제하시겠습니까?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) {
      onDelete();
    }
  };

  return (
    <>
      <section
        className={`rounded-2xl border p-4 ${
          isChanged
            ? 'border-amber-200 bg-amber-50/60'
            : 'border-slate-200 bg-white'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-800">{job.name}</p>
            {readOnly ? (
              <p className="mt-1 whitespace-pre-line text-sm leading-5 text-slate-500">
                {job.description || '설명 없음'}
              </p>
            ) : null}
          </div>
          {isChanged ? (
            <Badge color="amber" size="sm" variant="soft">
              저장 대기
            </Badge>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-slate-400">급여</p>
            <p className="mt-1 font-bold text-slate-700">
              {formatSalary(salaryValue)} {currencyUnit}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">목표 인원</p>
            <p className="mt-1 font-bold text-slate-700">
              {formatTargetHeadcount(targetHeadcountValue)}
            </p>
          </div>
        </div>

        <p className="mt-3 whitespace-pre-line text-sm leading-5 text-slate-500">
          {descriptionValue || '설명 없음'}
        </p>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <PermissionCell
            linkedPermissionKeys={job.linkedPermissionKeys}
            permissionOptions={permissionOptions}
            editable={!readOnly}
            isLoading={isLoading}
            onOpen={() => setIsPermissionModalOpen(true)}
          />
        </div>

        {!readOnly ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              kind="outline"
              tone="blue"
              onClick={() => setIsEditModalOpen(true)}
              disabled={isLoading}
              className="justify-center"
            >
              정보 수정
            </Button>
            <Button
              size="sm"
              kind="outline"
              tone="red"
              onClick={handleDeleteClick}
              disabled={isLoading}
              icon={Trash2}
              className="justify-center"
            >
              직업 삭제
            </Button>
          </div>
        ) : null}
      </section>

      {!readOnly ? (
        <>
          <Modal
            isOpen={isEditModalOpen}
            onClose={() => setIsEditModalOpen(false)}
            title={`${job.name} 정보 수정`}
            size="full"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                입력을 마친 뒤 직업 목록 상단의 전체 저장을 눌러 반영하세요.
              </p>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">직업 설명</span>
                <Textarea
                  value={descriptionValue}
                  onChange={(event) =>
                    onDraftChange?.(job.id, { description: event.target.value })
                  }
                  placeholder="직업 설명"
                  disabled={isLoading}
                  rows={4}
                  className="min-h-28 resize-y"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">
                  급여 ({currencyUnit})
                </span>
                <InputField
                  type="number"
                  value={salaryValue}
                  onChange={(event) =>
                    onDraftChange?.(job.id, { baseSalary: event.target.value })
                  }
                  min="0"
                  disabled={isLoading}
                  className="h-11 text-right"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">목표 인원</span>
                <InputField
                  type="number"
                  value={targetHeadcountValue}
                  onChange={(event) =>
                    onDraftChange?.(job.id, {
                      targetHeadcount: event.target.value,
                    })
                  }
                  min="0"
                  placeholder="미설정"
                  disabled={isLoading}
                  className="h-11 text-right"
                />
              </label>
              <Button size="md"
                type="button"
                tone="blue"
                onClick={() => setIsEditModalOpen(false)}
                className="w-full justify-center"
              >
                입력 완료
              </Button>
            </div>
          </Modal>

          <JobPermissionModal
            job={job}
            permissionOptions={permissionOptions}
            isOpen={isPermissionModalOpen}
            isSaving={isLoading}
            onClose={() => setIsPermissionModalOpen(false)}
            onSave={async (jobId, payload) => {
              await onUpdate(jobId, payload);
              setIsPermissionModalOpen(false);
            }}
          />
        </>
      ) : null}
    </>
  );
};

export default JobRowEditable;
