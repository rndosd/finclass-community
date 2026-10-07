import React, { useEffect, useMemo, useState } from "react";
import { collectionGroup, getDocs, query, where } from "firebase/firestore";
import { DocumentTextIcon, PrinterIcon } from "@heroicons/react/24/outline";
import { Button, Modal } from "../../../../components/ui";
import { db } from "../../../../firebase";
import { formatBankMoney } from "../../../../utils/bankMoney";
import { calculateRepaymentDate } from "../../utils/dateUtils";

const ACTIVE_STATUSES = new Set(["pending", "ongoing", "active"]);

const asDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
  const date = asDate(value);
  return date
    ? date.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "날짜 확인 중";
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export default function LoanContractCenterModal({
  isOpen,
  onClose,
  classId,
  currencyUnit = "마로",
  classDisplayName = "우리 반",
}) {
  const [contracts, setContracts] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!isOpen || !classId) return undefined;

    let cancelled = false;
    setLoading(true);
    setError("");

    getDocs(query(collectionGroup(db, "loans"), where("classId", "==", classId)))
      .then((snapshot) => {
        if (cancelled) return;
        const nextContracts = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(
            (loan) =>
              ACTIVE_STATUSES.has(String(loan?.status || "")) &&
              Boolean(loan?.borrowerSignatureImg),
          )
          .sort(
            (a, b) =>
              (asDate(b.borrowerSignedAt || b.createdAt)?.getTime() || 0) -
              (asDate(a.borrowerSignedAt || a.createdAt)?.getTime() || 0),
          );
        setContracts(nextContracts);
        setSelectedIds(new Set(nextContracts.map((loan) => loan.id)));
      })
      .catch((loadError) => {
        console.error("[LoanContractCenterModal] load failed:", loadError);
        if (!cancelled) setError("대출 계약서를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [classId, isOpen]);

  const selectedContracts = useMemo(
    () => contracts.filter((contract) => selectedIds.has(contract.id)),
    [contracts, selectedIds],
  );

  const toggleContract = (id) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((previous) =>
      previous.size === contracts.length
        ? new Set()
        : new Set(contracts.map((contract) => contract.id)),
    );
  };

  const handlePrint = () => {
    if (selectedContracts.length === 0) return;
    setIsPrinting(true);

    const printWindow = window.open("", "_blank", "width=900,height=1100");
    if (!printWindow) {
      setIsPrinting(false);
      return;
    }

    const papers = selectedContracts
      .map((loan) => {
        const principal = `${formatBankMoney(loan.principal ?? loan.amount ?? 0)}${escapeHtml(currencyUnit)}`;
        const repayment = `${formatBankMoney((loan.principal ?? loan.amount ?? 0) + (loan.normalInterestAmount ?? 0))}${escapeHtml(currencyUnit)}`;
        const dueDate = formatDate(calculateRepaymentDate(loan));

        return `
          <article class="paper">
            <header><strong>${escapeHtml(classDisplayName)} 대출 계약서</strong><span>작성일 ${escapeHtml(formatDate(loan.borrowerSignedAt || loan.createdAt))}</span></header>
            <section><h2>계약 기본 정보</h2><dl><dt>대출 상품</dt><dd>${escapeHtml(loan.productLabel || "대출 상품")}</dd><dt>대출자</dt><dd>${escapeHtml(loan.studentName || "학생")}</dd><dt>대출 기간</dt><dd>${escapeHtml(String(loan.days || 0))}일</dd><dt>상환일</dt><dd>${escapeHtml(dueDate)}</dd></dl></section>
            <section><h2>대출 조건</h2><dl><dt>대출 원금</dt><dd>${principal}</dd><dt>정상 상환액</dt><dd>${repayment}</dd><dt>적용 이율</dt><dd>${escapeHtml(Number(loan.finalRateApplied || 0).toFixed(2))}%</dd><dt>연체료</dt><dd>하루 원금의 ${escapeHtml(String(loan.overdueRate ?? 0.5))}%</dd></dl></section>
            <section><h2>계약 내용</h2><ol><li>대출자는 학급 활동에 필요한 금액을 상품 조건에 따라 빌립니다.</li><li>대출 원금과 기간은 위 계약 기본 정보와 대출 조건을 기준으로 합니다.</li><li>적용 이율과 신용 등급은 신청 시점의 상품 및 학급 규칙을 기준으로 합니다.</li><li>대출자는 정해진 상환일까지 원금과 약정 이자를 정상 상환합니다.</li><li>상환일 이후에는 원금의 하루 ${escapeHtml(String(loan.overdueRate ?? 0.5))}% 연체료가 추가됩니다.</li><li>대출 신청, 승인, 상환과 정산은 학급 은행 규칙에 따라 진행합니다.</li><li>대출자는 위 계약 조건을 확인하고 본인 서명으로 동의합니다.</li></ol></section>
            <section class="signature"><h2>대출자 확인 및 서명</h2><p>위 대출 조건과 상환 내용을 확인했습니다.</p>${loan.borrowerSignatureImg ? `<img src="${escapeHtml(loan.borrowerSignatureImg)}" alt="대출자 서명" />` : ""}<b>${escapeHtml(loan.studentName || "학생")} 서명</b></section>
          </article>`;
      })
      .join("");

    const printHtml = `<!doctype html><html lang="ko"><head><title>대출 계약서</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,'Malgun Gothic',sans-serif;color:#172033}.paper{min-height:273mm;border:1px solid #fda4af;padding:12mm;page-break-after:always}header{display:flex;justify-content:space-between;align-items:end;border-top:4px solid #e11d48;border-bottom:2px solid #e11d48;padding:10px 0;color:#9f1239}header strong{font-size:24px}header span{font-size:12px;font-weight:bold}section{margin-top:14px}h2{margin:0 0 7px;color:#be123c;font-size:14px}dl{display:grid;grid-template-columns:110px 1fr;border-top:1px solid #fecdd3;margin:0}dt,dd{margin:0;padding:8px;border-bottom:1px solid #fecdd3}dt{font-weight:bold;background:#fff1f2}dd{font-weight:bold}ol{margin:0;padding:11px 28px;border:1px solid #fecdd3;line-height:1.65}.signature{min-height:38mm;border:1px solid #fecdd3;padding:10px;position:relative}.signature img{position:absolute;right:18px;bottom:20px;max-width:140px;max-height:55px;object-fit:contain}.signature b{position:absolute;right:18px;bottom:8px;min-width:96px;padding-top:4px;border-top:1px solid #fda4af;text-align:right;color:#475569}@media print{.paper:last-child{page-break-after:auto}}</style></head><body>${papers}</body></html>`;
    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();

    let hasStartedPrinting = false;
    const finishPrinting = () => {
      setIsPrinting(false);
      window.removeEventListener("focus", finishPrinting);
      printWindow.removeEventListener("afterprint", finishPrinting);
      printWindow.removeEventListener("pagehide", finishPrinting);
    };
    printWindow.addEventListener("afterprint", finishPrinting, { once: true });
    printWindow.addEventListener("pagehide", finishPrinting, { once: true });
    window.addEventListener("focus", finishPrinting, { once: true });
    const triggerPrint = () => {
      if (hasStartedPrinting) return;
      hasStartedPrinting = true;
      if (printWindow.closed) {
        finishPrinting();
        return;
      }
      finishPrinting();
      window.setTimeout(() => {
        if (printWindow.closed) return;
        printWindow.focus();
        printWindow.print();
      }, 0);
    };
    const waitForImages = () => {
      const images = Array.from(printWindow.document.images || []);
      return Promise.all(
        images.map((image) => {
          if (image.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const finish = () => {
              image.removeEventListener("load", finish);
              image.removeEventListener("error", finish);
              resolve();
            };
            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
            window.setTimeout(finish, 1000);
          });
        }),
      );
    };
    const fallbackTimer = window.setTimeout(triggerPrint, 1200);
    waitForImages().then(() => {
      window.clearTimeout(fallbackTimer);
      window.requestAnimationFrame(() => window.setTimeout(triggerPrint, 80));
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title="대출 계약서함">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-500">
            서명된 진행 중 대출 계약서를 모아 인쇄합니다.
          </p>
          <Button
            type="button"
            icon={PrinterIcon}
            tone="red"
            disabled={selectedContracts.length === 0 || isPrinting}
            onClick={handlePrint}
          >
            {isPrinting ? "인쇄 준비 중..." : `선택 계약서 인쇄 (${selectedContracts.length})`}
          </Button>
        </div>

        {loading ? <p className="py-12 text-center text-sm font-bold text-slate-400">계약서를 불러오는 중입니다.</p> : null}
        {error ? <p className="rounded-xl bg-rose-50 p-4 text-sm font-bold text-rose-600">{error}</p> : null}
        {!loading && !error && contracts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-14 text-center"><DocumentTextIcon className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-500">서명된 진행 중 대출 계약서가 없습니다.</p></div> : null}
        {contracts.length > 0 ? <div className="space-y-2"><label className="flex cursor-pointer items-center gap-2 px-1 text-xs font-bold text-slate-500"><input type="checkbox" checked={selectedIds.size === contracts.length} onChange={toggleAll} /> 전체 선택</label>{contracts.map((loan) => <label key={loan.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 p-4 transition hover:border-rose-200 hover:bg-rose-50/40"><input type="checkbox" checked={selectedIds.has(loan.id)} onChange={() => toggleContract(loan.id)} /><div className="min-w-0 flex-1"><p className="font-black text-slate-900">{loan.studentName || "학생"} · {loan.productLabel || "대출 상품"}</p><p className="mt-1 text-xs font-semibold text-slate-500">{formatBankMoney(loan.principal ?? loan.amount ?? 0)}{currencyUnit} · {formatDate(loan.borrowerSignedAt || loan.createdAt)} 서명</p></div><span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600">서명 완료</span></label>)}</div> : null}
      </div>
    </Modal>
  );
}
