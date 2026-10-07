import { CheckCircle2, GraduationCap, Lock, Medal, Pencil, Plus, Send, Settings2 } from "lucide-react";

import { Button, Card, CategoryChipBar, Spinner, Tabs } from "../../../components/ui";
import {
  buildCertificateStatus,
  CertificateRecordCard,
  EmptyState,
  SectionLead,
} from "../CredentialsPage.parts";
import StudentCertificatePreviewCard from "../components/StudentCertificatePreviewCardV2";
import StudentCertificateOverviewTable from "../components/StudentCertificateOverviewTable";

const TEACHER_TABS = [
  { id: "overview", label: "학생 현황" },
  { id: "management", label: "자격증 관리" },
];

function TeacherCertificateView({ model }) {
  const {
    canEditCredentialDefinitions,
    canManageCredentialSettings,
    canOperateCredentials,
    canIssueCredentials,
    certificateLoading,
    openTeacherCertificateDetailModal,
    resolvedCertificateDefinitions,
    setCertificateCatalogModalOpen,
    setTeacherCertificateCategoryFilter,
    setCertificateGradeSettingsModalOpen,
    setCertificateModalOpen,
    setEditingCertificate,
    setTeacherCertificateView,
    studentCertificateOverviewRows,
    teacherCertificateCategoryFilter,
    teacherCertificateCategoryItems,
    teacherCertificateOverviewLoading,
    teacherCertificateView,
    openCertificateIssue,
  } = model;

  const teacherTabs = TEACHER_TABS.filter((item) =>
    item.id === "management" ? canEditCredentialDefinitions : canOperateCredentials,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full max-w-md">
          <Tabs tabs={teacherTabs} activeTab={teacherCertificateView} onTabChange={setTeacherCertificateView} variant="pills" size="sm" fullWidth className="w-full" ariaLabel="자격증 작업 보기" />
        </div>
        {canManageCredentialSettings ? (
          <Button size="sm" variant="outline" tone="slate" onClick={() => setCertificateGradeSettingsModalOpen(true)} icon={Settings2}>
            단계·카테고리 설정
          </Button>
        ) : null}
      </div>

      {teacherCertificateView === "overview" && canOperateCredentials ? (
        <StudentCertificateOverviewTable
          rows={studentCertificateOverviewRows}
          onSelect={openTeacherCertificateDetailModal}
          isLoading={teacherCertificateOverviewLoading}
        />
      ) : null}

      {teacherCertificateView === "management" && canEditCredentialDefinitions ? (
        <Card className="overflow-hidden border-white/70 bg-white/85" variant="elevated" tone="white" noShadow>
          <SectionLead
            eyebrow="자격증 정의"
            title="자격증 관리"
            description="이름과 취득 조건을 입력해 일관된 자격증을 만듭니다."
            action={(
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" tone="slate" icon={Medal} onClick={() => setCertificateCatalogModalOpen(true)}>
                  목록 편집
                </Button>
                <Button size="sm" onClick={() => { setEditingCertificate(null); setCertificateModalOpen(true); }} icon={Plus}>
                  자격증 추가
                </Button>
              </div>
            )}
          />
          {teacherCertificateCategoryItems.length ? (
            <CategoryChipBar
              items={teacherCertificateCategoryItems}
              selectedId={teacherCertificateCategoryFilter}
              onSelect={setTeacherCertificateCategoryFilter}
              title="자격증 카테고리"
              mode="navigation"
              className="mb-4"
            />
          ) : null}
          {certificateLoading ? <div className="py-12"><Spinner /></div> : resolvedCertificateDefinitions.length ? (
            <div className="grid gap-4">
              {resolvedCertificateDefinitions.map((item) => (
                <CertificateRecordCard
                  key={item.id}
                  item={item}
                  status={{ label: item.isActive === false ? "중지" : "활성", tone: item.isActive === false ? "slate" : "emerald" }}
                  action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" tone="slate" onClick={() => { setEditingCertificate(item); setCertificateModalOpen(true); }} icon={Pencil}>수정</Button>{canIssueCredentials ? <Button size="sm" tone="indigo" onClick={() => openCertificateIssue(item)} icon={Send}>발급</Button> : null}</div>}
                />
              ))}
            </div>
          ) : <EmptyState icon={GraduationCap} title="등록된 자격증이 없습니다" description="자격증을 추가하면 학생에게 발급할 수 있습니다." />}
        </Card>
      ) : null}
    </div>
  );
}

