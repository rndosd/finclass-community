import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { beginFirestoreSubscriptionDebug } from "../../utils/firestoreSubscriptionDebug";

const MAX_REPRESENTATIVE_TITLES = 3;
const titleDefinitionCache = new Map();

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toEquippedOrder(item = {}) {
  const numericValue = Number(item?.equippedOrder);
  if (Number.isInteger(numericValue) && numericValue > 0) return numericValue;
  return item?.equipped ? 1 : Number.MAX_SAFE_INTEGER;
}

export function buildSelectedTitles(ownedItems = [], definitionMap = new Map()) {
  return getRepresentativeTitleIds(ownedItems)
    .map((titleId) => {
      const item = ownedItems.find(
        (ownedItem) => (ownedItem.titleId || ownedItem.id) === titleId,
      );
      const definition = definitionMap.get(titleId) || null;

      return {
        id: item.id,
        titleId,
        name: definition?.name || item.titleName || "대표 칭호",
        gradeId: definition?.gradeId || item.gradeId || "",
        gradeTone: item.gradeTone || definition?.gradeTone || item.tone || "slate",
        icon: definition?.icon || item.icon || item.iconId || "award",
        paletteId: definition?.paletteId || item.paletteId || "sky",
        trimPaletteId:
          definition?.trimPaletteId || item.trimPaletteId || "match",
        familyId: definition?.familyId || item.familyId || "plaque",
        version: definition?.version ?? item.version ?? 2,
        ornamentSetId:
          definition?.ornamentSetId || item.ornamentSetId || "none",
        fontStyleId:
          definition?.fontStyleId || item.fontStyleId || "basic",
        textScale: definition?.textScale ?? item.textScale ?? 100,
        textOffsetY: definition?.textOffsetY ?? item.textOffsetY ?? 0,
        textColorMode:
          definition?.textColorMode || item.textColorMode || "auto",
        customTextColor:
          definition?.customTextColor || item.customTextColor || "",
        customFrameColor:
          definition?.customFrameColor || item.customFrameColor || "",
        customBannerColor:
          definition?.customBannerColor || item.customBannerColor || "",
        customTrimColor:
          definition?.customTrimColor || item.customTrimColor || "",
        topDecoId: definition?.topDecoId || item.topDecoId || "none",
        sideDecoId: definition?.sideDecoId || item.sideDecoId || "none",
        bottomDecoId: definition?.bottomDecoId || item.bottomDecoId || "none",
        patternId: definition?.patternId || item.patternId || "none",
        effectId: definition?.effectId || item.effectId || "none",
        equippedOrder:
          toEquippedOrder(item) === Number.MAX_SAFE_INTEGER ? 1 : toEquippedOrder(item),
        obtainedAt: item.obtainedAt || item.createdAt || null,
      };
    });
}

function getRepresentativeTitleIds(ownedItems = []) {
  return ownedItems
    .filter((item) => item?.equipped)
    .sort(
      (left, right) =>
        toEquippedOrder(left) - toEquippedOrder(right) ||
        toMillis(right.obtainedAt || right.createdAt) -
          toMillis(left.obtainedAt || left.createdAt),
    )
    .slice(0, MAX_REPRESENTATIVE_TITLES)
    .map((item) => item.titleId || item.id)
    .filter(Boolean);
}

async function loadTitleDefinition(classId, titleId) {
  const cacheKey = `${classId}:${titleId}`;
  const cached = titleDefinitionCache.get(cacheKey);
  if (cached?.data) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const pending = getDoc(doc(db, "classes", classId, "titles", titleId))
    .then((snapshot) => {
      const definition = snapshot.exists()
        ? {
            id: snapshot.id,
            ...snapshot.data(),
          }
        : null;
      titleDefinitionCache.set(cacheKey, { data: definition, promise: null });
      return definition;
    })
    .catch((error) => {
      titleDefinitionCache.delete(cacheKey);
      throw error;
    });

  titleDefinitionCache.set(cacheKey, { data: null, promise: pending });
  return pending;
}

async function loadTitleDefinitions(classId, titleIds) {
  const definitions = await Promise.all(
    titleIds.map((titleId) => loadTitleDefinition(classId, titleId)),
  );
  return new Map(
    definitions
      .filter(Boolean)
      .map((definition) => [definition.id, definition]),
  );
}

export default function useEquippedTitle(classId, uid) {
  const [equippedTitle, setEquippedTitle] = useState(null);
  const [equippedTitles, setEquippedTitles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classId || !uid) {
      setEquippedTitle(null);
      setEquippedTitles([]);
      setLoading(false);
      return undefined;
    }

    let latestOwnedItems = [];
    let latestDefinitionMap = new Map();
    let ownedReady = false;
    let definitionsReady = false;
    let cancelled = false;
    let latestDefinitionRequestKey = "";

    const syncSelectedTitles = () => {
      const selectedTitles = buildSelectedTitles(
        latestOwnedItems,
        latestDefinitionMap,
      );
      setEquippedTitles(selectedTitles);
      setEquippedTitle(selectedTitles[0] || null);
      if (ownedReady && definitionsReady) {
        setLoading(false);
      }
    };

    setLoading(true);

    const ownedTitlesQuery = query(
      collection(db, "classes", classId, "students", uid, "ownedTitles"),
      where("equipped", "==", true),
    );
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: "useEquippedTitle",
      pathKey:
        "classes/{classId}/students/{uid}/ownedTitles?equipped=true",
      classId,
    });

    const unsubscribeOwnedTitles = onSnapshot(
      ownedTitlesQuery,
      (snapshot) => {
        subscriptionDebug.recordSnapshot(snapshot);
        ownedReady = true;
        latestOwnedItems = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));
        const titleIds = getRepresentativeTitleIds(latestOwnedItems);
        latestDefinitionRequestKey = titleIds.join("|");
        definitionsReady = titleIds.length === 0;
        latestDefinitionMap = new Map();
        syncSelectedTitles();

        if (!titleIds.length) return;

        void loadTitleDefinitions(classId, titleIds)
          .then((definitionMap) => {
            if (cancelled) return;
            if (latestDefinitionRequestKey !== titleIds.join("|")) return;
            definitionsReady = true;
            latestDefinitionMap = definitionMap;
            syncSelectedTitles();
          })
          .catch((error) => {
            if (cancelled) return;
            console.error("[useEquippedTitle] title definitions load error:", error);
            definitionsReady = true;
            latestDefinitionMap = new Map();
            syncSelectedTitles();
          });
      },
      (error) => {
        subscriptionDebug.recordError(error);
        console.error("[useEquippedTitle] ownedTitles subscribe error:", error);
        ownedReady = true;
        definitionsReady = true;
        latestOwnedItems = [];
        syncSelectedTitles();
      },
    );

    return () => {
      cancelled = true;
      unsubscribeOwnedTitles();
      subscriptionDebug.stop();
    };
  }, [classId, uid]);

  return { equippedTitle, equippedTitles, loading };
}
