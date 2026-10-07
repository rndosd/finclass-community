import React, { useCallback, useMemo, useRef } from 'react';
import { Printer, School, X } from 'lucide-react';

import { Button, EmptyState, IconButton } from '../../../components/ui';
import Modal from '../../../components/ui/Modal';
import FreeSeatBoard from '../components/FreeSeatBoard';
import SeatDirection from '../components/SeatDirection';
import { normalizeAngle, resolveSeatPlacements } from '../utils/freeSeatPlacement';
import { useUser } from '../../../contexts/UserContext';

const iframePrintStyles = `
  @page {
    size: landscape;
    margin: 6mm;
  }

  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #0f172a;
  }

  body {
    font-family: Arial, "Noto Sans KR", sans-serif;
    padding: 0;
  }

  #realestate-teacher-print {
    width: 100%;
    height: 198mm;
  }

  .teacher-print-page {
    width: 100%;
    height: 198mm;
    max-width: none !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #ffffff !important;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: 8px;
  }

  .teacher-print-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e2e8f0;
  }

  .teacher-print-summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    width: min(236px, 100%);
    min-width: 0 !important;
  }

  .teacher-summary-card {
    padding: 8px 12px !important;
    border-radius: 16px !important;
  }

  .teacher-back-label {
    margin-bottom: 0 !important;
  }

  .teacher-seat-stage {
    min-height: 0;
    width: 100%;
  }

  .teacher-seat-stage-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .teacher-screen-scroll {
    width: 100%;
    height: 100%;
    overflow: visible !important;
    padding-bottom: 0 !important;
  }

  .teacher-preview-groups {
    display: grid !important;
    gap: 8px !important;
    height: 100% !important;
    width: 100% !important;
    min-width: 0 !important;
    align-items: stretch;
  }

  .teacher-seat-group {
    display: flex;
    flex-direction: column;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    padding: 10px !important;
    border-radius: 22px !important;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .teacher-group-label {
    margin-bottom: 8px !important;
  }

  .teacher-seat-group-grid {
    display: grid;
    flex: 1;
    height: 100%;
    grid-auto-rows: minmax(0, 1fr);
  }

  .teacher-seat-card {
    height: auto !important;
    min-height: 0 !important;
    padding: 6px 8px !important;
    box-shadow: none !important;
  }

  .teacher-seat-name {
    font-size: 15px !important;
    line-height: 1.1 !important;
    letter-spacing: -0.02em;
  }

  .teacher-free-seat-name {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 10px !important;
    line-height: 1.2 !important;
  }

  .teacher-position-row {
    margin-top: 0 !important;
  }

  .teacher-position-pill {
    padding: 8px 16px !important;
    font-size: 13px !important;
    border-radius: 18px !important;
  }
`;

const reverseGroupsForTeacherView = (groups = []) =>
  [...groups].reverse().map((group) => ({
    ...group,
    desks: [...(group.desks || [])].reverse(),
  }));

