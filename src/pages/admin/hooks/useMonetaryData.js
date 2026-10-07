import { useEffect, useMemo, useState } from "react";
import { db } from "../../../firebase";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import dayjs from "dayjs";
import { calcClassAggregates } from "../../../utils/econUtils";

const DEFAULT_ECON_CONFIG = {
  liquidityLambda: 0.2,
  cpiBasket: [],
  cpiBasePrices: null,
  cpiBaseDate: null,
};

const LIQUIDITY_WEIGHTS = Object.freeze({
  usd: 0.9,
  deposit: 0.2,
  stock: 0.35,
});

const toNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isStudentRole = (role) =>
  String(role || "student").trim().toLowerCase() === "student";
const isMonetaryAggregateExcluded = (student) =>
  student?.statsExclusion?.monetaryAggregates === true;

const calcPctChange = (current, past) => {
  if (!Number.isFinite(Number(past)) || Number(past) === 0) return null;
  return ((Number(current) - Number(past)) / Number(past)) * 100;
};

const calcAmountChange = (current, past) => {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(past))) return null;
  return Number(current) - Number(past);
};

const pickSnapshotValue = (snap, fields = []) => {
  if (!snap || !snap.exists()) return null;
  const data = snap.data() || {};
  for (const field of fields) {
    const value = Number(data?.[field]);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

export const useEconConfig = (classId) => {
  const [econConfig, setEconConfig] = useState(DEFAULT_ECON_CONFIG);

  useEffect(() => {
    if (!classId) return undefined;

    return onSnapshot(
      doc(db, `classes/${classId}/config/econ`),
      (snap) => {
        if (!snap.exists()) {
          setEconConfig(DEFAULT_ECON_CONFIG);
          return;
        }

        const d = snap.data() || {};
        setEconConfig({
          liquidityLambda: d.liquidityLambda ?? 0.2,
          cpiBasket: Array.isArray(d.cpiBasket) ? d.cpiBasket : [],
          cpiBasePrices: d.cpiBasePrices || null,
          cpiBaseDate: d.cpiBaseDate || null,
        });
      },
      (e) => {
        console.warn("econ config load failed:", e);
        setEconConfig(DEFAULT_ECON_CONFIG);
      },
    );
  }, [classId]);

  return econConfig;
};

export const useCPI = (classId, econConfig) => {
  const [cpiState, setCpiState] = useState({
    value: 100,
    baseDate: null,
    loading: true,
  });

  useEffect(() => {
    if (!classId) return;

    const calcCPI = async () => {
      try {
        setCpiState((prev) => ({ ...prev, loading: true }));

        const basket = econConfig.cpiBasket || [];
        if (!basket.length) {
          setCpiState({
            value: 100,
            baseDate: econConfig.cpiBaseDate || null,
            loading: false,
          });
          return;
        }

        const rows = await Promise.all(
          basket.map(async ({ itemId, weight = 1 }) => {
            const itemSnap = await getDoc(
              doc(db, `classes/${classId}/storeItems/${itemId}`)
            );

            const price = itemSnap.exists()
              ? toNumber(itemSnap.data()?.price)
              : 0;
            const base = econConfig.cpiBasePrices?.[itemId];
            const normalizedWeight = toNumber(weight) || 1;

            return {
              today: price * normalizedWeight,
              base: Number.isFinite(Number(base))
                ? Number(base) * normalizedWeight
                : price * normalizedWeight,
            };
          })
        );

        const todaySum = rows.reduce((sum, r) => sum + r.today, 0);
        const baseSum = rows.reduce((sum, r) => sum + r.base, 0);
        const value = baseSum > 0 ? (todaySum / baseSum) * 100 : 100;

        setCpiState({
          value,
          baseDate: econConfig.cpiBaseDate || null,
          loading: false,
        });
      } catch (e) {
        console.warn("CPI calculation failed:", e);
        setCpiState({
          value: 100,
          baseDate: econConfig.cpiBaseDate || null,
          loading: false,
        });
      }
    };

    calcCPI();
  }, [
    classId,
    econConfig.cpiBasket,
    econConfig.cpiBasePrices,
    econConfig.cpiBaseDate,
  ]);

  return cpiState;
};

export const useStoreMetrics = (classId, students = [], windowDays = 7) => {
  const totalStudents = Array.isArray(students)
    ? students.filter((student) => isStudentRole(student?.role)).length
    : 0;
  const safeWindowDays =
    Number.isFinite(Number(windowDays)) && Number(windowDays) > 0
      ? Math.floor(Number(windowDays))
      : 7;
  const windowKey = `${safeWindowDays}d`;

  const [storeMetrics, setStoreMetrics] = useState({
    loading: true,
    completedAmount: 0,
    refundAmount: 0,
    netSpend: 0,
    redeemedCount: 0,
    redeemedVolume: 0,
    completedCount: 0,
    refundCount: 0,
    avgTicket: 0,
    participantCount: 0,
    totalStudents: 0,
    participationRate: 0,
  });

  useEffect(() => {
    if (!classId) return;

    (async () => {
      try {
        setStoreMetrics((prev) => ({ ...prev, loading: true }));
        const latestHistoryQuery = query(
          collection(db, `classes/${classId}/monetaryHistory`),
          orderBy("date", "desc"),
          limit(1)
        );
        const latestHistorySnap = await getDocs(latestHistoryQuery);

        if (latestHistorySnap.empty) {
          setStoreMetrics({
            loading: false,
            completedAmount: 0,
            refundAmount: 0,
            netSpend: 0,
            redeemedCount: 0,
            redeemedVolume: 0,
            completedCount: 0,
            refundCount: 0,
            avgTicket: 0,
            participantCount: 0,
            totalStudents,
            participationRate: 0,
          });
          return;
        }

        const latestHistory = latestHistorySnap.docs[0].data() || {};
        const windowMetrics =
          latestHistory?.storeMetrics?.[windowKey] ||
          (safeWindowDays === 7
            ? {
                completedAmount:
                  latestHistory.completedAmount ?? latestHistory.redeemedVolume,
                completedCount:
                  latestHistory.completedCount ?? latestHistory.redeemedCount,
                redeemedVolume: latestHistory.redeemedVolume,
                redeemedCount: latestHistory.redeemedCount,
                refundAmount: latestHistory.refundAmount,
                refundCount: latestHistory.refundCount,
                netSpend: latestHistory.netSpend,
                participantCount: latestHistory.participantCount,
              }
            : null);

        const completedAmount = toNumber(
          windowMetrics?.completedAmount ?? windowMetrics?.redeemedVolume
        );
        const completedCount = Math.round(
          toNumber(windowMetrics?.completedCount ?? windowMetrics?.redeemedCount)
        );
        const refundAmount = toNumber(windowMetrics?.refundAmount);
        const refundCount = Math.round(toNumber(windowMetrics?.refundCount));
        const participantCount = Math.round(
          toNumber(windowMetrics?.participantCount)
        );

        const netSpend = completedAmount - refundAmount;
        const avgTicket = completedCount > 0 ? completedAmount / completedCount : 0;
        const participationRate =
          totalStudents > 0 ? (participantCount / totalStudents) * 100 : 0;

        setStoreMetrics({
          loading: false,
          completedAmount,
          refundAmount,
          netSpend,
          redeemedCount: completedCount,
          redeemedVolume: completedAmount,
          completedCount,
          refundCount,
          avgTicket,
          participantCount,
          totalStudents,
          participationRate,
        });
      } catch (e) {
        console.warn("store metrics load failed:", e);
        setStoreMetrics({
          loading: false,
          completedAmount: 0,
          refundAmount: 0,
          netSpend: 0,
          redeemedCount: 0,
          redeemedVolume: 0,
          completedCount: 0,
          refundCount: 0,
          avgTicket: 0,
          participantCount: 0,
          totalStudents,
          participationRate: 0,
        });
      }
    })();
  }, [classId, totalStudents, safeWindowDays, windowKey]);

  return storeMetrics;
};

export const useTrends = (classId, agg) => {
  const [trends, setTrends] = useState({
    totalClassAssets: {
      day: null,
      week: null,
      month: null,
      dayDelta: null,
      weekDelta: null,
      monthDelta: null,
    },
    liquidMoney: {
      day: null,
      week: null,
      month: null,
      dayDelta: null,
      weekDelta: null,
      monthDelta: null,
    },
  });

  useEffect(() => {
    if (!classId) return;

    (async () => {
      try {
        const findRecentWeekdayData = async (daysAgo) => {
          let targetDate = dayjs().subtract(daysAgo, "day");

          for (let i = 0; i < 3; i += 1) {
            const dateStr = targetDate.format("YYYY-MM-DD");
            const snap = await getDoc(
              doc(db, `classes/${classId}/monetaryHistory/${dateStr}`)
            );
            if (snap.exists()) return snap;
            targetDate = targetDate.subtract(1, "day");
          }

          return null;
        };

        const [yesterdaySnap, weekSnap, monthSnap] = await Promise.all([
          findRecentWeekdayData(1),
          findRecentWeekdayData(7),
          findRecentWeekdayData(30),
        ]);

        const makeTrend = (current, snap, fields) => {
          const past = pickSnapshotValue(snap, fields);
          return {
            pct: calcPctChange(current, past),
            delta: calcAmountChange(current, past),
          };
        };

        const totalDay = makeTrend(agg.totalClassAssets, yesterdaySnap, [
          "totalClassAssets",
          "totalWealth",
          "totalNetWealth",
        ]);
        const totalWeek = makeTrend(agg.totalClassAssets, weekSnap, [
          "totalClassAssets",
          "totalWealth",
          "totalNetWealth",
        ]);
        const totalMonth = makeTrend(agg.totalClassAssets, monthSnap, [
          "totalClassAssets",
          "totalWealth",
          "totalNetWealth",
        ]);
        const liquidDay = makeTrend(agg.liquidMoney, yesterdaySnap, ["liquidMoney"]);
        const liquidWeek = makeTrend(agg.liquidMoney, weekSnap, ["liquidMoney"]);
        const liquidMonth = makeTrend(agg.liquidMoney, monthSnap, ["liquidMoney"]);

        setTrends({
          totalClassAssets: {
            day: totalDay.pct,
            week: totalWeek.pct,
            month: totalMonth.pct,
            dayDelta: totalDay.delta,
            weekDelta: totalWeek.delta,
            monthDelta: totalMonth.delta,
          },
          liquidMoney: {
            day: liquidDay.pct,
            week: liquidWeek.pct,
            month: liquidMonth.pct,
            dayDelta: liquidDay.delta,
            weekDelta: liquidWeek.delta,
            monthDelta: liquidMonth.delta,
          },
        });
      } catch (e) {
        console.warn("trend calculation failed:", e);
      }
    })();
  }, [classId, agg.totalClassAssets, agg.liquidMoney]);

  return trends;
};

export const useMonetaryData = (
  classId,
  students,
  conversionRate
) => {
  const studentsForStats = useMemo(
    () =>
      Array.isArray(students)
        ? students.filter((student) => isStudentRole(student?.role))
            .filter((student) => !isMonetaryAggregateExcluded(student))
        : [],
    [students]
  );

  const econConfig = useEconConfig(classId);

  const agg = useMemo(() => {
    const safeRate = Number(conversionRate) > 0 ? Number(conversionRate) : 1;

    const legacyAgg = calcClassAggregates(studentsForStats, {
      conversionRate: safeRate,
      liquidityLambda: econConfig.liquidityLambda ?? 0.2,
    });

    let totalClassAssets = 0;
    let liquidMoney = 0;
    const netWorthRows = [];

    studentsForStats.forEach((student) => {
      const assets = student?.assets || {};
      const cash = toNumber(assets.cash);
      const deposit = toNumber(assets.deposit);
      const usdBalance = toNumber(assets.usdBalance);

      const stockValueUSD =
        toNumber(student?.stockValueUSD) ||
        toNumber(student?.stockUSD) ||
        toNumber(assets?.stockValue?.rawValueUSD) ||
        toNumber(assets?.stockValue?.value);

      const usdLocal = usdBalance / safeRate;
      const stockLocal = stockValueUSD / safeRate;

      const totalNetWorth = toNumber(assets.totalNetWorth);
      totalClassAssets += totalNetWorth;
      netWorthRows.push(totalNetWorth);

      liquidMoney +=
        cash +
        usdLocal * LIQUIDITY_WEIGHTS.usd +
        deposit * LIQUIDITY_WEIGHTS.deposit +
        stockLocal * LIQUIDITY_WEIGHTS.stock;
    });

    const studentCount = studentsForStats.length;
    const liquidityRatio =
      totalClassAssets > 0 ? (liquidMoney / totalClassAssets) * 100 : null;
    const perStudentLiquidMoney =
      studentCount > 0 ? liquidMoney / studentCount : 0;
    const topAssetCount = studentCount > 0 ? Math.max(1, Math.ceil(studentCount * 0.2)) : 0;
    const topAssetSum = netWorthRows
      .sort((a, b) => b - a)
      .slice(0, topAssetCount)
      .reduce((sum, value) => sum + value, 0);
    const top20AssetShare =
      totalClassAssets > 0 && topAssetCount > 0
        ? (topAssetSum / totalClassAssets) * 100
        : null;

    return {
      ...legacyAgg,
      totalClassAssets,
      liquidMoney,
      studentCount,
      liquidityRatio,
      perStudentLiquidMoney,
      top20AssetShare,
      liquidityWeights: LIQUIDITY_WEIGHTS,
    };
  }, [studentsForStats, conversionRate, econConfig.liquidityLambda]);

  const trends = useTrends(classId, agg);

  return {
    econConfig,
    agg,
    trends,
  };
};
