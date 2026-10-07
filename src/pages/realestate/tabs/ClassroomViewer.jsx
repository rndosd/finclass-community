import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { FileSignature, FileText, Info, Minus, MousePointer2, Plus, School, TrendingUp } from "lucide-react";

import FreeSeatBoard from "../components/FreeSeatBoard";
import ClassroomDeskVisual from "../components/ClassroomDeskVisual";
import SeatTradeModal from "../modals/SeatTradeModal";
import BulkRentContractModal from "../modals/BulkRentContractModal";
import PriceAdjustmentModal from "../modals/PriceAdjustmentModal";
import { Button, EmptyState, IconButton, SectionLoader } from "../../../components/ui";
import { toViewerLayoutGroups } from "../utils/deskSummary";
import { GRID_SIZE, MAX_DESK_DISPLAY_SCALE, resolveSeatPlacements } from "../utils/freeSeatPlacement";
import { getDeskRentStatus } from "../utils/rentStatus";
import { canSeeDeskOverdue, getClassroomSeatStatus } from "../utils/classroomSeatStatus";

const ClassroomViewer = ({
  layoutData,
  placementData,
  configData,
  onOpenContractCenter,
  requestedDeskId = "",
  onRequestedDeskHandled,
  onFinancialDemand,
  financialReady = true,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const {
    classId,
    userData: user,
    isTeacher,
    isAccountSwitching,
    currencyUnit,
  } = useUser();
  const { showFeedback } = useFeedback();

  const [selectedDesk, setSelectedDesk] = useState(null);
  const [viewMode, setViewMode] = useState("student");
  const [viewZoom, setViewZoom] = useState(100);
  const [fitWholeLayout, setFitWholeLayout] = useState(false);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [isBulkRentModalOpen, setIsBulkRentModalOpen] = useState(false);
  const [isPriceAdjustModalOpen, setIsPriceAdjustModalOpen] = useState(false);
  const [showMobileBoard, setShowMobileBoard] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 767px)');
    if (!query) return undefined;
    const update = () => setIsMobile(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    onFinancialDemand?.({
      all: isMobile || viewMode === 'property' || isBulkRentModalOpen || isPriceAdjustModalOpen,
      deskId: isTradeModalOpen ? selectedDesk?.id || '' : '',
      includeContracts: isMobile || viewMode === 'property' || isTradeModalOpen || isBulkRentModalOpen,
    });
  }, [onFinancialDemand, isMobile, viewMode, isBulkRentModalOpen, isPriceAdjustModalOpen, isTradeModalOpen, selectedDesk?.id]);
  const displayedViewMode = viewMode;
  const groups = useMemo(() => toViewerLayoutGroups(layoutData?.groups), [layoutData?.groups]);
  const freeSeats = useMemo(() => resolveSeatPlacements(groups, placementData), [groups, placementData]);
  const freeDeskById = useMemo(() => new Map(groups.flatMap((group) => group.desks || []).map((desk) => [desk.id, desk])), [groups]);
  const visibleSeats = useMemo(() => freeSeats.filter((seat) => freeDeskById.get(seat.id)?.isActive !== false), [freeSeats, freeDeskById]);
  const savedDeskDisplayScale = Number(placementData?.deskDisplayScale);
  const deskDisplayScale = Number.isInteger(savedDeskDisplayScale) && savedDeskDisplayScale >= 80 &&
    savedDeskDisplayScale <= MAX_DESK_DISPLAY_SCALE && savedDeskDisplayScale % 10 === 0 ? savedDeskDisplayScale : 100;
  const visibleDeskScale = Math.min(deskDisplayScale, MAX_DESK_DISPLAY_SCALE);
  const getSeatStatus = (desk) => getClassroomSeatStatus(desk, {
    userUid: user?.uid, isTeacher, isAccountSwitching,
  });
  const getDeskPrice = (desk) => Number(desk.lastPurchasePrice || desk.price || 0);
  const getDeskPriceText = (desk) => formatDisplayMoney(getDeskPrice(desk), { compact: true });
  const config = useMemo(
    () => ({
      enabled: configData?.enabled !== false,
      officialPriceRatio: Number(configData?.officialPriceRatio) || 70,
      acquisitionTaxRate:
        configData?.acquisitionTaxEnabled === false
          ? null
          : Number.isFinite(Number(configData?.acquisitionTaxRate))
            ? Number(configData?.acquisitionTaxRate)
            : 0,
      capitalGainsTaxRate:
        configData?.capitalGainsTaxEnabled === false
          ? null
          : Number.isFinite(Number(configData?.capitalGainsTaxRate))
            ? Number(configData?.capitalGainsTaxRate)
            : 0,
      saleTemplate: configData?.saleTemplate || "",
      saleSpecialTerms: configData?.saleSpecialTerms || "",
      rentLimitEnabled: configData?.rentLimitEnabled !== false,
      rentLimitRate: Number(configData?.rentLimitRate) || 0,
    }),
    [configData],
  );

  const isSystemEnabled = config.enabled;
  const summary = useMemo(() => {
    const initial = {
      activeSeatCount: 0,
      occupiedSeatCount: 0,
      vacantSeatCount: 0,
      forSaleCount: 0,
      contractingCount: 0,
      overdueCount: 0,
      myOwnedCount: 0,
    };

    groups.forEach((group) => {
      (group.desks || []).forEach((desk) => {
        if (!desk?.isActive) return;
        const isContracting = String(desk?.tradeStatus || "") === "contracting";
        initial.activeSeatCount += 1;
        if (desk.studentId) initial.occupiedSeatCount += 1;
        else initial.vacantSeatCount += 1;
        if (desk.isForSale && !isContracting) initial.forSaleCount += 1;
        if (isContracting) initial.contractingCount += 1;
        if (desk.ownerId && desk.ownerId === user?.uid) initial.myOwnedCount += 1;
        if (getDeskRentStatus(desk).isOverdue) initial.overdueCount += 1;
      });
    });

    return initial;
  }, [groups, user?.uid]);
  const mobileDesks = useMemo(
    () =>
      groups.flatMap((group) =>
        (group.desks || [])
          .filter((desk) => desk?.isActive)
          .map((desk) => ({ ...desk, groupName: group.name })),
      ),
    [groups],
  );

  const handleDeskClick = (desk) => {
    if (!isSystemEnabled) {
      showFeedback("부동산 시스템이 비활성화 상태입니다. 정책 설정에서 활성화해 주세요.", "warning");
      return;
    }
    setSelectedDesk(desk);
    setIsTradeModalOpen(true);
  };

  useEffect(() => {
    if (!requestedDeskId) return;

    const requestedDesk = groups
      .flatMap((group) => group?.desks || [])
      .find((desk) => String(desk?.id || "") === String(requestedDeskId));

    if (requestedDesk && isSystemEnabled) {
      setSelectedDesk(requestedDesk);
      setIsTradeModalOpen(true);
    } else if (requestedDesk && !isSystemEnabled) {
      showFeedback(
        "부동산 시스템이 비활성화 상태라 상세 거래를 열 수 없습니다.",
        "warning",
      );
    }

    onRequestedDeskHandled?.();
  }, [
    groups,
    isSystemEnabled,
    onRequestedDeskHandled,
    requestedDeskId,
    showFeedback,
  ]);

  useEffect(() => {
    if (!selectedDesk?.id) return;

    let latestDesk = null;
    for (const group of groups) {
      latestDesk = (group.desks || []).find((desk) => desk.id === selectedDesk.id) || null;
      if (latestDesk) break;
    }

    if (!latestDesk) return;

    setSelectedDesk((prev) => (prev === latestDesk ? prev : latestDesk));
  }, [groups, selectedDesk?.id]);


  return (
    <div className="w-full space-y-5 animate-fade-in">
      {!isSystemEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-700">
          교실은 볼 수 있지만, 지금은 거래·임대를 할 수 없어요.
        </div>
      )}

      <section className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-center gap-2">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${
                isSystemEnabled
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}>
                <span className="opacity-70">시스템 상태</span>
                <span>{isSystemEnabled ? "활성화" : "비활성화"}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                <span className="text-slate-500">활성 좌석</span>
                <span>{summary.activeSeatCount}개</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">
                <span className="opacity-70">입주 인원</span>
                <span>{summary.occupiedSeatCount}명</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                <span className="text-slate-500">빈자리</span>
                <span>{summary.vacantSeatCount}개</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                <span className="opacity-70">판매 중</span>
                <span>{summary.forSaleCount}개</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-700">
                <span className="opacity-70">계약 진행</span>
                <span>{summary.contractingCount}개</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                <span className="opacity-70">임대 연체</span>
                <span>{summary.overdueCount}개</span>
              </div>
            </div>
          </div>

          {isTeacher && (
            <Button
              icon={TrendingUp}
              tone="blue"
              disabled={!isSystemEnabled}
              onClick={() => setIsPriceAdjustModalOpen(true)}
              className="hidden self-start xl:self-auto"
            >
              땅값 일괄 조정
            </Button>
          )}
        </div>
      </section>

      {isTeacher && (
        <section className="hidden rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-black text-emerald-800">임대 관리</p>
              <p className="text-xs font-semibold text-emerald-700">
                여러 자리를 선택해서 같은 임대 기간과 주 임대료를 한 번에 적용할 수 있습니다.
              </p>
            </div>
            <Button
              icon={FileSignature}
              tone="emerald"
              disabled={!isSystemEnabled}
              onClick={() => setIsBulkRentModalOpen(true)}
              className="self-start md:self-auto"
            >
            임대 관리
            </Button>
          </div>
        </section>
      )}

      {isTeacher && (
        <section className="hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={TrendingUp}
              tone="blue"
              disabled={!isSystemEnabled}
              onClick={() => setIsPriceAdjustModalOpen(true)}
            >
              땅값 일괄 조정
            </Button>
            <Button
              icon={FileSignature}
              tone="emerald"
              disabled={!isSystemEnabled}
              onClick={() => setIsBulkRentModalOpen(true)}
            >
              임대 관리
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-4 md:hidden">
        {!financialReady ? <p role="status" className="p-4 text-sm text-slate-600">부동산 정보를 불러오는 중입니다…</p> : <>
        <div className="grid grid-cols-2 gap-3">
          {[
            ["입주 좌석", `${summary.occupiedSeatCount}개`],
            ["빈 좌석", `${summary.vacantSeatCount}개`],
            ["판매 중", `${summary.forSaleCount}개`],
            ["계약 진행", `${summary.contractingCount}개`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <p className="text-xs font-semibold text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-black text-slate-800">{value}</p>
            </div>
          ))}
        </div>

        {mobileDesks.length === 0 ? (
          <EmptyState
            icon={School}
            title="표시할 교실 배치가 없습니다"
            description="자리 배치가 저장되면 좌석 목록을 확인할 수 있습니다."
            className="rounded-2xl border-slate-300 bg-white px-6 py-14"
          />
        ) : (
        <div className="space-y-3">
          {mobileDesks.map((desk) => {
            const rentStatus = getDeskRentStatus(desk);
            const price = Number(desk.lastPurchasePrice || desk.price || 0);
            const canSeeOverdue = canSeeDeskOverdue(desk, { userUid: user?.uid, isTeacher, isAccountSwitching });
            const status = rentStatus.isOverdue && canSeeOverdue
              ? "임대료 연체"
              : desk.tradeStatus === "contracting"
                ? "계약 진행"
                : desk.isForSale
                  ? "판매 중"
                  : desk.studentId
                    ? "입주"
                    : "공실";

            return (
              <article
                key={desk.id}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-indigo-600">
                      {desk.label || `${desk.number ?? "-"}번 좌석`}
                    </p>
                    <p className="mt-1 truncate font-black text-slate-900">
                      {desk.studentName || "빈 좌석"}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      소유 {desk.ownerName || "국가"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${rentStatus.isOverdue && canSeeOverdue ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
                    {status}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">현재가</p>
                    <p className="font-black text-slate-800">
                      {formatDisplayMoney(price)} {currencyUnit || ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => handleDeskClick(desk)}
                    tone="blue"
                    kind="soft"
                    size="sm"
                    className="justify-center"
                  >
                    좌석 상세
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
        )}
        {mobileDesks.length > 0 ? (
          <Button size="md"
            type="button"
            kind="outline"
            tone="slate"
            onClick={() => setShowMobileBoard((current) => !current)}
            className="w-full justify-center"
          >
            {showMobileBoard ? "좌석 배치 닫기" : "좌석 배치 확대해서 보기"}
          </Button>
        ) : null}
        </>}
      </section>

      <section
        className={`relative overflow-hidden border border-slate-200 bg-white p-2 md:block md:p-3 rounded-2xl ${
          showMobileBoard ? "block" : "hidden"
        }`}
      >
        <Button size="md"
          type="button"
          kind="outline"
          tone="slate"
          onClick={() => setShowMobileBoard(false)}
          className="relative z-30 mb-3 w-full justify-center md:hidden"
        >
          좌석 배치 닫기
        </Button>
        <div className="classroom-workspace__viewer-tools relative z-30 mb-3">
          <div className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="교실 보기 방식">
                <button type="button" aria-pressed={viewMode === "student"} onClick={() => setViewMode("student")}
                  className={`min-h-10 rounded-lg px-3 py-2 text-sm font-bold ${viewMode === "student" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>학생 이름 보기</button>
                <button type="button" aria-pressed={viewMode === "property"} onClick={() => setViewMode("property")}
                  className={`min-h-10 rounded-lg px-3 py-2 text-sm font-bold ${displayedViewMode === "property" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>전체 부동산 정보</button>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="교실 확대·축소">
                <IconButton icon={Minus} label="교실 축소" size="md" disabled={!fitWholeLayout && viewZoom <= 75}
                  onClick={() => { setFitWholeLayout(false); setViewZoom((zoom) => Math.max(75, (fitWholeLayout ? 100 : zoom) - 25)); }} />
                <span className="min-w-12 text-center text-sm font-semibold text-slate-600" aria-live="polite">{fitWholeLayout ? '전체' : `${viewZoom}%`}</span>
                <IconButton icon={Plus} label="교실 확대" size="md" disabled={!fitWholeLayout && viewZoom >= 150}
                  onClick={() => { setFitWholeLayout(false); setViewZoom((zoom) => Math.min(150, (fitWholeLayout ? 100 : zoom) + 25)); }} />
                <button type="button" aria-pressed={fitWholeLayout} onClick={() => { setViewZoom(100); setFitWholeLayout((fit) => !fit); }}
                  className="min-h-11 rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50">{fitWholeLayout ? '크게 보기' : '전체 보기'}</button>
              </div>
              {isTeacher && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  icon={TrendingUp}
                  tone="blue"
                  disabled={!isSystemEnabled}
                  onClick={() => setIsPriceAdjustModalOpen(true)}
                >
                  땅값 일괄 조정
                </Button>
                <Button size="md"
                  icon={FileText}
                  tone="blue"
                  kind="outline"
                  onClick={onOpenContractCenter}
                  
                >
                  계약서함
                </Button>
                <Button
                  icon={FileSignature}
                  tone="emerald"
                  disabled={!isSystemEnabled}
                  onClick={() => setIsBulkRentModalOpen(true)}
                >
                  임대 관리
                </Button>
                </div>
              )}
              <div className="group relative">
                <IconButton icon={Info} label="책상 배치 범례" size="sm"
                  className="rounded-lg border border-slate-200 bg-white" aria-label="책상 배치 범례" />
                <div className="absolute right-0 top-full z-40 mt-2 hidden w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl group-hover:block group-focus-within:block">
                  <p className="mb-2 text-[11px] font-black text-slate-700">책상 배치 범례</p>
                  <div className="space-y-1.5 text-[11px] font-semibold text-slate-600">
                    {viewMode === "student" ? "책상 색은 모둠을 나타냅니다." : "상태 배지는 판매·계약·보유 상태를 나타냅니다. 임대료 연체는 빨간 배지로 우선 표시합니다."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {viewMode === 'property' && !financialReady ? (
          <SectionLoader message="부동산 정보를 불러오는 중입니다…" minHeightClassName="min-h-[320px]" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={School}
            title="표시할 교실 배치가 없습니다"
            description="자리 배치가 저장되면 학생 자리와 부동산 상태를 확인할 수 있습니다."
            className="relative z-10 rounded-2xl border-slate-300 bg-white px-6 py-14"
          />
        ) : (
          <FreeSeatBoard classroomScene fitViewport readableDesks scrollForReadability frontLabel="교탁 · 교실 앞쪽" seats={freeSeats}
            fitFromBoardTop minSeatDisplayWidth={128} viewZoom={viewZoom / 100} fitWholeLayout={fitWholeLayout}
            fitBoundsSeats={visibleSeats} deskDisplayScale={visibleDeskScale} cellSize={GRID_SIZE} renderSeat={(seat) => {
            const desk = freeDeskById.get(seat.id);
            if (!desk) return null;
            if (!desk.isActive) return null;
            const status = getSeatStatus(desk);
            return (
              <button type="button" onClick={() => handleDeskClick(desk)}
                aria-label={`${desk.label || `${desk.number}번`} ${viewMode === "property" ? `${desk.ownerName || "국가"} 소유, 현재가 ${formatDisplayMoney(getDeskPrice(desk))} ${currencyUnit || ""}, ${status.label}` : desk.studentName || "미배정"} 상세 보기`}
                className="relative h-full w-full text-left">
                <ClassroomDeskVisual label={desk.label || `${desk.number}번`}
                  number={desk.number} studentName={desk.studentName} teamId={desk.teamId}
                  ownerName={desk.ownerName} ownerType={desk.ownerType || (desk.ownerId ? 'student' : 'state')} priceText={getDeskPriceText(desk)} status={status}
                  view={displayedViewMode} rotation={seat.rotation}
                  selected={isTradeModalOpen && selectedDesk?.id === desk.id} />
              </button>
            );
          }} />
        )}

        <p className="mt-2 text-xs text-slate-500">{fitWholeLayout ? '전체 배치입니다. 크게 보기로 이름과 가격을 읽을 수 있습니다.' : '교실 안을 가로·세로로 스크롤해 다른 자리를 볼 수 있습니다.'}</p>
      </section>

      {!financialReady && viewMode !== 'property' && (isTradeModalOpen || isBulkRentModalOpen || isPriceAdjustModalOpen) && (
        <div role="status" className="px-4 py-2 text-sm text-slate-600">부동산 정보를 불러오는 중입니다.</div>
      )}
      <section className="border-t border-slate-200 bg-white px-1 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold">
          <div className="flex items-center gap-1.5 text-slate-600">
            <MousePointer2 size={14} className="text-sky-500" />
            <span>책상을 누르면 가격과 소유·거래 정보를 볼 수 있습니다.</span>
          </div>
        </div>
      </section>

      <SeatTradeModal
        isOpen={isTradeModalOpen && financialReady}
        onClose={() => setIsTradeModalOpen(false)}
        desk={selectedDesk}
        classId={classId}
        acquisitionTaxRate={config.acquisitionTaxRate}
        capitalGainsTaxRate={config.capitalGainsTaxRate}
        saleTemplate={config.saleTemplate}
        saleSpecialTerms={config.saleSpecialTerms}
        rentLimitEnabled={config.rentLimitEnabled}
        rentLimitRate={config.rentLimitRate}
        officialPriceRatio={config.officialPriceRatio}
        systemEnabled={isSystemEnabled}
      />

      <PriceAdjustmentModal
        isOpen={isPriceAdjustModalOpen && financialReady}
        onClose={() => setIsPriceAdjustModalOpen(false)}
        groups={groups}
        classId={classId}
        officialPriceRatio={config.officialPriceRatio}
        data-tour="realestate-price-adjust-modal"
      />

      <BulkRentContractModal
        isOpen={isBulkRentModalOpen && financialReady}
        onClose={() => setIsBulkRentModalOpen(false)}
        groups={groups}
        placementData={placementData}
        classId={classId}
        systemEnabled={isSystemEnabled}
        data-tour="realestate-rent-contract-modal"
      />
    </div>
  );
};

export default ClassroomViewer;