const summarizeGroups = (groups = []) =>
  groups.reduce(
    (acc, group) => {
      (group.desks || []).forEach((desk) => {
        if (!desk?.isActive) return;
        acc.activeSeatCount += 1;
        if (desk.studentId) acc.occupiedSeatCount += 1;
        else acc.vacantSeatCount += 1;
      });
      return acc;
    },
    {
      activeSeatCount: 0,
      occupiedSeatCount: 0,
      vacantSeatCount: 0,
    },
  );

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SeatPreviewCard = ({ desk }) => {
  if (desk?.isActive === false) {
    return (
      <div className="teacher-seat-card h-full min-h-[72px] rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 md:min-h-[78px]" />
    );
  }

  const isVacant = !desk?.studentId;
  const occupantName =
    typeof desk?.studentName === 'string' && desk.studentName.trim()
      ? desk.studentName
      : '빈 자리';

  return (
    <div
      className={`teacher-seat-card flex h-full min-h-[72px] flex-col justify-between rounded-2xl border px-3 py-3 md:min-h-[78px] ${
        isVacant
          ? 'border-slate-200 bg-white text-slate-400'
          : 'border-slate-300 bg-slate-900/[0.02] text-slate-800'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-[34px] justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-400">
          {desk?.label || `${desk?.number ?? '-'}번`}
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <span
          className={`teacher-seat-name text-center text-lg font-black leading-none md:text-xl ${
            isVacant ? 'text-slate-400' : 'text-slate-900'
          }`}
        >
          {occupantName}
        </span>
      </div>
    </div>
  );
};

const FreeSeatPreviewCard = ({ desk, rotation }) => {
  const isInactive = desk?.isActive === false;
  const name = desk?.studentName?.trim() || '빈자리';
  return (
    <div className={`flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border p-1.5 ${
      isInactive ? 'border-dashed border-slate-200 bg-slate-50 text-slate-400' :
        'border-slate-300 bg-white text-slate-800'
    }`}>
      <div className="flex h-6 items-start justify-between gap-0.5">
        <span className="shrink-0 max-w-full truncate text-[9px] font-black">{desk?.label || `${desk?.number ?? '-'}번`}</span>
        <SeatDirection rotation={rotation} />
      </div>
      <span className="teacher-free-seat-name mt-auto w-full min-w-0 truncate text-center text-[10px] font-bold" title={name}>
        {isInactive ? '미사용' : name}
      </span>
    </div>
  );
};

const TeacherReverseViewModal = ({ isOpen, onClose, groups = [], placementData }) => {
  const { classData } = useUser();
  const printRef = useRef(null);

  const reversedGroups = useMemo(
    () => reverseGroupsForTeacherView(groups),
    [groups],
  );
  const freeSeats = useMemo(() => {
    const seats = resolveSeatPlacements(groups, placementData);
    const maxX = Math.max(0, ...seats.map((seat) => seat.x));
    const maxY = Math.max(0, ...seats.map((seat) => seat.y));
    return seats.map((seat) => ({
      ...seat,
      x: maxX - seat.x,
      y: maxY - seat.y,
      rotation: normalizeAngle(seat.rotation + 180),
    }));
  }, [groups, placementData]);
  const freeDeskById = useMemo(() => new Map(groups.flatMap((group) => group.desks || []).map((desk) => [desk.id, desk])), [groups]);
  const summary = useMemo(() => summarizeGroups(groups), [groups]);
  const classNameLabel = useMemo(() => {
    const raw =
      typeof classData?.className === 'string' ? classData.className.trim() : '';
    return raw || '우리 반';
  }, [classData?.className]);
  const printedAtLabel = useMemo(
    () =>
      new Date().toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );

  const handlePrint = useCallback(() => {
    const printableNode = printRef.current;
    if (!printableNode) return;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'teacher-seating-chart-print');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';

    document.body.appendChild(iframe);

    const printWindow = iframe.contentWindow;
    const printDocument = printWindow?.document;
    if (!printWindow || !printDocument) {
      iframe.remove();
      return;
    }

    const sourceStyles = Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]'),
    )
      .map((node) => node.outerHTML)
      .join('\n');

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove();
      }, 0);
    };

    printDocument.open();
    printDocument.write(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`${classNameLabel} 교사용 좌석표`)}</title>
    ${sourceStyles}
    <style>${iframePrintStyles}</style>
  </head>
  <body>
    ${printableNode.outerHTML}
  </body>
</html>`);
    printDocument.close();

    printWindow.onafterprint = cleanup;

    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 350);

    window.setTimeout(cleanup, 60000);
  }, [classNameLabel]);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full" showDefaultCloseButton={false}>
      <div className="flex max-h-[92vh] flex-col bg-slate-100">
        <div className="no-print flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 md:px-7 md:py-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Teacher View
            </p>
            <h2 className="mt-1 text-lg font-black text-slate-900 md:text-xl">
              교사용 반전 좌석표
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              icon={Printer}
              tone="slate"
              rounded="xl"
              onClick={handlePrint}
            >
              인쇄하기
            </Button>
            <IconButton
              icon={X}
              label="닫기"
              onClick={onClose}
              size="lg"
              className="rounded-2xl border-slate-200 bg-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-6">
          <div
            id="realestate-teacher-print"
            ref={printRef}
            className="teacher-print-page mx-auto flex min-h-[720px] w-full max-w-[1480px] flex-col gap-3 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-8"
          >
            <div className="teacher-print-header flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[10px] font-black tracking-[0.08em] text-slate-400">
                  {printedAtLabel}
                </p>
                <h3 className="mt-1.5 text-xl font-black tracking-tight text-slate-900 md:text-2xl">
                  {classNameLabel} 교사용 좌석표
                </h3>
              </div>

              <div className="teacher-print-summary grid grid-cols-2 gap-2 md:min-w-[320px]">
                <div className="teacher-summary-card rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                    사용 좌석
                  </p>
                  <p className="mt-1 text-lg font-black text-slate-900">
                    {summary.activeSeatCount}개
                  </p>
                </div>
                <div className="teacher-summary-card rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-blue-500">
                    착석 학생
                  </p>
                  <p className="mt-1 text-lg font-black text-blue-700">
                    {summary.occupiedSeatCount}명
                  </p>
                </div>
              </div>
            </div>

            <div className="teacher-back-label flex justify-center">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black tracking-[0.18em] text-slate-500">
                교실 뒤쪽
              </div>
            </div>

            <div className="teacher-seat-stage min-h-0 flex-1">
              {reversedGroups.length === 0 ? (
              <EmptyState
                icon={School}
                title="아직 좌석 배치가 없습니다"
                description="좌석 배치가 저장되면 교사용 반전 보기에서 확인할 수 있습니다."
                className="teacher-seat-stage-empty h-full min-h-0 rounded-[1.8rem] border-slate-300 bg-slate-50 px-6"
              />
            ) : [1, 2].includes(placementData?.version) ? (
              <FreeSeatBoard seats={freeSeats} cellSize={36} renderSeat={(seat) => {
                const desk = freeDeskById.get(seat.id);
                return desk?.isActive === false ? null :
                  <FreeSeatPreviewCard desk={desk} rotation={seat.rotation} />;
              }} />
            ) : (
              <div className="teacher-screen-scroll h-full overflow-x-auto overflow-y-hidden pb-2">
                <div
                  className="teacher-preview-groups mx-auto grid h-full w-full items-stretch gap-4 md:gap-5"
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(
                      1,
                      reversedGroups.length,
                    )}, minmax(0, 1fr))`,
                  }}
                >
                  {reversedGroups.map((group) => (
                    <section
                      key={group.id}
                      className="teacher-seat-group min-w-0 h-full rounded-[1.8rem] border border-slate-200 bg-slate-50 p-3 md:p-4"
                      style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                    >
                      <div className="teacher-group-label mb-3 flex justify-center">
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-black text-slate-600">
                          {group.name || '분단'}
                        </span>
                      </div>

                      <div
                        className="teacher-seat-group-grid grid h-full flex-1 auto-rows-fr gap-2.5"
                        style={{
                          gridTemplateColumns: `repeat(${Math.max(
                            1,
                            Number(group.cols) || 1,
                          )}, minmax(0, 1fr))`,
                        }}
                      >
                        {(group.desks || []).map((desk) => (
                          <SeatPreviewCard key={desk.id} desk={desk} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
            </div>

            <div className="teacher-position-row flex justify-center">
              <div className="teacher-position-pill inline-flex items-center gap-2 rounded-[1.5rem] border-2 border-slate-300 bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-sm">
                <School size={18} className="text-sky-300" />
                교탁 / 교사 위치
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default TeacherReverseViewModal;
