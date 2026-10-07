import { useState } from "react";
import { ChevronRight, Lock, Settings2, Sparkles, Users } from "lucide-react";

import { Badge, Button, Card, CategoryChipBar, EmptyState, InputField, RepresentativeTitlePill, Tabs } from "../../../components/ui";
import { SUBSCRIPTION_TYPE_ASSETS } from "../../../assets/illustrations/subscriptionTypes";
import StudentTitleOverviewTable from "../components/StudentTitleOverviewTable";
import TitleCollectionStageEmblem, {
  TitleCollectionStageRail,
} from "../components/TitleCollectionStageEmblem";
import StudentTitleCollectionEmblemPickerModal from "../components/StudentTitleCollectionEmblemPickerModal";
import TitleDefinitionCatalogModal from "../components/TitleDefinitionCatalogModal";
import TitleDexEntryCard from "../components/TitleDexEntryCard";
import { getTitleCollectionStageToneColor } from "../titleCollectionStageTones";
import {
  getTitleCollectionSelectedVisualStage,
  getTitleCollectionVisualStage,
} from "../titleCollectionStageVisuals";
import { SectionLead, STUDENT_DEX_FILTER_TABS } from "../CredentialsPage.parts";

const TEACHER_TABS = [
  { id: "overview", label: "학생 현황" },
  { id: "management", label: "칭호 관리" },
];

const STUDENT_TABS = [
  { id: "myDex", label: "내 도감" },
  { id: "friendDex", label: "친구 도감" },];
