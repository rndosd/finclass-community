import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { Sparkles, Users } from "lucide-react";

import { db } from "../../../firebase";
import {
  Badge,
  Modal,
  RepresentativeTitlePill,
  Spinner,
} from "../../../components/ui";
import TitleDexEntryCard from "./TitleDexEntryCard";
import TitleCollectionStageEmblem from "./TitleCollectionStageEmblem";
import {
  compareOwnedTitlePriority,
  EmptyState,
  formatDate,
  formatDexNumber,
  getGradeMeta,
  getTitleCategoryMeta,
  getTitleCategoryLabel,
  getTitleRequestStatusMeta,
  getTitleRevealMeta,
  getTitleSurfaceTheme,
  normalizeTitleRevealConfig,
  deriveLegacyTitleRevealMode,
  sortEquippedTitleRecords,
} from "../CredentialsPage.parts";
import {
  getTitleCollectionStageToneColor,
  getTitleCollectionStageToneStyle,
} from "../titleCollectionStageTones";
import {
  getTitleCollectionSelectedVisualStage,
  getTitleCollectionVisualStage,
} from "../titleCollectionStageVisuals";

const TITLE_COLLECTION_BROWSE_CACHE_TTL_MS = 30 * 1000;

function getCollectionStageAccent(tone = "slate") {
  return getTitleCollectionStageToneStyle(tone);
}

function buildCategoryLookupValue(...sources) {
  const nextValue = {
    id: "",
    label: "",
  };

  sources.forEach((source) => {
    if (!source) return;

    if (typeof source === "string") {
      const rawValue = String(source || "").trim();
      if (!rawValue) return;
      if (!nextValue.label) {
        nextValue.label = rawValue;
      }
      return;
    }

    if (typeof source === "object" && !Array.isArray(source)) {
      const sourceId = String(source?.id || source?.categoryId || "").trim();
      const sourceLabel = String(
        source?.label || source?.categoryLabel || source?.category || source?.name || "",
      ).trim();

      if (!nextValue.id && sourceId) {
        nextValue.id = sourceId;
      }

      if (!nextValue.label && sourceLabel) {
        nextValue.label = sourceLabel;
      }
    }
  });

  return nextValue;
}

function getCollectionStage(rate, stages = []) {
  return (
    [...stages]
      .sort((left, right) => Number(right?.minRate || 0) - Number(left?.minRate || 0))
      .find((item) => Number(rate) >= Number(item?.minRate || 0)) || {
      label: "미등록",
      tone: "slate",
    }
  );
}

