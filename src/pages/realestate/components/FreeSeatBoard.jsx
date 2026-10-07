import React, { useLayoutEffect, useRef, useState } from 'react';
import { GRID_SIZE, SEAT_SIZE, getPlacementCanvasSize } from '../utils/freeSeatPlacement';

const FreeSeatBoard = ({ seats, renderSeat, guides = [], selectionBox = null,
  onBlankPointerDown, onBlankPointerMove, onBlankPointerUp,
  cellSize = GRID_SIZE, seatSize = SEAT_SIZE, grid = false, classroomScene = false,
  fitViewport = false, frontLabel = null, fitBoundsSeats = seats, deskDisplayScale = 100,
  minFitScale = 0, fitFromBoardTop = false, minSeatDisplayWidth = 0, readableDesks = false,
  scrollForReadability = false, viewZoom = 1, fitWholeLayout = false }) => {
  const dimensions = getPlacementCanvasSize(seats);
  const scale = cellSize / GRID_SIZE;
  const boardRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const baseSeatSize = seatSize * scale;
  const scaledSeatSize = baseSeatSize * deskDisplayScale / 100;
  const seatOffset = (baseSeatSize - scaledSeatSize) / 2;
  // Editor fitting keeps its margin independent of the saved desk size.
  // Viewing adds enough room around enlarged or rotated edge desks to scroll.
  const fitPadding = scrollForReadability
    ? Math.max(baseSeatSize * 0.4, scaledSeatSize * 0.82 - baseSeatSize / 2)
    : baseSeatSize * 0.4;
  const originX = fitViewport && fitBoundsSeats.length > 0
    ? Math.min(...fitBoundsSeats.map((seat) => seat.x * cellSize)) - fitPadding : 0;
  const originY = fitViewport && fitBoundsSeats.length > 0
    ? Math.min(...fitBoundsSeats.map((seat) => seat.y * cellSize)) - fitPadding : 0;
  const canvasWidth = fitViewport && fitBoundsSeats.length > 0
    ? Math.max(...fitBoundsSeats.map((seat) => seat.x * cellSize + baseSeatSize)) - originX + fitPadding
    : dimensions.width * scale;
  const canvasHeight = fitViewport && fitBoundsSeats.length > 0
    ? Math.max(...fitBoundsSeats.map((seat) => seat.y * cellSize + baseSeatSize)) - originY + fitPadding
    : dimensions.height * scale;
  const view = { fitScale, originX, originY };

  useLayoutEffect(() => {
    if (!fitViewport || typeof window === 'undefined') return undefined;
    const board = boardRef.current;
    if (!board) return undefined;

    let scrollParent = board.parentElement;
    while (scrollParent) {
      const overflowY = window.getComputedStyle(scrollParent).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && scrollParent.clientHeight > 0) break;
      scrollParent = scrollParent.parentElement;
    }
    const updateFit = () => {
      if (window.innerWidth < 768 && !scrollForReadability) {
        setFitScale(1);
        return;
      }
      const workspace = board.closest('[data-classroom-fit-root]');
      const sharedBoardOffset = workspace && !fitFromBoardTop
        ? Number.parseFloat(window.getComputedStyle(workspace).getPropertyValue('--classroom-controls-height')) + 8
        : NaN;
      const boardTop = (workspace && Number.isFinite(sharedBoardOffset)
        ? workspace.getBoundingClientRect().top + sharedBoardOffset
        : board.getBoundingClientRect().top) + (scrollParent ? scrollParent.scrollTop : window.scrollY);
      const viewportBottom = Math.min(scrollParent?.getBoundingClientRect().bottom || window.innerHeight,
        window.innerHeight, window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight);
      const availableWidth = Math.max(1, board.clientWidth - 20);
      const availableHeight = Math.max(1, viewportBottom - boardTop - 28
        - (frontLabel ? 38 : 0));
      // Readable previews may scroll vertically instead of shrinking names indefinitely.
      const minimumDeskWidth = readableDesks
        ? Math.max(minSeatDisplayWidth, window.innerWidth >= 1440 ? 88 : 64)
        : minSeatDisplayWidth;
      const readableScale = Math.max(minFitScale, minimumDeskWidth / scaledSeatSize);
      const fittedScale = Math.min(1.5, availableWidth / canvasWidth,
        Math.max(readableScale, availableHeight / canvasHeight));
      // Viewing can scroll in both directions to keep desks readable. Editor
      // fitting retains its existing width constraint and placement geometry.
      const nextScale = scrollForReadability
        ? (fitWholeLayout
          ? Math.min(1.5, availableWidth / canvasWidth, availableHeight / canvasHeight)
          : Math.max(readableScale, fittedScale) * viewZoom)
        : fittedScale;
      setFitScale((current) => Math.abs(current - nextScale) < 0.001 ? current : nextScale);
    };

    updateFit();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateFit);
    resizeObserver?.observe(board);
    resizeObserver?.observe(document.documentElement);
    if (scrollParent) resizeObserver?.observe(scrollParent);
    window.addEventListener('resize', updateFit);
    window.visualViewport?.addEventListener('resize', updateFit);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateFit);
      window.visualViewport?.removeEventListener('resize', updateFit);
    };
  }, [fitViewport, canvasWidth, canvasHeight, frontLabel, renderSeat, minFitScale,
    fitFromBoardTop, minSeatDisplayWidth, scaledSeatSize, readableDesks,
    scrollForReadability, viewZoom, fitWholeLayout]);

  const isFitted = fitViewport && Math.abs(fitScale - 1) > 0.001;
  return (
    <div ref={boardRef} className={`w-full rounded-xl border border-slate-200 bg-slate-50 ${scrollForReadability || !isFitted ? 'overflow-auto' : 'overflow-hidden'} ${classroomScene ? 'classroom-scene' : ''} ${scrollForReadability ? 'classroom-scene--readable focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600' : ''}`} role="region" aria-label="교실 자리 배치" tabIndex={scrollForReadability ? 0 : undefined}>
      {frontLabel && <div className="classroom-scene__front">{frontLabel}</div>}
      <div className="relative mx-auto" style={{ width: canvasWidth * fitScale, height: canvasHeight * fitScale }}>
        <div
        className={`relative mx-auto ${classroomScene ? 'classroom-scene__canvas' : ''}`}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onBlankPointerDown?.(event, view);
        }}
        onPointerMove={(event) => onBlankPointerMove?.(event, view)}
        onPointerUp={(event) => onBlankPointerUp?.(event, view)}
        onPointerCancel={(event) => onBlankPointerUp?.(event, view)}
        style={{
          width: canvasWidth,
          height: canvasHeight,
          transform: isFitted ? `scale(${fitScale})` : undefined,
          transformOrigin: 'top left',
          '--desk-type-boost': (fitViewport && fitScale < 1 ? 1 / Math.pow(fitScale, 0.75) : 1) * deskDisplayScale / 100,
          '--desk-display-scale': deskDisplayScale / 100,
          '--desk-view-type-scale': scaledSeatSize / 128,
          backgroundImage: grid
            ? 'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)'
            : undefined,
          backgroundSize: grid ? `${cellSize}px ${cellSize}px` : undefined,
        }}
      >
        {selectionBox && <div className="pointer-events-none absolute z-20 border border-blue-500 bg-blue-100/30"
          style={{ left: selectionBox.left, top: selectionBox.top,
            width: selectionBox.width, height: selectionBox.height }} />}
        {guides.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 z-10" width={canvasWidth} height={canvasHeight} aria-hidden="true">
            {guides.map((guide) => {
              const members = seats.filter((seat) => guide.ids.includes(seat.id));
              const points = members.map((seat) => ({ x: (seat.x + 1) * cellSize - originX,
                y: (seat.y + 1) * cellSize - originY }));
              if (points.length < 2) return null;
              const xs = points.map((point) => point.x);
              const ys = points.map((point) => point.y);
              return <g key={guide.axis}>
                <line x1={Math.min(...xs)} y1={Math.min(...ys)} x2={Math.max(...xs)} y2={Math.max(...ys)} stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" />
                {points.map((point, index) => <circle key={members[index].id} cx={point.x} cy={point.y} r="5" fill="#fff" stroke="#2563eb" strokeWidth="2" />)}
              </g>;
            })}
          </svg>
        )}
        {seats.map((seat) => {
          const content = renderSeat(seat, view);
          if (content == null) return null;
          return <div
            key={seat.id}
            className="absolute"
            style={{ left: seat.x * cellSize + seatOffset - originX, top: seat.y * cellSize + seatOffset - originY,
              width: scaledSeatSize, height: scaledSeatSize }}
          >
            {content}
          </div>;
        })}
        </div>
      </div>
    </div>
  );
};

export default FreeSeatBoard;