function withStageAlpha(hex, alpha) {
  const value = Number.parseInt(String(hex || "64748b").replace("#", ""), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function TeacherTitleView({ model }) {
  const {
    canEditCredentialDefinitions,
    canDeleteCredentialDefinitions,
    canManageCredentialSettings,
    canOperateCredentials,
    canReviewTitleRequests,
    credentialSettingsLoading,
    handleStudentIssueSelectionMouseDown,
    handleStudentIssueSelectionMouseEnter,
    onEditTitle,
    onOpenTitleCreate,
    onRebuildTeacherSummary,
    onSelectStudent,
    onSetGradeSettingsOpen,
    onSetRequestManagerOpen,
    ownedTitleCountByDefinition,
    requestCountByDefinition,
    resolvedTitleDefinitions,
    selectedStudentIssueUids,
    setStudentIssueSelection,
    setTeacherTitleView,
    studentTitleOverviewRows,
    teacherTitleSummaryLoading,
    teacherTitleView,
    titleCategoryOptions,
    titleGrades,
    titleCollectionStages,
    titleLoading,
    titleRequestsLoading,
    toggleAllStudentIssueSelection,
  } = model;
  const teacherTabs = TEACHER_TABS.filter((item) =>
    item.id === "management" ? canEditCredentialDefinitions : canOperateCredentials,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full max-w-md">
          <Tabs tabs={teacherTabs} activeTab={teacherTitleView} onTabChange={setTeacherTitleView} variant="pills" size="sm" fullWidth className="w-full" ariaLabel="칭호 작업 보기" />
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {canReviewTitleRequests ? (
            <Button size="sm" tone="blue" onClick={() => onSetRequestManagerOpen(true)} disabled={titleRequestsLoading}>
              칭호 요청 관리
            </Button>
          ) : null}
          {canManageCredentialSettings ? (
            <Button size="sm" variant="outline" tone="slate" onClick={() => onSetGradeSettingsOpen(true)} icon={Settings2} disabled={credentialSettingsLoading}>
              등급·카테고리 설정
            </Button>
          ) : null}
        </div>
      </div>

      {teacherTitleView === "overview" && canOperateCredentials ? (
        <StudentTitleOverviewTable
          rows={studentTitleOverviewRows}
          onSelect={onSelectStudent}
          selectedIssueUids={selectedStudentIssueUids}
          onSetIssueSelection={setStudentIssueSelection}
          onToggleAllIssueSelection={toggleAllStudentIssueSelection}
          onSelectionMouseDown={handleStudentIssueSelectionMouseDown}
          onSelectionMouseEnter={handleStudentIssueSelectionMouseEnter}
          isLoading={teacherTitleSummaryLoading || titleRequestsLoading}
          titleCollectionStages={titleCollectionStages}
        />
      ) : null}

      {teacherTitleView === "management" && canEditCredentialDefinitions ? (
        <TitleDefinitionCatalogModal
          open
          embedded
          onClose={() => setTeacherTitleView("overview")}
          items={resolvedTitleDefinitions}
          isLoading={titleLoading}
          onCreate={onOpenTitleCreate}
          onEdit={onEditTitle}
          titleGrades={titleGrades}
          titleCategoryOptions={titleCategoryOptions}
          ownedTitleCountByDefinition={ownedTitleCountByDefinition}
          requestCountByDefinition={requestCountByDefinition}
          cleanupLoading={teacherTitleSummaryLoading || titleRequestsLoading}
          onRebuildTeacherSummary={canOperateCredentials ? onRebuildTeacherSummary : undefined}
          canDeleteDefinitions={canDeleteCredentialDefinitions}
        />
      ) : null}
    </div>
  );
}

function StudentTitleView({ model }) {
  const {
    browseableStudents,
    browseableStudentsLoading,
    canEditCredentialDefinitions,
    canManageCredentials,
    canManageRepresentativeTitles,
    canUseStudentSelfService,
    equipTitle,
    formatDexNumber,
    filteredTitleDexEntries,
    getTitleRequestStatusMeta,
    getTitleRevealMeta,
    getTitleSurfaceTheme,
    handleEditTitleDefinitionFromDexEntry,
    isTitleCollectionPublic,
    nextTitleCollectionStage,
    onBrowseStudent,
    requestTitleClaim,
    representativeCount,
    representativeTitles = [],
    selectedNextTargetId,
    setNextTarget,
    setStudentTitleView,
    setStudentDexCategoryFilter,
    setStudentDexFilter,
    setStudentDexSearch,
    setTitleCollectionVisibility,
    setTitleCollectionEmblemStage,
    studentDexCategoryFilter,
    studentDexCategoryItems,
    studentDexFilter,
    studentDexOwnedCount,
    studentDexSearch,
    studentDexTotal,
    studentTitleView,
    submissionKey,
    titleCollectionRate,
    titleCollectionStage,
    titleCollectionStages,
    titleCollectionTotal,
    titlesUntilNextStage,
    unlockedTitleCollectionEmblemStage,
    selectedTitleCollectionEmblemStage,
  } = model;
  const [emblemPickerOpen, setEmblemPickerOpen] = useState(false);

  const stageTone = titleCollectionStage?.tone || "slate";
  const stageColor = titleCollectionStage?.accentColor || "";
  const stageAccent = getTitleCollectionStageToneColor(stageTone, stageColor);
  const collectionTotal = studentDexTotal || titleCollectionTotal || 0;
  const normalizedCollectionRate = Math.max(
    0,
    Math.min(100, Number(titleCollectionRate) || 0),
  );
  const visibleRepresentativeTitles = representativeTitles.slice(0, 2);

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Tabs
          tabs={STUDENT_TABS}
          activeTab={studentTitleView}
          onTabChange={setStudentTitleView}
          variant="underline"
          size="md"
          fullWidth
          className="w-full"
        />
      </div>

      {studentTitleView === "myDex" ? (
        <>
          <section
            className="overflow-hidden rounded-3xl border bg-white/90 backdrop-blur-sm"
            style={{
              borderColor: withStageAlpha(stageAccent, 0.5),
              backgroundImage: `radial-gradient(circle at 10% 50%, ${withStageAlpha(stageAccent, 0.1)}, transparent 30%), linear-gradient(110deg, ${withStageAlpha(stageAccent, 0.07)}, rgba(255,255,255,0.96) 52%, ${withStageAlpha(stageAccent, 0.035)})`,
            }}
          >
            <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[220px_minmax(0,1fr)_300px] lg:items-center lg:gap-8 lg:px-8 lg:py-7">
              <div className="justify-self-center text-center">
                <button
                  type="button"
                  onClick={() => setEmblemPickerOpen(true)}
                  disabled={!canUseStudentSelfService}
                  className={`rounded-full transition ${
                    canUseStudentSelfService
                      ? "cursor-pointer hover:scale-[1.025] focus:outline-none focus-visible:ring-4"
                      : "cursor-default"
                  }`}
                  style={{
                    "--tw-ring-color": withStageAlpha(stageAccent, 0.22),
                  }}
                  aria-label={
                    canUseStudentSelfService
                      ? "내 도감 엠블럼 선택"
                      : "현재 도감 엠블럼"
                  }
                >
                  <TitleCollectionStageEmblem
                    rate={normalizedCollectionRate}
                    tone={stageTone}
                    color={stageColor}
                    stages={titleCollectionStages}
                    visualStage={selectedTitleCollectionEmblemStage}
                  />
                </button>
                {canUseStudentSelfService ? (
                  <p className="mt-3 text-xs font-black" style={{ color: stageAccent }}>
                    눌러서 엠블럼 바꾸기
                  </p>
                ) : null}
              </div>

              <div className="min-w-0">
                <p className="text-xs font-black" style={{ color: stageAccent }}>
                  현재 도감 단계
                </p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                  {titleCollectionStage?.label || "첫 발걸음"}
                </h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  칭호를 모아 도감과 엠블럼을 함께 성장시켜 보세요.
                </p>

                <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-2xl font-black" style={{ color: stageAccent }}>
                    {studentDexOwnedCount}
                  </span>
                  <span className="text-lg font-bold text-slate-500">/ {collectionTotal}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xl font-black text-slate-900">{normalizedCollectionRate}%</span>
                  <span
                    className="ml-auto text-xs font-black"
                    style={{ color: stageAccent }}
                  >
                    {nextTitleCollectionStage
                      ? `다음 ${nextTitleCollectionStage.label}까지 칭호 ${titlesUntilNextStage}개`
                      : "도감 최고 단계 달성"}
                  </span>
                </div>

                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200/80" aria-label="칭호 도감 진행률">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${normalizedCollectionRate}%`,
                      backgroundColor: stageAccent,
                    }}
                  />
                </div>

                <TitleCollectionStageRail
                  rate={normalizedCollectionRate}
                  tone={stageTone}
                  color={stageColor}
                  stages={titleCollectionStages}
                />
              </div>

              <div className="border-t border-slate-200/80 pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
                <p className="text-xs font-black" style={{ color: stageAccent }}>대표 칭호</p>

                <div className="mt-3 space-y-2.5">
                  {[0, 1].map((slotIndex) => {
                    const representativeTitle = visibleRepresentativeTitles[slotIndex];

                    return (
                      <div
                        key={representativeTitle?.ownedId || `representative-slot-${slotIndex}`}
                        className={`relative flex min-h-[76px] min-w-0 items-center rounded-2xl border px-3 py-1.5 ${representativeTitle ? "bg-white/78" : "border-dashed bg-white/44"}`}
                        style={{
                          borderColor: representativeTitle
                            ? withStageAlpha(stageAccent, 0.34)
                            : undefined,
                        }}
                      >
                        <span
                          className="absolute left-3 top-2 z-10 text-[9px] font-black"
                          style={{ color: stageAccent }}
                        >
                          대표 {slotIndex + 1}
                        </span>
                        {representativeTitle ? (
                          <RepresentativeTitlePill
                            item={representativeTitle}
                            variant="dashboard-mini"
                            className="w-full pt-2"
                          />
                        ) : (
                          <p className="w-full pt-2 text-center text-xs font-bold text-slate-400">
                            대표 칭호를 추가해 보세요
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <StudentTitleCollectionEmblemPickerModal
            open={emblemPickerOpen}
            onClose={() => setEmblemPickerOpen(false)}
            unlockedStage={unlockedTitleCollectionEmblemStage}
            selectedStage={selectedTitleCollectionEmblemStage}
            tone={stageTone}
            color={stageColor}
            onSelect={setTitleCollectionEmblemStage}
            isSubmitting={submissionKey === "title-collection-emblem"}
          />

          <div id="student-title-dex-list" className="scroll-mt-24">
          <Card className="overflow-hidden border-white/80 bg-white/72 backdrop-blur-sm" variant="elevated" tone="white" noShadow>
            <SectionLead
              title="칭호 도감"
            />
            <div className="grid gap-3 border-b border-slate-100 pb-4 lg:grid-cols-[minmax(280px,0.72fr)_minmax(520px,1.28fr)] lg:items-end">
              <InputField label="도감 검색" value={studentDexSearch} onChange={(event) => setStudentDexSearch(event.target.value)} placeholder="번호, 이름, 조건으로 검색" />
              <Tabs tabs={STUDENT_DEX_FILTER_TABS} activeTab={studentDexFilter} onTabChange={setStudentDexFilter} variant="underline" size="md" fullWidth className="w-full" />
            </div>
            {studentDexCategoryItems.length ? (
              <CategoryChipBar
                items={studentDexCategoryItems}
                selectedId={studentDexCategoryFilter}
                onSelect={setStudentDexCategoryFilter}
                title="칭호 카테고리"
                mode="navigation"
                className="mt-4"
              />
            ) : null}
            {filteredTitleDexEntries.length ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredTitleDexEntries.map((entry) => (
                  <TitleDexEntryCard
                    key={`${entry.id}-${entry.dexNumber}`}
                    entry={entry}
                    canEquipTitle={canManageRepresentativeTitles}
                    onEquip={equipTitle}
                    isSubmitting={submissionKey === `equip-${entry.ownedId}`}
                    canRequest={!canManageCredentials && entry.locked && entry.allowStudentRequest !== false}
                    onRequest={requestTitleClaim}
                    requestSubmitting={submissionKey === `request-title-${entry.definitionId}`}
                    canSetNextTarget={!canManageCredentials && entry.locked}
                    onSetNextTarget={setNextTarget}
                    nextTargetSubmitting={submissionKey === `next-target-${entry.definitionId}`}
                    isNextTarget={entry.definitionId === selectedNextTargetId}
                    collectionStageTone={titleCollectionStage?.tone}
                    collectionStageColor={stageColor}
                    representativeCount={representativeCount}
                    maxRepresentativeCount={3}
                    formatDexNumber={formatDexNumber}
                    getTitleSurfaceTheme={getTitleSurfaceTheme}
                    getTitleRevealMeta={getTitleRevealMeta}
                    getTitleRequestStatusMeta={getTitleRequestStatusMeta}
                    onEditDefinition={canEditCredentialDefinitions ? handleEditTitleDefinitionFromDexEntry : null}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon={Lock} title={studentDexTotal ? "검색 결과가 없습니다" : "아직 도감에 등록된 칭호가 없습니다"} description="검색어와 상태 필터를 바꾸거나, 교사가 칭호를 추가하면 여기에 표시됩니다." />
            )}
          </Card>
          </div>
        </>
      ) : null}

      {studentTitleView === "friendDex" ? (
        <Card noPadding className="overflow-hidden border-white/80 bg-white/80" variant="elevated" tone="white" noShadow>
          <div className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-white to-amber-50 px-4 py-5 sm:px-5">
            <div className="pointer-events-none absolute -right-8 -top-12 h-36 w-36 rounded-full bg-indigo-200/35 blur-2xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-indigo-100 bg-white/85 shadow-sm">
                  <img src={SUBSCRIPTION_TYPE_ASSETS.subscriptionGoalSavings} alt="" aria-hidden="true" className="h-10 w-10 object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-500">친구 도감</p>
                  <h2 className="mt-1 text-lg font-black tracking-tight text-slate-900">친구들의 칭호 도감을 구경해 보세요</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">친구가 공개한 칭호 컬렉션을 눌러 획득 현황과 명패를 살펴볼 수 있어요.</p>
                </div>
              </div>
              <Badge tone="indigo" icon={Users}>{browseableStudents.length}명 공개</Badge>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {browseableStudentsLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="친구 도감 불러오는 중">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-[132px] animate-pulse rounded-3xl border border-slate-100 bg-slate-50" />
                ))}
              </div>
            ) : browseableStudents.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {browseableStudents.map((student) => {
                  const name = student.name || student.displayName || "학생";
                  const rate = Math.max(0, Math.min(100, Number(student.titleCollectionRate) || 0));
                  const ownedCount = Number(student.dexOwnedCount || 0);
                  const totalCount = Number(student.dexTotal || 0);
                  const cardStage = getTitleCollectionVisualStage(rate, titleCollectionStages);
                  const selectedCardStage = getTitleCollectionSelectedVisualStage(
                    student.titleCollectionEmblemStage,
                    cardStage,
                  );
                  const cardTone = student.titleCollectionStageTone || "slate";
                  const cardColor = student.titleCollectionStageColor || "";
                  const cardAccent = getTitleCollectionStageToneColor(cardTone, cardColor);
                  const stageLabel = student.titleCollectionStageLabel || "첫 발견";
                  const isHighStage = cardStage >= 8;
                  const isEliteStage = cardStage >= 10;
                  const isMaxStage = cardStage === 12;

                  return (
                    <button
                      key={student.uid}
                      type="button"
                      onClick={() => onBrowseStudent(student.uid)}
                      className="group relative overflow-hidden rounded-3xl border bg-white p-4 text-left transition duration-200 hover:-translate-y-1"
                      style={{
                        borderColor: withStageAlpha(cardAccent, isEliteStage ? 0.62 : 0.34),
                        backgroundImage: isHighStage
                          ? `radial-gradient(circle at 10% 30%, ${withStageAlpha(cardAccent, isEliteStage ? 0.18 : 0.11)}, transparent 42%), linear-gradient(135deg, rgba(255,255,255,0.98), ${withStageAlpha(cardAccent, 0.07)})`
                          : `linear-gradient(135deg, rgba(255,255,255,0.98), ${withStageAlpha(cardAccent, 0.045)})`,
                        boxShadow: isEliteStage
                          ? `0 18px 36px -28px ${withStageAlpha(cardAccent, 0.85)}, inset 0 0 0 1px ${withStageAlpha(cardAccent, 0.1)}`
                          : `0 14px 28px -28px ${withStageAlpha(cardAccent, 0.65)}`,
                      }}
                    >
                      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: cardAccent }} aria-hidden="true" />
                      <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                          <TitleCollectionStageEmblem
                            rate={rate}
                            tone={cardTone}
                            color={cardColor}
                            stages={titleCollectionStages}
                            visualStage={selectedCardStage}
                            compact
                            showStage={false}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-black text-slate-900">{name}</p>
                            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">공개</span>
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            <p className="truncate text-xs font-black" style={{ color: cardAccent }}>{stageLabel}</p>
                            {isEliteStage ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-white/88 px-2 py-0.5 text-[9px] font-black" style={{ borderColor: withStageAlpha(cardAccent, 0.4), color: cardAccent }}>
                                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                                {isMaxStage ? "도감 완성" : "상위 도감"}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500">도감 {ownedCount}/{totalCount} · {rate}%</p>
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" aria-hidden="true" />
                      </div>

                      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200/75">
                        <div className="h-full rounded-full transition-[width]" style={{ width: `${rate}%`, backgroundColor: cardAccent }} />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-400">
                          {isHighStage ? "멋지게 성장한 도감" : "칭호 도감 상세 보기"}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-black" style={{ color: cardAccent }}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />둘러보기</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Users} title="공개된 친구 도감이 없습니다" description="친구가 도감을 공개하면 여기에 표시됩니다." />
            )}

            {!isTitleCollectionPublic ? (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
                내 칭호 도감은 현재 다른 학생에게 보이지 않습니다.
              </p>
            ) : null}
            {canUseStudentSelfService ? (
              <div className="mt-4 flex justify-end">
                <Button size="sm" variant="outline" tone="slate" onClick={() => setTitleCollectionVisibility(!isTitleCollectionPublic)}>
                  내 도감 {isTitleCollectionPublic ? "비공개" : "공개"}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
export default function TitleCredentialsView({ model }) {
  if (model.previewMode === "teacher" && model.canManageCredentials) {
    return <TeacherTitleView model={model} />;
  }

  return <StudentTitleView model={model} />;
}
