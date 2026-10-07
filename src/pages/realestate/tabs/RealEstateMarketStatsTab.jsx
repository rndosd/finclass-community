import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  BarChart3,
  LineChart as LineChartIcon,
  TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { db } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';
import { EmptyState, SectionLoader } from '../../../components/ui';
import DateRangeFilter from '../../../components/ui/DateRangeFilter';
import {
  getRecentDateRangeInKST,
  parseDateKeyAsKST,
} from '../../../utils/kstDate';

import { buildMarketStats, formatPercent } from '../utils/marketStats';
import { toViewerLayoutGroups } from '../utils/deskSummary';

const getDefaultRange = () => {
  const range = getRecentDateRangeInKST({ days: 30 });
  return {
    start: parseDateKeyAsKST(range.startDate),
    end: parseDateKeyAsKST(range.endDate, { endOfDay: true }),
  };
};

const StatCard = ({ title, value, caption, tone = 'slate' }) => {
  const toneClass = {
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    indigo: 'border-indigo-100 bg-indigo-50 text-indigo-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    slate: 'border-slate-200 bg-white text-slate-800',
  }[tone];

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-wide opacity-70">{title}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs font-semibold opacity-70">{caption}</p>
    </div>
  );
};

const RealEstateMarketStatsTab = ({ classId, layoutData }) => {
  const { formatCurrency } = useUser();
  const [dateRange, setDateRange] = useState(getDefaultRange);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!classId || !dateRange.start || !dateRange.end) {
      setRecords([]);
      return;
    }

    let cancelled = false;
    const loadRecords = async () => {
      setLoading(true);
      setErrorMessage('');

      try {
        const ledgerQuery = query(
          collection(db, 'classes', classId, 'real_estate', 'ledger', 'transactions'),
          where('timestamp', '>=', Timestamp.fromDate(dateRange.start)),
          where('timestamp', '<=', Timestamp.fromDate(dateRange.end)),
          orderBy('timestamp', 'asc'),
        );
        const snapshot = await getDocs(ledgerQuery);
        if (cancelled) return;
        setRecords(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } catch (error) {
        console.error('[RealEstateMarketStatsTab] failed to load market stats:', error);
        if (!cancelled) {
          setRecords([]);
          setErrorMessage('시세 통계를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadRecords();

    return () => {
      cancelled = true;
    };
  }, [classId, dateRange.end, dateRange.start]);

  const stats = useMemo(() => buildMarketStats(records), [records]);
  const currentDesks = useMemo(() => toViewerLayoutGroups(layoutData?.groups).flatMap(group => group.desks || []).filter(desk => desk.isActive !== false), [layoutData?.groups]);
  const totalValue = currentDesks.reduce((sum, desk) => sum + Math.max(0, Number(desk.price) || 0), 0);
  const stateCount = currentDesks.filter(desk => !desk.ownerId && desk.ownerType === 'state').length;
  const studentCount = currentDesks.filter(desk => desk.ownerId && desk.ownerType === 'student').length;
  const fundCount = currentDesks.filter(desk => desk.ownerType === 'classFund').length;
  const bestRiser = stats.topRisers[0] || null;

  return (
    <div className="space-y-4">
      <section aria-label="현재 부동산 현황" className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">현재 부동산 현황</h3>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><p className="text-xs text-slate-500">전체 자리 시세 합계</p><p className="text-xl font-bold text-slate-900">{formatCurrency(totalValue)}</p></div>
          <div><p className="text-xs text-slate-500">국가 소유</p><p className="text-xl font-bold">{stateCount}자리</p></div>
          <div><p className="text-xs text-slate-500">학생 소유</p><p className="text-xl font-bold">{studentCount}자리</p></div>
          <div><p className="text-xs text-slate-500">펀드 소유</p><p className="text-xl font-bold">{fundCount}자리</p></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">현재 사용 중인 자리 기준이며 아래 기간 선택과는 별개입니다.</p>
      </section>
      <DateRangeFilter
        value={dateRange}
        onChange={setDateRange}
        title="시세 기간"
        description="거래 장부의 매매와 시세조정 기록만 기준으로 봅니다."
        presets={[
          { label: '14일', days: 14 },
          { label: '30일', days: 30 },
          { label: '90일', days: 90 },
        ]}
      />

      {loading ? (
        <SectionLoader
          message="시세 통계를 불러오는 중입니다."
          tone="slate"
          size="sm"
          showSkeleton={false}
          minHeightClassName="min-h-[320px]"
        />
      ) : errorMessage ? (
        <section className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm font-bold text-rose-700">
          {errorMessage}
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="조정 자리 시세 변화율"
              value={formatPercent(stats.periodChangeRate)}
              caption={`조정된 ${stats.adjustedDeskCount}자리 · ${stats.adjustmentCount.toLocaleString()}건`}
              tone={Number(stats.periodChangeRate) >= 0 ? 'emerald' : 'rose'}
            />
            <StatCard
              title="평균 거래가"
              value={stats.saleCount > 0 ? formatCurrency(stats.averageTradePrice) : '-'}
              caption="일반 매매와 경매 낙찰 포함"
              tone="indigo"
            />
            <StatCard
              title="거래량"
              value={`${stats.saleCount.toLocaleString()}건`}
              caption="시세조정은 제외"
              tone="slate"
            />
            <StatCard
              title="최고 상승 자리"
              value={bestRiser ? bestRiser.deskLabel : '-'}
              caption={bestRiser ? formatPercent(bestRiser.changeRate) : '상승 기록 없음'}
              tone="amber"
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                  <LineChartIcon size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">조정 자리 시세지수</h3>
                  <p className="text-xs font-semibold text-slate-500">이 기간에 조정된 자리만, 각 자리의 첫 조정 전 가격을 100으로 비교합니다. 전체 교실 지수가 아닙니다.</p>
                </div>
              </div>

              {stats.chartRows.length > 0 ? (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.chartRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis
                        width={42}
                        domain={['dataMin - 2', 'dataMax + 2']}
                        tick={{ fontSize: 12, fill: '#64748b' }}
                      />
                      <Tooltip
                        formatter={(value, name) => (
                          name === 'index' ? [`${value}`, '시세지수'] : [value, name]
                        )}
                        labelFormatter={(label) => `날짜 ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="index"
                        stroke="#4f46e5"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title="이 기간에는 시세조정 기록이 없습니다"
                  description="시세조정이 발생하면 지수 추이가 차트로 표시됩니다."
                  className="min-h-[120px] rounded-lg border-slate-200 bg-slate-50"
                />
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
                  <TrendingUp size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">상승 자리 Top 3</h3>
                  <p className="text-xs font-semibold text-slate-500">시세조정 전후 가격 기준</p>
                </div>
              </div>

              {stats.topRisers.length > 0 ? (
                <div className="space-y-3">
                  {stats.topRisers.map((row, index) => (
                    <div key={row.deskId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black text-slate-400">#{index + 1}</p>
                          <p className="text-sm font-black text-slate-900">{row.deskLabel}</p>
                        </div>
                        <p className="text-lg font-black text-emerald-600">{formatPercent(row.changeRate)}</p>
                      </div>
                      <p className="mt-2 text-xs font-semibold text-slate-500">
                        {formatCurrency(row.firstPrice)} → {formatCurrency(row.latestPrice)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={TrendingUp}
                  title="상승한 자리 기록이 없습니다"
                  description="가격이 오른 자리가 생기면 Top 3 목록에 표시됩니다."
                  className="min-h-[120px] rounded-lg border-slate-200 bg-slate-50"
                />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default RealEstateMarketStatsTab;
