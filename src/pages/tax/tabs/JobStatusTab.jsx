import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Briefcase,
  UserX,
  Users,
} from 'lucide-react';

import { Button, Card } from '../../../components/ui';
import StudentJobAssignmentModal from '../components/StudentJobAssignmentModal';
import { useStudentJobAssignmentManager } from '../hooks/useStudentJobAssignmentManager';

const EMPTY_JOB_VALUE = '없음';

const normalizeJobs = (student = {}) => {
  const rawJobs = Array.isArray(student.jobs)
    ? student.jobs
    : student.jobs
      ? [student.jobs]
      : student.job
        ? [student.job]
        : [];

  return Array.from(
    new Set(
      rawJobs
        .map((job) => String(job || '').trim())
        .filter((job) => job && job !== EMPTY_JOB_VALUE),
    ),
  );
};



const normalizeTargetHeadcount = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.floor(parsed);
};

const sortStudents = (students = []) =>
  [...students].sort((left, right) =>
    String(left?.name || '').localeCompare(String(right?.name || ''), 'ko-KR'),
  );

const sortGroups = (groups = [], sortState) => {
  const nextGroups = [...groups];

  nextGroups.sort((left, right) => {
    let comparison = 0;

    if (sortState.key === 'jobName') {
      comparison = left.jobName.localeCompare(right.jobName, 'ko-KR');
    }

    if (sortState.key === 'baseSalary') {
      comparison = Number(left.baseSalary || 0) - Number(right.baseSalary || 0);
    }

    if (sortState.key === 'count') {
      comparison = left.currentCount - right.currentCount;
    }

    if (comparison !== 0) {
      return sortState.direction === 'asc' ? comparison : comparison * -1;
    }

    return left.jobName.localeCompare(right.jobName, 'ko-KR');
  });

  return nextGroups;
};

const TableSection = ({ title, icon: Icon, subtitle = '', actions = null, children }) => (
  <Card noPadding variant="surface" tone="white" className="overflow-hidden">
    <Card.Header className="mb-0 flex-wrap gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
      <div className="flex items-center gap-3">
        {Icon ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            <Icon className="h-4.5 w-4.5" />
          </div>
        ) : null}

        <div>
          <Card.Title>{title}</Card.Title>
          {subtitle ? <Card.Description className="mt-0.5">{subtitle}</Card.Description> : null}
        </div>
      </div>

      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </Card.Header>

    <Card.Content noPadding>{children}</Card.Content>
  </Card>
);

const EmptyTableRow = ({ colSpan, text }) => (
  <tr>
    <td colSpan={colSpan} className="px-6 py-12 text-center text-sm text-slate-500">
      {text}
    </td>
  </tr>
);