export default function StudentTitleCollectionBrowseModal({
  open,
  onClose,
  classId,
  student,
  titleDefinitions = [],
  titleCategories = [],
  titleGrades = [],
  titleCollectionStages = [],
  onEditDefinition = null,
}) {
  const [ownedTitles, setOwnedTitles] = useState([]);
  const [loading, setLoading] = useState(false);
  const ownedTitleCacheRef = useRef(new Map());

  useEffect(() => {
    if (!open || !classId || !student?.uid) {
      setLoading(false);
      return undefined;
    }

    const cacheKey = `${classId}:${student.uid}`;
    const cachedEntry = ownedTitleCacheRef.current.get(cacheKey);

    if (
      cachedEntry &&
      Date.now() - Number(cachedEntry.fetchedAt || 0) < TITLE_COLLECTION_BROWSE_CACHE_TTL_MS
    ) {
      setOwnedTitles(Array.isArray(cachedEntry.items) ? cachedEntry.items : []);
      setLoading(false);
      return undefined;
    }

    let isCancelled = false;
    setLoading(true);
    setOwnedTitles([]);

    void getDocs(collection(db, "classes", classId, "students", student.uid, "ownedTitles"))
      .then((snapshot) => {
        if (isCancelled) return;

        const nextItems = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));

        ownedTitleCacheRef.current.set(cacheKey, {
          items: nextItems,
          fetchedAt: Date.now(),
        });

        setOwnedTitles(nextItems);
        setLoading(false);
      })
      .catch((error) => {
        if (isCancelled) return;
        console.error("[StudentTitleCollectionBrowseModal] ownedTitles subscribe error:", error);
        setOwnedTitles([]);
        setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [classId, open, student?.uid]);

  const defaultTitleGradeId = titleGrades[0]?.id || "common";
  const visibleDefinitions = useMemo(
    () => titleDefinitions.filter((item) => item?.isDeleted !== true),
    [titleDefinitions],
  );
  const titleMap = useMemo(
    () => new Map(visibleDefinitions.map((item) => [item.id, item])),
    [visibleDefinitions],
  );

  const resolvedOwnedTitles = useMemo(
    () =>
      ownedTitles
        .map((owned) => {
          const definition = titleMap.get(owned.titleId) || null;
          const grade = getGradeMeta(
            titleGrades,
            definition?.gradeId || owned.gradeId || owned.rarity || defaultTitleGradeId,
            defaultTitleGradeId,
          );
          const categoryMeta = getTitleCategoryMeta(
            titleCategories,
            buildCategoryLookupValue(definition, owned),
          );
          const revealConfig = normalizeTitleRevealConfig(
            definition?.revealConfig || owned?.revealConfig,
            definition?.revealMode || owned?.revealMode || "condition_only",
          );

          return {
            ownedId: owned.id,
            definitionId: owned.titleId || owned.id,
            name: definition?.name || owned.titleName || "이름 없는 칭호",
            description: definition?.description || owned.description || "",
            acquisitionCondition:
              definition?.acquisitionCondition || owned.acquisitionCondition || "",
            categoryId: categoryMeta.id,
            category: categoryMeta.label,
            categoryLabel: categoryMeta.label,
            categoryIconKey: categoryMeta.iconKey,
            categoryColorKey: categoryMeta.colorKey,
            revealConfig,
            revealMode: deriveLegacyTitleRevealMode(revealConfig),
            gradeId: grade.id,
            gradeLabel: grade.label,
            gradeTone: grade.tone,
            rarity: definition?.rarity || owned.rarity || "common",
            sourceType: owned.sourceType || definition?.sourceType || "manual",
            icon: definition?.icon || owned.icon || "none",
            familyId: definition?.familyId || owned.familyId || "plaque",
            paletteId: definition?.paletteId || owned.paletteId || "sky",
            trimPaletteId:
              definition?.trimPaletteId || owned.trimPaletteId || "match",
            customFrameColor:
              definition?.customFrameColor || owned.customFrameColor || "",
            customBannerColor:
              definition?.customBannerColor || owned.customBannerColor || "",
            customTrimColor:
              definition?.customTrimColor || owned.customTrimColor || "",
            topDecoId: definition?.topDecoId || owned.topDecoId || "none",
            sideDecoId: definition?.sideDecoId || owned.sideDecoId || "none",
            bottomDecoId: definition?.bottomDecoId || owned.bottomDecoId || "none",
            patternId: definition?.patternId || owned.patternId || "none",
            effectId: definition?.effectId || owned.effectId || "none",
            obtainedAt: owned.obtainedAt || owned.createdAt || null,
            equipped: Boolean(owned.equipped),
            equippedOrder: Number(owned.equippedOrder) || null,
            isRevoked: Boolean(owned.isRevoked),
            missingDefinition: !definition,
          };
        })
        .filter((item) => !item.isRevoked)
        .sort(compareOwnedTitlePriority),
    [defaultTitleGradeId, ownedTitles, titleCategories, titleGrades, titleMap],
  );

  const ownedTitleIds = useMemo(
    () => new Set(resolvedOwnedTitles.map((item) => item.definitionId).filter(Boolean)),
    [resolvedOwnedTitles],
  );
  const studentDexDefinitions = useMemo(
    () =>
      visibleDefinitions.filter(
        (item) => item.isVisible !== false || ownedTitleIds.has(item.id),
      ),
    [ownedTitleIds, visibleDefinitions],
  );
  const ownedTitleMap = useMemo(
    () =>
      new Map(
        resolvedOwnedTitles
          .filter((item) => item.definitionId || item.ownedId)
          .map((item) => [item.definitionId || item.ownedId, item]),
      ),
    [resolvedOwnedTitles],
  );
  const orphanOwnedTitles = useMemo(() => {
    const definedIds = new Set(studentDexDefinitions.map((item) => item.id));
    return resolvedOwnedTitles.filter(
      (item) => item.definitionId && !definedIds.has(item.definitionId),
    );
  }, [resolvedOwnedTitles, studentDexDefinitions]);

  const titleDexEntries = useMemo(() => {
    const definedEntries = studentDexDefinitions.map((definition, index) => {
      const owned = ownedTitleMap.get(definition.id) || null;
      const categoryMeta = getTitleCategoryMeta(
        titleCategories,
        buildCategoryLookupValue(owned, definition),
      );
      const revealConfig = normalizeTitleRevealConfig(
        owned?.revealConfig || definition?.revealConfig,
        owned?.revealMode || definition?.revealMode || "condition_only",
      );

      return {
        id: definition.id,
        definitionId: definition.id,
        dexNumber: index + 1,
        name: owned?.name || definition.name || "이름 없는 칭호",
        description: owned?.description || definition.description || "",
        categoryId: categoryMeta.id,
        category: categoryMeta.label,
        categoryLabel: categoryMeta.label,
        categoryIconKey: categoryMeta.iconKey,
        categoryColorKey: categoryMeta.colorKey,
        acquisitionCondition:
          definition.acquisitionCondition || owned?.acquisitionCondition || "",
        revealConfig,
        revealMode: deriveLegacyTitleRevealMode(revealConfig),
        gradeId: owned?.gradeId || definition.gradeId || defaultTitleGradeId,
        gradeLabel: owned?.gradeLabel || definition.gradeLabel || titleGrades[0]?.label || "등급",
        gradeTone: owned?.gradeTone || definition.gradeTone || titleGrades[0]?.tone || "slate",
        rarity: owned?.rarity || definition.rarity || "common",
        sourceType: owned?.sourceType || definition.sourceType || "manual",
        icon: owned?.icon || definition.icon || "none",
        familyId: owned?.familyId || definition.familyId || "plaque",
        paletteId: owned?.paletteId || definition.paletteId || "sky",
        trimPaletteId:
          owned?.trimPaletteId || definition.trimPaletteId || "match",
        customFrameColor:
          owned?.customFrameColor || definition.customFrameColor || "",
        customBannerColor:
          owned?.customBannerColor || definition.customBannerColor || "",
        customTrimColor:
          owned?.customTrimColor || definition.customTrimColor || "",
        topDecoId: owned?.topDecoId || definition.topDecoId || "none",
        sideDecoId: owned?.sideDecoId || definition.sideDecoId || "none",
        bottomDecoId: owned?.bottomDecoId || definition.bottomDecoId || "none",
        patternId: owned?.patternId || definition.patternId || "none",
        effectId: owned?.effectId || definition.effectId || "none",
        obtainedAt: owned?.obtainedAt || null,
        equipped: Boolean(owned?.equipped),
        equippedOrder: owned?.equippedOrder || null,
        ownedId: owned?.ownedId || "",
        missingDefinition: Boolean(owned?.missingDefinition),
        locked: !owned,
      };
    });

    const orphanEntries = orphanOwnedTitles.map((item, index) => ({
      ...item,
      id: item.definitionId || item.ownedId,
      dexNumber: studentDexDefinitions.length + index + 1,
      locked: false,
      categoryLabel: item.categoryLabel || getTitleCategoryLabel(item.category),
      description:
        item.description ||
        "현재 정의 정보는 없지만, 이미 획득한 칭호 기록으로 보존되어 있습니다.",
    }));

    return [...definedEntries, ...orphanEntries];
  }, [
    defaultTitleGradeId,
    orphanOwnedTitles,
    ownedTitleMap,
    studentDexDefinitions,
    titleCategories,
    titleGrades,
  ]);

  const representativeTitles = useMemo(
    () => sortEquippedTitleRecords(resolvedOwnedTitles),
    [resolvedOwnedTitles],
  );
  const ownedCount = studentDexDefinitions.filter((item) => ownedTitleIds.has(item.id)).length;
  const totalCount = studentDexDefinitions.length;
  const completionRate = totalCount
    ? Math.round((ownedCount / totalCount) * 100)
    : 0;
  const titleCollectionStage = getCollectionStage(
    completionRate,
    titleCollectionStages,
  );
  const titleCollectionStageAccent = getCollectionStageAccent(
    titleCollectionStage?.tone,
  );
  const titleCollectionStageColor = titleCollectionStage?.accentColor || "";
  const titleCollectionStageExactColor = getTitleCollectionStageToneColor(
    titleCollectionStage?.tone,
    titleCollectionStageColor,
  );
  const unlockedTitleCollectionEmblemStage = getTitleCollectionVisualStage(
    completionRate,
    titleCollectionStages,
  );
  const selectedTitleCollectionEmblemStage =
    getTitleCollectionSelectedVisualStage(
      student?.titleCollectionEmblemStage,
      unlockedTitleCollectionEmblemStage,
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={student ? `${student.name || "학생"}의 칭호 도감` : "칭호 도감"}
      size="xl"
    >
      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[0.9fr,1.1fr]">
            <div
              className={`rounded-[28px] border p-5 ${titleCollectionStageAccent.panel}`}
              style={titleCollectionStageColor ? {
                borderColor: `${titleCollectionStageExactColor}66`,
                backgroundImage: `linear-gradient(180deg, ${titleCollectionStageExactColor}12, rgba(255,255,255,0.96))`,
              } : undefined}
            >
              <div className="flex items-center gap-4">
                <TitleCollectionStageEmblem
                  rate={completionRate}
                  tone={titleCollectionStage.tone}
                  color={titleCollectionStageColor}
                  stages={titleCollectionStages}
                  visualStage={selectedTitleCollectionEmblemStage}
                  compact
                  showStage={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                    컬렉션 요약
                  </p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                    {ownedCount}
                    <span className="ml-2 text-base font-semibold text-slate-500">
                      / {totalCount}
                    </span>
                  </p>
                  <Badge
                    className="mt-2"
                    tone={titleCollectionStage.tone || "slate"}
                    icon={Sparkles}
                    style={titleCollectionStageColor ? {
                      color: titleCollectionStageExactColor,
                      backgroundColor: `${titleCollectionStageExactColor}18`,
                      boxShadow: `inset 0 0 0 1px ${titleCollectionStageExactColor}42`,
                    } : undefined}
                  >
                    {titleCollectionStage.label}
                  </Badge>
                </div>
              </div>
              <div className={`mt-5 h-3 overflow-hidden rounded-full ${titleCollectionStageAccent.track}`}>
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${titleCollectionStageAccent.fill}`}
                  style={{
                    width: `${Math.min(completionRate, 100)}%`,
                    backgroundColor: titleCollectionStageExactColor,
                  }}
                />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-600">
                완료율 {completionRate}%
              </p>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" />
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                  대표 명패
                </p>
              </div>
              {representativeTitles.length ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  {representativeTitles.map((item) => (
                    <RepresentativeTitlePill
                      key={item.ownedId || item.definitionId || item.name}
                      item={item}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  아직 대표 명패로 설정한 칭호가 없습니다.
                </p>
              )}
            </div>
          </div>

          {titleDexEntries.length ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {titleDexEntries.map((entry) => (
                <TitleDexEntryCard
                  key={`${entry.id}-${entry.dexNumber}`}
                  entry={entry}
                  canEquipTitle={false}
                  canRequest={false}
                  canSetNextTarget={false}
                  collectionStageTone={titleCollectionStage?.tone}
                  collectionStageColor={titleCollectionStageColor}
                  formatDexNumber={formatDexNumber}
                  formatDate={formatDate}
                  getTitleSurfaceTheme={getTitleSurfaceTheme}
                  getTitleRevealMeta={getTitleRevealMeta}
                  getTitleRequestStatusMeta={getTitleRequestStatusMeta}
                  onEditDefinition={
                    typeof onEditDefinition === "function" && !entry?.missingDefinition
                      ? (targetEntry) => {
                          onClose?.();
                          onEditDefinition(targetEntry);
                        }
                      : null
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="아직 표시할 칭호가 없습니다"
              description="획득한 칭호나 공개된 도감 정의가 생기면 이곳에서 둘러볼 수 있습니다."
            />
          )}
        </div>
      )}
    </Modal>
  );
}