function StudentCertificateView({ model }) {
  const {
    activeOwnedCertificates,
    activeStudentLabel,
    classDisplayName,
    classId,
    expiredCertificateCount,
    formatDate,
    lockedCertificates,
    setStudentCertificateCategoryFilter,
    studentCertificateCategoryFilter,
    studentCertificateCategoryItems,
  } = model;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-white/80 bg-white/85 px-4 py-3 text-sm shadow-sm">
        <p className="font-black text-slate-900">자격증 현황</p>
        <p className="text-slate-500">보유 <strong className="ml-1 text-slate-900">{activeOwnedCertificates.length}</strong></p>
        <p className="text-slate-500">유효 <strong className="ml-1 text-emerald-600">{Math.max(0, activeOwnedCertificates.length - expiredCertificateCount)}</strong></p>
        <p className="text-slate-500">만료 <strong className="ml-1 text-rose-600">{expiredCertificateCount}</strong></p>
      </div>
      {studentCertificateCategoryItems.length ? (
        <CategoryChipBar items={studentCertificateCategoryItems} selectedId={studentCertificateCategoryFilter} onSelect={setStudentCertificateCategoryFilter} title="카테고리" />
      ) : null}
      <section className="rounded-[28px] border border-white/80 bg-white/80 p-4 shadow-sm">
        <SectionLead eyebrow="CERTIFICATE WALLET" title="내 자격증 지갑" description="학급에서 발급받은 자격증을 카드처럼 모아 확인하세요." />
        {activeOwnedCertificates.length ? (
          <div className="grid justify-start gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 520px))" }}>
            {activeOwnedCertificates.map((item) => (
              <StudentCertificatePreviewCard key={item.ownedId} item={item} status={buildCertificateStatus(item)} formatDate={formatDate} studentLabel={activeStudentLabel} classDisplayName={classDisplayName} classId={classId} />
            ))}
          </div>
        ) : <EmptyState icon={Lock} title="아직 자격증이 없습니다" description="선생님이 발급한 자격증이 여기에 표시됩니다." />}

        <div className="my-6 h-px bg-slate-200/80" />
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900">다음 도전</h3>
              {lockedCertificates.length ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-500">{lockedCertificates.length}개</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-medium text-slate-500">잠긴 카드를 눌러 취득 조건을 확인하세요.</p>
          </div>
          {lockedCertificates.length > 1 ? <p className="text-xs font-bold text-slate-400">옆으로 넘겨보기 →</p> : null}
        </div>
        {lockedCertificates.length ? (
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3 pt-1">
            {lockedCertificates.map((item) => (
              <div key={item.id} className="w-[min(82vw,320px)] shrink-0 snap-start">
                <StudentCertificatePreviewCard item={item} locked status={{ label: "미발급", tone: "slate" }} formatDate={formatDate} studentLabel={activeStudentLabel} classDisplayName={classDisplayName} classId={classId} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-2xl bg-emerald-50/80 px-4 py-3 text-sm font-bold text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            지금 공개된 자격증을 모두 취득했어요.
          </div>
        )}
      </section>
    </div>
  );
}

export default function CertificateCredentialsView({ model }) {
  if (model.previewMode === "teacher" && model.canManageCredentials) {
    return <TeacherCertificateView model={model} />;
  }

  return <StudentCertificateView model={model} />;
}