const SortButton = ({ label, sortKey, sortState, onSort }) => {
  const isActive = sortState.key === sortKey;
  const Icon = !isActive
    ? ArrowUpDown
    : sortState.direction === 'asc'
      ? ArrowUp
      : ArrowDown;

  return (
    <Button
      type="button"
      size="xs"
      kind="ghost"
      tone="slate"
      rounded="lg"
      onClick={() => onSort(sortKey)}
      className="-mx-2 -my-1 px-2 py-1 font-inherit text-inherit hover:text-slate-600"
    >
      <span>{label}</span>
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
};

const HeadcountStatusCell = ({ currentCount, targetHeadcount, isUndefined = false }) => {
  const normalizedTargetHeadcount = normalizeTargetHeadcount(targetHeadcount);

  return (
    <div className="min-w-[110px] text-center">
      <p className="font-semibold text-slate-800">
        {currentCount} / {normalizedTargetHeadcount ?? '-'}
      </p>
      {isUndefined ? <p className="text-[11px] text-amber-600">정의 없음</p> : null}
    </div>
  );
};

export default function JobStatusTab({
  classId,
  students = [],
  jobDefinitions = [],
  currencyUnit,
  onNavigateTab,
  isReadOnly = false,
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatCurrency = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const [sortState, setSortState] = useState({
    key: 'jobName',
    direction: 'asc',
  });
  const [assignmentModalState, setAssignmentModalState] = useState({
    isOpen: false,
    initialJobName: '',
  });

  const { isSavingAssignments, handleApplyStudentJobAssignments } =
    useStudentJobAssignmentManager(classId);

  const { allGroups, assignedGroups, unfilledGroups, unassignedStudents } = useMemo(() => {
    const groupMap = new Map();

    jobDefinitions.forEach((job) => {
      const jobName = String(job?.name || '').trim();
      if (!jobName || groupMap.has(jobName)) return;

      groupMap.set(jobName, {
        key: job.id || jobName,
        jobId: job.id || null,
        jobName,
        description: String(job?.description || '').trim(),
        baseSalary: Number(job?.baseSalary || 0),
        targetHeadcount: normalizeTargetHeadcount(job?.targetHeadcount),
        isUndefined: false,
        students: [],
      });
    });

    const nextUnassignedStudents = [];

    students.forEach((student) => {
      const jobNames = normalizeJobs(student);
      const normalizedStudent = {
        uid: student.uid,
        name: student.name || '이름 없음',
        studentNumber: student.studentNumber || '',
        jobNames,
      };

      if (jobNames.length === 0) {
        nextUnassignedStudents.push(normalizedStudent);
        return;
      }

      jobNames.forEach((jobName) => {
        if (!groupMap.has(jobName)) {
          groupMap.set(jobName, {
            key: jobName,
            jobId: null,
            jobName,
            description: '',
            baseSalary: 0,
            targetHeadcount: null,
            isUndefined: true,
            students: [],
          });
        }

        groupMap.get(jobName).students.push(normalizedStudent);
      });
    });

    const nextAllGroups = Array.from(groupMap.values()).map((group) => {
      const sortedStudents = sortStudents(group.students);
      return {
        ...group,
        students: sortedStudents,
        currentCount: sortedStudents.length,
      };
    });

    const needsMoreStudents = (group) => {
      if (group.targetHeadcount !== null) {
        return group.currentCount < group.targetHeadcount;
      }

      return group.currentCount === 0;
    };

    return {
      allGroups: nextAllGroups,
      assignedGroups: nextAllGroups.filter((group) => group.currentCount > 0),
      unfilledGroups: nextAllGroups.filter(needsMoreStudents),
      unassignedStudents: sortStudents(nextUnassignedStudents),
    };
  }, [jobDefinitions, students]);

  const handleSort = (sortKey) => {
    setSortState((prev) => {
      if (prev.key === sortKey) {
        return {
          key: sortKey,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }

      return {
        key: sortKey,
        direction: sortKey === 'jobName' ? 'asc' : 'desc',
      };
    });
  };

  const filteredAssignedGroups = useMemo(
    () => sortGroups(assignedGroups, sortState),
    [assignedGroups, sortState],
  );

  const filteredUnfilledGroups = useMemo(
    () => sortGroups(unfilledGroups, sortState),
    [sortState, unfilledGroups],
  );

  const modalGroups = useMemo(
    () => sortGroups(allGroups, { key: 'jobName', direction: 'asc' }),
    [allGroups],
  );

  const recommendedAssignmentJobName = useMemo(
    () =>
      modalGroups.find(
        (group) =>
          group.targetHeadcount !== null && group.currentCount < group.targetHeadcount,
      )?.jobName ||
      modalGroups.find((group) => group.currentCount === 0)?.jobName ||
      modalGroups[0]?.jobName ||
      '',
    [modalGroups],
  );

  const openAssignmentModal = (jobName = '') => {
    setAssignmentModalState({
      isOpen: true,
      initialJobName: jobName || recommendedAssignmentJobName,
    });
  };

  const closeAssignmentModal = () => {
    setAssignmentModalState({
      isOpen: false,
      initialJobName: '',
    });
  };

  const handleSubmitJobAssignment = async ({ assignments = [] }) => {
    const result = await handleApplyStudentJobAssignments({ assignments });
    return result?.success;
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <TableSection
        title="직업별 배정 현황"
        icon={Briefcase}
        actions={
          <>
            {!isReadOnly ? (
              <Button
                size="sm"
                kind="outline"
                tone="blue"
                icon={Users}
                onClick={() => openAssignmentModal()}
                disabled={
                  students.length === 0 || modalGroups.length === 0 || isSavingAssignments
                }
              >
                학생 직업 배정
              </Button>
            ) : null}
            {!isReadOnly && onNavigateTab ? (
              <Button
                size="sm"
                kind="outline"
                tone="slate"
                icon={ArrowRight}
                onClick={() => onNavigateTab('payroll')}
              >
                급여 관리
              </Button>
            ) : null}
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-[1040px] w-full border-collapse">
            <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
              <tr className="border-b border-slate-200">
                <th className="px-5 py-4 text-left">
                  <SortButton
                    label="직업명"
                    sortKey="jobName"
                    sortState={sortState}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-5 py-4 text-left">
                  <SortButton
                    label="급여"
                    sortKey="baseSalary"
                    sortState={sortState}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-5 py-4 text-center">
                  <SortButton
                    label="인원 현황"
                    sortKey="count"
                    sortState={sortState}
                    onSort={handleSort}
                  />
                </th>
                <th className="px-5 py-4 text-left">학생 목록</th>
                <th className="px-5 py-4 text-center">배정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredAssignedGroups.length === 0 ? (
                <EmptyTableRow colSpan={5} text="배정된 학생이 있는 직업이 아직 없습니다." />
              ) : (
                filteredAssignedGroups.map((group) => (
                  <tr key={group.key} className="align-top hover:bg-slate-50/60">
                    <td className="px-5 py-4">
                      <p className="font-black text-slate-900">{group.jobName}</p>
                    </td>
                    <td className="px-5 py-4 text-sm font-black text-slate-700">
                      {formatCurrency(group.baseSalary, currencyUnit)}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <HeadcountStatusCell
                        currentCount={group.currentCount}
                        targetHeadcount={group.targetHeadcount}
                        isUndefined={group.isUndefined}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm leading-6 text-slate-700">
                        {group.students.map((student) => student.name).join(', ')}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-center">
                      {!isReadOnly ? (
                        <Button
                          size="xs"
                          kind="outline"
                          tone="blue"
                          icon={Users}
                          onClick={() => openAssignmentModal(group.jobName)}
                          disabled={students.length === 0 || isSavingAssignments}
                        >
                          학생 배정
                        </Button>
                      ) : (
                        <span className="text-sm text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </TableSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <TableSection title="추가 배정이 필요한 직업" icon={Users}>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                <tr className="border-b border-slate-200">
                  <th className="px-5 py-4 text-left">
                    <SortButton
                      label="직업명"
                      sortKey="jobName"
                      sortState={sortState}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-5 py-4 text-left">
                    <SortButton
                      label="급여"
                      sortKey="baseSalary"
                      sortState={sortState}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-5 py-4 text-center">인원 현황</th>
                  <th className="px-5 py-4 text-center">배정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredUnfilledGroups.length === 0 ? (
                  <EmptyTableRow colSpan={4} text="현재 추가 배정이 필요한 직업이 없습니다." />
                ) : (
                  filteredUnfilledGroups.map((group) => (
                    <tr key={group.key} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4 font-bold text-slate-900">{group.jobName}</td>
                      <td className="px-5 py-4 text-sm font-semibold text-slate-700">
                        {formatCurrency(group.baseSalary, currencyUnit)}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <HeadcountStatusCell
                          currentCount={group.currentCount}
                          targetHeadcount={group.targetHeadcount}
                          isUndefined={group.isUndefined}
                        />
                      </td>
                      <td className="px-5 py-4 text-center">
                        {!isReadOnly ? (
                          <Button
                            size="xs"
                            kind="outline"
                            tone="blue"
                            icon={Users}
                            onClick={() => openAssignmentModal(group.jobName)}
                            disabled={students.length === 0 || isSavingAssignments}
                          >
                            학생 배정
                          </Button>
                        ) : (
                          <span className="text-sm text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TableSection>

        <TableSection title="직업 미배정 학생" icon={UserX}>
          <div className="bg-white px-5 py-5">
            {unassignedStudents.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                현재 직업이 없는 학생이 없습니다.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {unassignedStudents.map((student) => (
                  <div
                    key={student.uid}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    {student.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TableSection>
      </div>

      {!isReadOnly ? (
        <StudentJobAssignmentModal
          isOpen={assignmentModalState.isOpen}
          onClose={closeAssignmentModal}
          mode="job"
          title="직업별 학생 배정"
          description="직업을 기준으로 학생을 한 번에 배정하거나 조정할 수 있습니다."
          students={students}
          jobDefinitions={jobDefinitions}
          initialJobName={assignmentModalState.initialJobName}
          isSubmitting={isSavingAssignments}
          onSubmit={handleSubmitJobAssignment}
        />
      ) : null}
    </div>
  );
}
