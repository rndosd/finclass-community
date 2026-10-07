import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Coins, RotateCcw, Sparkles } from 'lucide-react';
import { useUser } from '../../../contexts/UserContext';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { Button, EmptyState } from '../../../components/ui';
import { toViewerLayoutGroups } from '../utils/deskSummary';

const GRID_COLS = 10;
const GRID_ROWS = 8;
const TILE_W = 64;
const TILE_H = 32;
const ISO_PADDING_X = 4;
const ISO_PADDING_Y = 4;
const ISO_BOARD_COLS = GRID_COLS + ISO_PADDING_X * 2;
const ISO_BOARD_ROWS = GRID_ROWS + ISO_PADDING_Y * 2;
const ISO_BACKDROP_EXTRA = 14;
const BOARD_WIDTH = ((ISO_BOARD_COLS + ISO_BOARD_ROWS) * TILE_W) / 2 + TILE_W;
const BOARD_HEIGHT = ((ISO_BOARD_COLS + ISO_BOARD_ROWS) * TILE_H) / 2 + TILE_H;
const DEFAULT_STRUCTURE = {
  id: 'default-structure',
  itemId: '__default_building__',
  x: 4,
  y: 3,
  w: 2,
  h: 2,
  fixed: true,
};

const DECOR_CATALOG = [
  { id: 'plant', name: '화분', price: 35, w: 1, h: 1, emoji: '🪴', tone: 'from-emerald-200 to-emerald-100' },
  { id: 'table', name: '테이블', price: 90, w: 2, h: 2, emoji: '🪑', tone: 'from-amber-200 to-amber-100' },
  { id: 'lamp', name: '스탠드', price: 55, w: 1, h: 2, emoji: '💡', tone: 'from-yellow-200 to-amber-100' },
  { id: 'shelf', name: '선반', price: 140, w: 3, h: 1, emoji: '🗄️', tone: 'from-slate-200 to-slate-100' },
  { id: 'poster', name: '포스터', price: 50, w: 2, h: 1, emoji: '🖼️', tone: 'from-sky-200 to-sky-100' },
];

const getDeskLabel = (desk) =>
  String(desk?.label || `${desk?.number ?? '-'}번 자리`).trim();

const getWeeklyRent = (desk) => Number(desk?.weeklyRent || desk?.rentPrice || 0);

const overlaps = (a, b) =>
  a.x < b.x + b.w &&
  a.x + a.w > b.x &&
  a.y < b.y + b.h &&
  a.y + a.h > b.y;

const tileToScreen = (boardX, boardY) => ({
  left: ((boardX - boardY + ISO_BOARD_ROWS) * TILE_W) / 2,
  top: ((boardX + boardY) * TILE_H) / 2,
});

const logicalToBoard = (x, y) => ({
  boardX: x + ISO_PADDING_X,
  boardY: y + ISO_PADDING_Y,
});

const boardToLogical = (boardX, boardY) => ({
  x: boardX - ISO_PADDING_X,
  y: boardY - ISO_PADDING_Y,
});

const isPlacementArea = (x, y) => (
  x >= 0 &&
  y >= 0 &&
  x < GRID_COLS &&
  y < GRID_ROWS
);

const getBoardPositionFromLogical = (x, y) => {
  const { boardX, boardY } = logicalToBoard(x, y);
  return tileToScreen(boardX, boardY);
};

const getPlacementCells = (placement) => {
  const cells = [];
  for (let dx = 0; dx < placement.w; dx += 1) {
    for (let dy = 0; dy < placement.h; dy += 1) {
      cells.push({ x: placement.x + dx, y: placement.y + dy });
    }
  }
  return cells;
};

