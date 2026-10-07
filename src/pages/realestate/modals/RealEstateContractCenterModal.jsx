import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import { FileText, Printer } from "lucide-react";
import { Button, Modal } from "../../../components/ui";
import { sanitizeRichHtml } from "../../../utils/sanitizeRichHtml";
import {
  renderRealEstateContractTemplate,
  resolveSaleContractTemplate,
} from "../utils/contractTemplate";

const getDeskLabel = (desk, index) => {
  const label = String(desk?.label || "").trim();
  if (label && !/^g\d+/i.test(label)) return label;

  const number = String(desk?.number || "").trim();
  return number ? `${number}번 자리` : `${index + 1}번 자리`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");



const formatDate = (value) => {
  if (!value) return "계약 진행 중";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "계약 진행 중";
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export default function RealEstateContractCenterModal({
  isOpen,
  onClose,
  layoutData,
  classDisplayName = "우리 반",
  currencyUnit = "마로",
  realEstateConfig = {},
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatAmount = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const contracts = useMemo(() => {
    const groups = Array.isArray(layoutData?.groups) ? layoutData.groups : [];
    const next = [];

    groups.forEach((group) => {
      (group?.desks || []).forEach((desk, index) => {
        if (String(desk?.tradeStatus || "") !== "contracting") return;
        const contractState = desk?.contractState || {};
        if (!contractState?.buyerId && !contractState?.buyerName) return;
        next.push({
          id: `${group?.id || "group"}-${desk?.id || index}`,
          desk,
          label: getDeskLabel(desk, index),
          sellerName:
            desk?.isStateOwned || desk?.ownerType === "state"
              ? classDisplayName
              : desk?.ownerName || desk?.studentName || "매도인",
          buyerName: contractState?.buyerName || "매수인",
          sellerSigned: Boolean(contractState?.sellerSigned),
          buyerSigned: Boolean(contractState?.buyerSigned),
          sellerSignatureImg: contractState?.sellerSignatureImg || "",
          buyerSignatureImg: contractState?.buyerSignatureImg || "",
          contractDate:
            contractState?.selectedAt ||
            contractState?.sellerConfirmation?.contractDateKey ||
            contractState?.buyerConfirmation?.contractDateKey ||
            contractState?.signedAt ||
            null,
        });
      });
    });

    return next;
  }, [classDisplayName, layoutData?.groups]);

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(new Set(contracts.map((contract) => contract.id)));
  }, [contracts, isOpen]);

  const selectedContracts = useMemo(
    () => contracts.filter((contract) => selectedIds.has(contract.id)),
    [contracts, selectedIds],
  );

  const toggleAll = () => {
    setSelectedIds((previous) =>
      previous.size === contracts.length
        ? new Set()
        : new Set(contracts.map((contract) => contract.id)),
    );
  };

  const toggleContract = (id) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrint = () => {
    if (selectedContracts.length === 0) return;
    setIsPrinting(true);
    const printWindow = window.open("", "_blank", "width=900,height=1100");
    if (!printWindow) {
      setIsPrinting(false);
      return;
    }

    const acquisitionTaxRate =
      realEstateConfig?.acquisitionTaxEnabled === false
        ? null
        : Number(realEstateConfig?.acquisitionTaxRate ?? 0);
    const capitalGainsTaxRate =
      realEstateConfig?.capitalGainsTaxEnabled === false
        ? null
        : Number(realEstateConfig?.capitalGainsTaxRate ?? 0);
    const saleTemplate = resolveSaleContractTemplate({
      saleSpecialTerms: realEstateConfig?.saleSpecialTerms,
      saleTemplate: realEstateConfig?.saleTemplate,
      acquisitionTaxRate,
      capitalGainsTaxRate,
    });
    const formatRate = (rate) =>
      Number.isFinite(rate) && rate > 0 ? `${rate}%` : "미적용";

    const pages = selectedContracts
      .map(
        ({
          desk,
          label,
          sellerName,
          buyerName,
          sellerSigned,
          buyerSigned,
          sellerSignatureImg,
          buyerSignatureImg,
          contractDate,
        }) => {
          const price = Number(desk?.askingPrice || 0);
          const officialPrice = Number(desk?.price || 0);
          const lastPrice = Number(desk?.lastPurchasePrice || 0);
          const acquisitionTax =
            acquisitionTaxRate != null
              ? Math.floor(price * (acquisitionTaxRate / 100))
              : 0;
          const totalCost = price + acquisitionTax;
          const profit = price - lastPrice;
          const capitalGainsTax =
            capitalGainsTaxRate != null && profit > 0
              ? Math.floor(profit * (capitalGainsTaxRate / 100))
              : 0;
          const sellerRevenue = price - capitalGainsTax;
          const renderedContract = sanitizeRichHtml(
            renderRealEstateContractTemplate(saleTemplate, {
              sellerName,
              buyerName,
              deskLabel: label,
              priceLabel: formatAmount(price, currencyUnit),
              acquisitionTaxLabel: formatAmount(acquisitionTax, currencyUnit),
              acquisitionTaxRate,
              totalCostLabel: formatAmount(totalCost, currencyUnit),
              capitalGainsTaxLabel: formatAmount(capitalGainsTax, currencyUnit),
              capitalGainsTaxRate,
              sellerRevenueLabel: formatAmount(sellerRevenue, currencyUnit),
              officialPriceLabel: formatAmount(officialPrice, currencyUnit),
            }),
          );
          const sellerSignature = sellerSignatureImg
            ? `<img src="${escapeHtml(sellerSignatureImg)}" alt="매도인 서명" />`
            : `<span class="signature-status">${sellerSigned ? "서명 완료" : "서명 진행 중"}</span>`;
          const buyerSignature = buyerSignatureImg
            ? `<img src="${escapeHtml(buyerSignatureImg)}" alt="매수인 서명" />`
            : `<span class="signature-status">${buyerSigned ? "서명 완료" : "서명 진행 중"}</span>`;

          return `
            <article class="paper">
              <header><strong>${escapeHtml(classDisplayName)} 부동산 매매계약서</strong><span>계약일자 ${escapeHtml(formatDate(contractDate))}</span></header>
              <section><h2>계약 기본 정보</h2><table><tbody><tr><th>대상 부동산</th><td colspan="3">${escapeHtml(label)}</td></tr><tr><th>매도인</th><td>${escapeHtml(sellerName)}</td><th>매수인</th><td>${escapeHtml(buyerName)}</td></tr><tr><th>매매 대금</th><td>${escapeHtml(formatAmount(price, currencyUnit))}</td><th>공시 가격</th><td>${escapeHtml(formatAmount(officialPrice, currencyUnit))}</td></tr></tbody></table></section>
              <section><h2>세금 및 정산</h2><table><tbody><tr><th>취득세</th><td>${escapeHtml(acquisitionTaxRate == null ? "미적용" : `${formatAmount(acquisitionTax, currencyUnit)} (${formatRate(acquisitionTaxRate)})`)}</td><th>매수인 부담</th><td>${escapeHtml(formatAmount(totalCost, currencyUnit))}</td></tr><tr><th>양도소득세</th><td>${escapeHtml(capitalGainsTaxRate == null ? "미적용" : `${formatAmount(capitalGainsTax, currencyUnit)} (${formatRate(capitalGainsTaxRate)})`)}</td><th>매도인 정산</th><td>${escapeHtml(formatAmount(sellerRevenue, currencyUnit))}</td></tr></tbody></table></section>
              <section class="contract-section"><h2>계약 내용</h2><div class="contract-body">${renderedContract}</div></section>
              <section class="confirm-grid"><div class="confirm-box"><h2>매도인 확인</h2><p>□ 내가 파는 부동산과 매수인을 확인했습니다.</p><p>□ 판매 후 정산되는 금액을 확인했습니다.</p><p>□ 계약 완료 후 소유권 이전을 확인했습니다.</p></div><div class="confirm-box"><h2>매수인 확인</h2><p>□ 내가 사는 부동산과 매도인을 확인했습니다.</p><p>□ 내가 납부할 매매대금을 확인했습니다.</p><p>□ 결제 후 소유권 이전을 확인했습니다.</p></div></section>
              <section><h2>서명</h2><div class="signature-grid"><div class="signature-box"><div class="signature-heading"><span>매도인</span><b>${escapeHtml(sellerName)}</b></div><div class="signature-image">${sellerSignature}</div><span class="signature-line">서명</span></div><div class="signature-box"><div class="signature-heading"><span>매수인</span><b>${escapeHtml(buyerName)}</b></div><div class="signature-image">${buyerSignature}</div><span class="signature-line">서명</span></div></div></section>
            </article>`;
        },
      )
      .join("");

    const printStyles = `
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, 'Malgun Gothic', sans-serif; color: #172033; }
      .paper { min-height: 273mm; border: 1px solid #93c5fd; padding: 10mm; page-break-after: always; background: #fff; }
      header { display: flex; justify-content: space-between; align-items: end; border-top: 4px solid #2563eb; border-bottom: 2px solid #2563eb; padding: 8px 0 9px; color: #1e3a8a; }
      header strong { font-size: 23px; white-space: nowrap; }
      header span { font-size: 10px; font-weight: bold; white-space: nowrap; }
      section { margin-top: 10px; }
      h2 { margin: 0 0 5px; color: #1d4ed8; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #bfdbfe; padding: 5px 7px; font-size: 10px; }
      th { width: 14%; background: #eff6ff; color: #1e3a8a; text-align: left; font-weight: bold; }
      td { width: 36%; font-weight: bold; }
      .contract-section { margin-top: 11px; }
      .contract-body { border: 1px solid #bfdbfe; border-left: 3px solid #2563eb; padding: 7px 10px; font-size: 8.5px; line-height: 1.35; }
      .contract-body h3 { margin: 4px 0 1px; color: #1e40af; font-size: 9.5px; }
      .contract-body p { margin: 0 0 2px; }
      .contract-body ul { margin: 1px 0 2px; padding-left: 14px; }
      .confirm-grid, .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .confirm-box { min-height: 25mm; border: 1px solid #bfdbfe; padding: 7px 8px; }
      .confirm-box h2 { margin-bottom: 4px; }
      .confirm-box p { margin: 2px 0; font-size: 9px; font-weight: bold; }
      .signature-box { min-height: 31mm; border: 1px solid #bfdbfe; padding: 7px; position: relative; }
      .signature-heading { display: flex; justify-content: space-between; border-bottom: 1px solid #dbeafe; padding-bottom: 4px; color: #1e3a8a; font-size: 10px; font-weight: bold; }
      .signature-image { position: absolute; right: 14px; bottom: 14px; height: 34px; display: flex; align-items: center; justify-content: flex-end; }
      .signature-image img { max-width: 120px; max-height: 34px; object-fit: contain; }
      .signature-status { color: #94a3b8; font-size: 8px; }
      .signature-line { position: absolute; right: 10px; bottom: 7px; width: 80px; border-top: 1px solid #93c5fd; padding-top: 2px; color: #1e3a8a; font-size: 9px; text-align: right; }
      @media print { .paper:last-child { page-break-after: auto; } }
    `;
    const printHtml = `<!doctype html><html lang="ko"><head><title>부동산 매매계약서</title><style>${printStyles}</style></head><body>${pages}</body></html>`;
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
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title="부동산 계약서함">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-500">
            진행 중인 매매 계약을 선택해 A4 양식으로 인쇄합니다.
          </p>
          <Button type="button" icon={Printer} tone="blue" disabled={selectedContracts.length === 0 || isPrinting} onClick={handlePrint}>
            {isPrinting ? "인쇄 준비 중..." : `선택 계약서 인쇄 (${selectedContracts.length})`}
          </Button>
        </div>

        {contracts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-14 text-center"><FileText className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-500">진행 중인 매매 계약서가 없습니다.</p></div> : <div className="space-y-2"><label className="flex cursor-pointer items-center gap-2 px-1 text-xs font-bold text-slate-500"><input type="checkbox" checked={selectedIds.size === contracts.length} onChange={toggleAll} /> 전체 선택</label>{contracts.map((contract) => <label key={contract.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/40"><input type="checkbox" checked={selectedIds.has(contract.id)} onChange={() => toggleContract(contract.id)} /><div className="min-w-0 flex-1"><p className="font-black text-slate-900">{contract.label}</p><p className="mt-1 text-xs font-semibold text-slate-500">매도 {contract.sellerName} · 매수 {contract.buyerName} · {formatAmount(contract.desk?.askingPrice, currencyUnit)}</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600">{contract.sellerSigned && contract.buyerSigned ? "서명 완료" : "서명 진행"}</span></label>)}</div>}
      </div>
    </Modal>
  );
}
