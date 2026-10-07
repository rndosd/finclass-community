import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "../../../firebase";
import { updateMissionTokenCreditConfig } from "../services/missionEconomyService";
import {
  DEFAULT_MISSION_TOKEN_CREDIT_CONFIG,
  normalizeMissionTokenCreditConfig,
  normalizeTierList,
} from "../utils/missionTokenCreditConfig";

export { DEFAULT_MISSION_TOKEN_CREDIT_CONFIG };

function parseCreditScoreMax(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : null;
}

export function useMissionTokenCreditConfig(classId, { enabled = true } = {}) {
  const [config, setConfig] = useState(DEFAULT_MISSION_TOKEN_CREDIT_CONFIG);
  const [tiers, setTiers] = useState([]);
  const [creditScoreMax, setCreditScoreMax] = useState(null);
  const [isConfigLoading, setIsConfigLoading] = useState(
    Boolean(enabled && classId),
  );
  const [isTierLoading, setIsTierLoading] = useState(
    Boolean(enabled && classId),
  );
  const [configLoadedClassId, setConfigLoadedClassId] = useState(null);
  const [tiersLoadedClassId, setTiersLoadedClassId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!enabled || !classId) {
      setConfigLoadedClassId(null);
      if (!classId) {
        setConfig(DEFAULT_MISSION_TOKEN_CREDIT_CONFIG);
      }
      setIsConfigLoading(false);
      return undefined;
    }

    setIsConfigLoading(true);

    const configRef = doc(db, `classes/${classId}/config/missionEconomy`);
    return onSnapshot(
      configRef,
      (snapshot) => {
        const nextConfig = snapshot.exists() ? snapshot.data() || {} : {};
        setConfig(normalizeMissionTokenCreditConfig(nextConfig));
        setConfigLoadedClassId(classId);
        setIsConfigLoading(false);
      },
      () => {
        setConfig(DEFAULT_MISSION_TOKEN_CREDIT_CONFIG);
        setConfigLoadedClassId(classId);
        setIsConfigLoading(false);
      },
    );
  }, [classId, enabled]);

  useEffect(() => {
    if (!enabled || !classId) {
      setTiersLoadedClassId(null);
      if (!classId) {
        setTiers([]);
        setCreditScoreMax(null);
      }
      setIsTierLoading(false);
      return undefined;
    }

    setIsTierLoading(true);

    const tierRef = doc(db, `classes/${classId}/tierCriteria/default`);
    return onSnapshot(
      tierRef,
      (snapshot) => {
        const tierData = snapshot.exists() ? snapshot.data() || {} : {};
        setTiers(normalizeTierList(tierData?.tiers || []));
        setCreditScoreMax(parseCreditScoreMax(tierData?.maxScore));
        setTiersLoadedClassId(classId);
        setIsTierLoading(false);
      },
      () => {
        setTiers([]);
        setCreditScoreMax(null);
        setTiersLoadedClassId(classId);
        setIsTierLoading(false);
      },
    );
  }, [classId, enabled]);

  const saveConfig = useCallback(
    async (payload) => {
      if (!classId) {
        throw new Error("학급 정보가 없어 설정을 저장할 수 없습니다.");
      }

      setIsSaving(true);
      try {
        return await updateMissionTokenCreditConfig(classId, payload);
      } finally {
        setIsSaving(false);
      }
    },
    [classId],
  );

  return {
    config,
    tiers,
    creditScoreMax,
    isLoading:
      Boolean(enabled && classId) &&
      (isConfigLoading ||
        isTierLoading ||
        configLoadedClassId !== classId ||
        tiersLoadedClassId !== classId),
    isSaving,
    saveConfig,
  };
}

export default useMissionTokenCreditConfig;