const MyRealEstateTab = ({ layoutData, userData }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { currencyUnit } = useUser();
  const { showFeedback } = useFeedback();
  const unit = currencyUnit || '';
  const currentUserUid = String(userData?.uid || '').trim();

  const ownedDesks = useMemo(() => {
    const groups = toViewerLayoutGroups(layoutData?.groups);
    const allDesks = groups.flatMap((group) => group?.desks || []);

    if (!currentUserUid) return [];

    return allDesks
      .filter((desk) => desk?.isActive !== false && String(desk?.ownerId || '').trim() === currentUserUid)
      .map((desk) => ({
        id: desk.id,
        label: getDeskLabel(desk),
        tenantName: desk?.studentId ? desk?.studentName || '이름 없음' : '공실',
        marketPrice: Number(desk?.lastPurchasePrice || desk?.price || 0),
        weeklyRent: getWeeklyRent(desk),
      }));
  }, [layoutData?.groups, currentUserUid]);

  const [selectedDeskId, setSelectedDeskId] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(DECOR_CATALOG[0].id);
  const [placementsByDesk, setPlacementsByDesk] = useState({});
  const [budget, setBudget] = useState(Number(userData?.assets?.cash || 0));
  const [inventory, setInventory] = useState(
    () => Object.fromEntries(DECOR_CATALOG.map((item) => [item.id, 0])),
  );

  useEffect(() => {
    if (!ownedDesks.length) {
      setSelectedDeskId(null);
      return;
    }
    setSelectedDeskId((prev) => (prev && ownedDesks.some((desk) => desk.id === prev) ? prev : ownedDesks[0].id));
  }, [ownedDesks]);

  const selectedDesk = useMemo(
    () => ownedDesks.find((desk) => desk.id === selectedDeskId) || null,
    [ownedDesks, selectedDeskId],
  );

  const selectedItem = useMemo(
    () => DECOR_CATALOG.find((item) => item.id === selectedItemId) || DECOR_CATALOG[0],
    [selectedItemId],
  );

  const placedItems = placementsByDesk[selectedDeskId] || [];
  const defaultStructurePlacement = selectedDeskId
    ? { ...DEFAULT_STRUCTURE, id: `${DEFAULT_STRUCTURE.id}-${selectedDeskId}` }
    : null;
  const visiblePlacements = defaultStructurePlacement
    ? [defaultStructurePlacement, ...placedItems]
    : placedItems;
  const backdropTiles = useMemo(() => {
    const tiles = [];
    for (let boardY = -ISO_BACKDROP_EXTRA; boardY < ISO_BOARD_ROWS + ISO_BACKDROP_EXTRA; boardY += 1) {
      for (let boardX = -ISO_BACKDROP_EXTRA; boardX < ISO_BOARD_COLS + ISO_BACKDROP_EXTRA; boardX += 1) {
        const pos = tileToScreen(boardX, boardY);
        if (
          pos.left < -TILE_W ||
          pos.left > BOARD_WIDTH + TILE_W ||
          pos.top < -TILE_H ||
          pos.top > BOARD_HEIGHT + TILE_H
        ) {
          continue;
        }
        tiles.push({ boardX, boardY, left: pos.left, top: pos.top });
      }
    }
    return tiles;
  }, []);

  const usedCountByItem = useMemo(() => {
    const counts = Object.fromEntries(DECOR_CATALOG.map((item) => [item.id, 0]));
    Object.values(placementsByDesk).forEach((deskPlacements) => {
      (deskPlacements || []).forEach((placement) => {
        counts[placement.itemId] = (counts[placement.itemId] || 0) + 1;
      });
    });
    return counts;
  }, [placementsByDesk]);

  const canPlaceAt = (x, y, item, ignorePlacementId = null) => {
    if (!item) return false;
    if (x < 0 || y < 0) return false;
    if (x + item.w > GRID_COLS || y + item.h > GRID_ROWS) return false;

    return !visiblePlacements.some((placement) => {
      if (ignorePlacementId && placement.id === ignorePlacementId) return false;
      return overlaps({ x, y, w: item.w, h: item.h }, placement);
    });
  };

  const handleBuy = (item) => {
    if (!item) return;
    if (budget < item.price) {
      showFeedback('잔액이 부족합니다.', 'warning');
      return;
    }
    setBudget((prev) => prev - item.price);
    setInventory((prev) => ({
      ...prev,
      [item.id]: (prev[item.id] || 0) + 1,
    }));
    showFeedback(`${item.name} 구매 완료`, 'success');
  };

  const handleCellClick = (x, y) => {
    if (!selectedDeskId) return;
    if (!selectedItem) return;

    const availableCount = (inventory[selectedItem.id] || 0) - (usedCountByItem[selectedItem.id] || 0);
    if (availableCount <= 0) {
      showFeedback('먼저 아이템을 구매해 주세요.', 'warning');
      return;
    }

    if (!canPlaceAt(x, y, selectedItem)) {
      showFeedback('해당 위치에는 배치할 수 없습니다.', 'warning');
      return;
    }

    const nextPlacement = {
      id: `${selectedItem.id}-${Date.now()}`,
      itemId: selectedItem.id,
      x,
      y,
      w: selectedItem.w,
      h: selectedItem.h,
    };

    setPlacementsByDesk((prev) => ({
      ...prev,
      [selectedDeskId]: [...(prev[selectedDeskId] || []), nextPlacement],
    }));
  };

  const handleRemovePlacement = (placementId) => {
    if (!selectedDeskId) return;
    setPlacementsByDesk((prev) => ({
      ...prev,
      [selectedDeskId]: (prev[selectedDeskId] || []).filter((placement) => placement.id !== placementId),
    }));
  };

  const clearSelectedDesk = () => {
    if (!selectedDeskId) return;
    setPlacementsByDesk((prev) => ({
      ...prev,
      [selectedDeskId]: [],
    }));
  };

  if (!ownedDesks.length) {
    return (
      <EmptyState
        icon={Building2}
        title="현재 보유한 부동산이 없습니다"
        description="부동산을 보유하게 되면 이곳에서 자리 현황과 꾸미기를 관리할 수 있습니다."
        className="rounded-3xl border-slate-200 bg-white px-6 py-14 shadow-sm"
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {ownedDesks.map((desk) => {
            const active = desk.id === selectedDeskId;
            return (
              <Button
                size="sm"
                tone="blue"
                kind={active ? "soft" : "outline"}
                rounded="xl"
                key={desk.id}
                onClick={() => setSelectedDeskId(desk.id)}
              >
                {desk.label}
              </Button>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles size={16} className="text-indigo-500" />
                {selectedDesk?.label} 꾸미기
              </p>
              <p className="text-[11px] font-semibold text-slate-500 mt-1">
                입주자 {selectedDesk?.tenantName} | 시세 {formatDisplayMoney(selectedDesk?.marketPrice)} {unit}
                {' '}| 주 임대료 {formatDisplayMoney(selectedDesk?.weeklyRent)} {unit}
              </p>
            </div>

            <Button
              icon={RotateCcw}
              size="sm"
              tone="slate"
              kind="outline"
              onClick={clearSelectedDesk}
            >
              배치 초기화
            </Button>
          </div>

          <div className="relative rounded-[24px] border border-slate-200 bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 p-3 overflow-auto">
            <div className="absolute inset-0 opacity-40 pointer-events-none">
              <div className="absolute inset-0 [background:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.8),transparent_55%)]" />
            </div>

            <div className="relative rounded-2xl border border-white/70 bg-white/35 p-4 md:p-6">
              <div className="relative mx-auto" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}>
                <div
                  className="absolute left-1/2 top-3 -translate-x-1/2 rounded-[20px] border border-sky-200/70 bg-sky-100/45"
                  style={{
                    width: BOARD_WIDTH - TILE_W,
                    height: BOARD_HEIGHT - TILE_H,
                    transform: 'translateX(-50%) rotate(45deg) scaleY(0.58)',
                    transformOrigin: 'center top',
                  }}
                />

                {backdropTiles.map((tile) => (
                  <span
                    key={`iso-backdrop-${tile.boardX}-${tile.boardY}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                    style={{
                      left: tile.left,
                      top: tile.top,
                      width: TILE_W,
                      height: TILE_H,
                      zIndex: 4,
                      clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                      background: ((tile.boardX + tile.boardY) % 2 === 0)
                        ? 'linear-gradient(145deg, rgba(241,245,249,0.96), rgba(226,232,240,0.82))'
                        : 'linear-gradient(145deg, rgba(226,232,240,0.96), rgba(203,213,225,0.82))',
                      border: '1px solid rgba(148,163,184,0.25)',
                    }}
                  />
                ))}

                {Array.from({ length: ISO_BOARD_ROWS }, (_, boardY) =>
                  Array.from({ length: ISO_BOARD_COLS }, (_, boardX) => {
                    const pos = tileToScreen(boardX, boardY);
                    const { x, y } = boardToLogical(boardX, boardY);
                    const isActiveCell = isPlacementArea(x, y);
                    return (
                      <Button
                        key={`iso-cell-${boardX}-${boardY}`}
                        onClick={() => isActiveCell && handleCellClick(x, y)}
                        className="absolute -translate-x-1/2 -translate-y-1/2 transition-colors"
                        style={{
                          left: pos.left,
                          top: pos.top,
                          width: TILE_W,
                          height: TILE_H,
                          zIndex: boardX + boardY + 10,
                          clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                          background: isActiveCell
                            ? ((x + y) % 2 === 0
                              ? 'linear-gradient(145deg, rgba(239,246,255,0.96), rgba(219,234,254,0.86))'
                              : 'linear-gradient(145deg, rgba(224,242,254,0.96), rgba(191,219,254,0.86))')
                            : ((boardX + boardY) % 2 === 0
                              ? 'linear-gradient(145deg, rgba(241,245,249,0.9), rgba(226,232,240,0.76))'
                              : 'linear-gradient(145deg, rgba(226,232,240,0.9), rgba(203,213,225,0.76))'),
                          border: isActiveCell
                            ? '1px solid rgba(59,130,246,0.35)'
                            : '1px solid rgba(148,163,184,0.28)',
                          boxShadow: '0 1px 0 rgba(255,255,255,0.55) inset',
                          cursor: isActiveCell ? 'pointer' : 'default',
                          filter: isActiveCell ? 'none' : 'saturate(0.75)',
                        }}
                        title={isActiveCell ? `${x + 1}, ${y + 1}` : undefined}
                        disabled={!isActiveCell}
                      />
                    );
                  }),
                )}

                {visiblePlacements.map((placement) =>
                  getPlacementCells(placement).map((cell) => {
                    const pos = getBoardPositionFromLogical(cell.x, cell.y);
                    const isDefaultStructure = placement.itemId === DEFAULT_STRUCTURE.itemId;
                    return (
                      <span
                        key={`${placement.id}-${cell.x}-${cell.y}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                          left: pos.left,
                          top: pos.top,
                          width: TILE_W,
                          height: TILE_H,
                          zIndex: 200 + cell.x + cell.y,
                          clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                          background: isDefaultStructure
                            ? 'linear-gradient(145deg, rgba(148,163,184,0.45), rgba(203,213,225,0.30))'
                            : 'linear-gradient(145deg, rgba(129,140,248,0.40), rgba(165,180,252,0.24))',
                          border: isDefaultStructure
                            ? '1px solid rgba(71,85,105,0.35)'
                            : '1px solid rgba(99,102,241,0.38)',
                        }}
                      />
                    );
                  }),
                )}

                {visiblePlacements.map((placement) => {
                  const isDefaultStructure = placement.itemId === DEFAULT_STRUCTURE.itemId;
                  if (isDefaultStructure) {
                    const centerX = placement.x + (placement.w - 1) / 2;
                    const centerY = placement.y + (placement.h - 1) / 2;
                    const pos = getBoardPositionFromLogical(centerX, centerY);
                    const badgeWidth = 88;
                    const badgeHeight = 58;

                    return (
                      <div
                        key={placement.id}
                        className="absolute -translate-x-1/2 -translate-y-full pointer-events-none"
                        style={{
                          left: pos.left,
                          top: pos.top - 8,
                          width: badgeWidth,
                          height: badgeHeight,
                          zIndex: 500 + Math.floor(centerY),
                        }}
                        title="기본 건물"
                      >
                        <span className="absolute left-1/2 top-full -translate-x-1/2 mt-1 w-[62%] h-2.5 rounded-full bg-slate-700/35 blur-[1px]" />
                        <span className="absolute inset-0 rounded-2xl border border-slate-300/80 bg-gradient-to-b from-slate-100 to-slate-200 shadow-[0_16px_26px_-14px_rgba(15,23,42,0.95)]" />
                        <span className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xl leading-none">🏢</span>
                          <span className="text-[9px] font-black text-slate-700 mt-1 tracking-wide">기본 건물</span>
                        </span>
                      </div>
                    );
                  }

                  const item = DECOR_CATALOG.find((catalogItem) => catalogItem.id === placement.itemId);
                  if (!item) return null;

                  const centerX = placement.x + (placement.w - 1) / 2;
                  const centerY = placement.y + (placement.h - 1) / 2;
                  const pos = getBoardPositionFromLogical(centerX, centerY);
                  const sizeScale = Math.max(placement.w, placement.h);
                  const badgeWidth = 52 + sizeScale * 8;
                  const badgeHeight = 36 + sizeScale * 6;

                  return (
                    <Button
                      key={placement.id}
                      onClick={() => handleRemovePlacement(placement.id)}
                      className="absolute group -translate-x-1/2 -translate-y-full"
                      style={{
                        left: pos.left,
                        top: pos.top - 6,
                        width: badgeWidth,
                        height: badgeHeight,
                        zIndex: 400 + Math.floor(centerY),
                      }}
                      title={`${item.name} 제거`}
                    >
                      <span className="absolute left-1/2 top-full -translate-x-1/2 mt-1 w-[60%] h-2 rounded-full bg-slate-500/35 blur-[1px]" />
                      <span
                        className={`absolute inset-0 rounded-xl border border-slate-300/60 bg-gradient-to-b ${item.tone} shadow-[0_14px_22px_-14px_rgba(15,23,42,0.95)]`}
                      />
                      <span className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg leading-none">{item.emoji}</span>
                        <span className="text-[9px] font-black text-slate-700 mt-1 opacity-90">{item.name}</span>
                      </span>
                      <span className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-black">
                        -
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm h-fit">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-black text-slate-800 flex items-center gap-1.5">
              <Building2 size={16} className="text-indigo-500" />
              꾸미기 상점
            </p>
            <p className="text-[11px] font-black text-emerald-600 inline-flex items-center gap-1">
              <Coins size={13} />
              {formatDisplayMoney(budget)} {unit}
            </p>
          </div>

          <div className="space-y-2.5">
            {DECOR_CATALOG.map((item) => {
              const used = usedCountByItem[item.id] || 0;
              const own = inventory[item.id] || 0;
              const available = own - used;
              const selected = selectedItemId === item.id;

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-2.5 transition-colors ${selected ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-white'}`}
                >
                  <Button
                    kind="ghost"
                    tone="slate"
                    fullWidth
                    onClick={() => setSelectedItemId(item.id)}
                    className="justify-between text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800">{item.emoji} {item.name}</p>
                      <p className="text-[10px] font-semibold text-slate-500 mt-0.5">
                        {item.w}x{item.h} | 보유 {own} | 배치 가능 {Math.max(available, 0)}
                      </p>
                    </div>
                    <span className="text-[10px] font-black text-indigo-600">
                      {formatDisplayMoney(item.price)} {unit}
                    </span>
                  </Button>

                  <Button
                    size="xs"
                    tone="blue"
                    fullWidth
                    onClick={() => handleBuy(item)}
                    className="mt-2"
                  >
                    구매
                  </Button>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[10px] font-semibold text-slate-400 leading-relaxed">
            프로토타입: 현재는 탭 내부 임시 상태로 동작합니다. (구매/배치 저장은 다음 단계에서 백엔드 연동)
          </p>
        </aside>
      </section>
    </div>
  );
};

export default MyRealEstateTab;
