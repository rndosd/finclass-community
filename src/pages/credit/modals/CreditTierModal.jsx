import React, { useMemo, useState } from "react";
import { X, Trophy, Users, BarChart2, AlertCircle } from "lucide-react";
import { Modal, Button, Badge } from "../../../components/ui";

export default function CreditTierModal({
  isOpen,
  onClose,
  isAdmin = false,
  criteria = [],
  students = [],
}) {
  const [showStats, setShowStats] = useState(false);

  // 1) 정렬: 점수 높은 순
  const sortedCriteria = useMemo(
    () => [...criteria].sort((a, b) => b.minScore - a.minScore),
    [criteria]
  );

  // 2) 범위 계산
  const tierRanges = useMemo(() => {
    return sortedCriteria.map((tier, idx) => {
      const upper = idx === 0 ? null : sortedCriteria[idx - 1].minScore;
      return {
        ...tier,
        lowerBound: Number(tier.minScore) || 0,
        upperBound: upper,
      };
    });
  }, [sortedCriteria]);

  // 3) 통계 계산
  const tierStats = useMemo(() => {
    if (!students || students.length === 0 || tierRanges.length === 0)
      return null;

    const stats = {};
    tierRanges.forEach((t) => {
      stats[t.name] = { count: 0, percentage: 0 };
    });

    const validStudents = students.filter((s) =>
      Number.isFinite(Number(s.creditScore))
    );
    const total = validStudents.length;

    validStudents.forEach((s) => {
      const score = Number(s.creditScore);
      for (const t of tierRanges) {
        const inLower = score >= t.lowerBound;
        const inUpper = t.upperBound == null ? true : score < t.upperBound;
        if (inLower && inUpper) {
          stats[t.name].count += 1;
          break;
        }
      }
    });

    Object.keys(stats).forEach((key) => {
      stats[key].percentage =
        total > 0 ? Math.round((stats[key].count / total) * 100) : 0;
    });

    return stats;
  }, [students, tierRanges]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      showDefaultCloseButton={false}
      aria-label="신용 등급표"
    >
      {/* 헤더 */}
      <Modal.Header>
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="p-2 bg-yellow-50 rounded-xl text-yellow-600">
              <Trophy size={24} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-slate-900 sm:text-xl">신용 등급표</h2>
              <p className="text-sm text-slate-500">점수 구간별 등급 기준</p>
            </div>
          </div>
          <Button tone="slate" kind="ghost" size="icon-md"
            type="button"
            onClick={onClose}
            aria-label="신용 등급표 닫기"
            className="flex w-11 shrink-0 items-center justify-center transition-colors"
          >
            <X size={20} />
          </Button>
        </div>
      </Modal.Header>

      {/* 본문 */}
      <Modal.Body>
        <div className="space-y-4">
          {/* 상단 컨트롤 (통계 토글) */}
          {tierStats && (
            <div className="flex justify-end">
              <Button
                onClick={() => setShowStats(!showStats)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  showStats
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {showStats ? <Users size={14} /> : <BarChart2 size={14} />}
                {showStats ? "통계 숨기기" : "통계 보기"}
              </Button>
            </div>
          )}

          {/* 등급 리스트 */}
          {sortedCriteria.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <AlertCircle size={32} className="mb-2 opacity-50" />
              <p className="font-medium">등급 기준이 없습니다.</p>
              {isAdmin && (
                <p className="text-xs mt-1">
                  관리자 설정에서 등급을 추가해주세요.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {tierRanges.map((tier, index) => {
                const stat = tierStats?.[tier.name];
                const isTopTier = index === 0;

                return (
                  <div
                    key={tier.id}
                    className="relative overflow-hidden bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
                  >
                    {/* 등급 색상 바 (왼쪽 장식) */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1.5"
                      style={{ backgroundColor: tier.color }}
                    />

                    {/* 등급 정보 */}
                    <div className="flex items-center gap-4 pl-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm"
                        style={{ backgroundColor: tier.color }}
                      >
                        {tier.name[0]}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-800 text-lg">
                            {tier.displayName || tier.name}
                          </h3>
                          {isTopTier && (
                            <Badge
                              tone="yellow"
                              variant="soft"
                              size="sm"
                              className="text-[10px] px-1.5 py-0.5"
                            >
                              최고 등급
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium text-slate-500 mt-0.5">
                          <span className="text-slate-800 font-bold">
                            {tier.lowerBound.toLocaleString()}
                          </span>
                          점
                          {tier.upperBound ? (
                            <>
                              <span className="mx-1 text-slate-300">~</span>
                              <span className="text-slate-400">
                                {tier.upperBound.toLocaleString()}점 미만
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-400 ml-1"> 이상</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* 통계 (우측) */}
                    {showStats && stat && (
                      <div className="flex flex-col items-end animate-fade-in-right">
                        <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                          <Users size={14} className="text-slate-400" />
                          {stat.count}명
                        </div>
                        <div className="text-xs text-slate-400 font-medium bg-slate-50 px-2 py-0.5 rounded-md mt-1">
                          {stat.percentage}%
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal.Body>

      {/* 푸터 */}
      <Modal.Footer>
        <Button size="md"
          variant="secondary"
          onClick={onClose}
          className="w-full"
        >
          닫기
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
