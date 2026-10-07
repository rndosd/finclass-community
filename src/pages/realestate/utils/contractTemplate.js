const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const wrapValue = (value, className) =>
  `<span class="${className}">${escapeHtml(value)}</span>`;

const toPercentLabel = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric}%` : "-";
};

export const SALE_SPECIAL_TERM_PRESETS = [
  {
    id: "teacher-approval",
    label: "교사 승인 없이 양도 불가",
    html: "<li>매수인은 교사의 승인 없이 해당 부동산을 다른 학생에게 양도할 수 없다.</li>",
  },
  {
    id: "system-first",
    label: "시스템 기록 우선",
    html: "<li>계약 내용과 시스템 기록이 다를 경우, 교사가 확인한 시스템 기록을 우선 적용한다.</li>",
  },
  {
    id: "tax-auto",
    label: "설정된 세금 자동 계산",
    html: "<li>학급 부동산 설정에서 켜진 세금은 계약 체결 및 대금 지급 과정에서 시스템 기준에 따라 자동 계산될 수 있다.</li>",
  },
  {
    id: "rent-arrears",
    label: "임대료 미납 시 거래 제한",
    html: "<li>임대료 또는 관련 납부금이 미납된 경우, 교사는 매매 승인이나 추가 거래를 제한할 수 있다.</li>",
  },
];

export const REAL_ESTATE_TEMPLATE_TOKEN_GUIDE = [
  { token: "{seller}", description: "매도인" },
  { token: "{buyer}", description: "매수인" },
  { token: "{deskLabel}", description: "부동산 자리명" },
  { token: "{price}", description: "매매대금" },
  { token: "{acquisitionTax}", description: "취득세" },
  { token: "{acquisitionTaxRate}", description: "취득세율" },
  { token: "{totalCost}", description: "매수인 총 부담액" },
  { token: "{capitalGainsTax}", description: "양도소득세" },
  { token: "{capitalGainsTaxRate}", description: "양도소득세율" },
  { token: "{sellerRevenue}", description: "매도인 실수령액" },
  { token: "{officialPrice}", description: "공시가격" },
];

export const getDefaultSaleSpecialTerms = () => `
<ul>
  <li>매수인은 시스템에서 안내하는 매매대금과 부담금을 납부해야 소유권 이전이 완료된다.</li>
  <li>계약 내용과 시스템 기록이 다를 경우, 교사가 확인한 학급 부동산 기록을 기준으로 한다.</li>
</ul>
`.trim();

const hasEnabledRate = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

export const buildSaleContractTemplate = (
  specialTerms = getDefaultSaleSpecialTerms(),
  {
    acquisitionTaxRate,
    capitalGainsTaxRate,
  } = {},
) => {
  const showAcquisitionTax = hasEnabledRate(acquisitionTaxRate);
  const showCapitalGainsTax = hasEnabledRate(capitalGainsTaxRate);

  const buyerPaymentSection = showAcquisitionTax
    ? `<h3>제3조 (대금 납부 및 매수인 부담금)</h3>
<p>매매대금은 {price}로 하며, 매수인은 시스템의 결제 절차에 따라 매매대금을 납부한다.</p>
<p>매수인의 총 납부금액은 매매대금 {price}와 취득세 {acquisitionTax}({acquisitionTaxRate})를 합산한 {totalCost}이다.</p>`
    : `<h3>제3조 (대금 납부)</h3>
<p>매매대금은 {price}로 하며, 매수인은 시스템의 결제 절차에 따라 매매대금을 납부한다.</p>
<p>매수인의 총 납부금액은 매매대금 {price}이다.</p>`;

  const sellerSettlementSection = showCapitalGainsTax
    ? `<h3>제4조 (매도인 정산)</h3>
<p>매도인은 매수인의 납부와 계약 당사자의 전자 서명이 완료된 후 시스템 정산 절차에 따라 대금을 지급받는다.</p>
<p>매도인의 양도소득세는 {capitalGainsTax}({capitalGainsTaxRate})이며, 세금 차감 후 실수령액은 {sellerRevenue}이다.</p>
<p>공시가격은 {officialPrice}이며, 세금과 정산 계산은 학급 부동산 설정값을 기준으로 한다.</p>`
    : `<h3>제4조 (매도인 정산)</h3>
<p>매도인은 매수인의 납부와 계약 당사자의 전자 서명이 완료된 후 시스템 정산 절차에 따라 대금을 지급받는다.</p>
<p>매도인의 실수령액은 매매대금 {price}이다.</p>
<p>공시가격은 {officialPrice}이며, 정산 계산은 학급 부동산 설정값을 기준으로 한다.</p>`;

  return `
<h3>제1조 (매매 목적물)</h3>
<p>매도인 {seller}와 매수인 {buyer}은(는) 아래 표시된 학급 부동산에 관하여 다음과 같이 매매계약을 체결한다.</p>
<p>매매 목적물은 {deskLabel}이며, 계약서 상단의 자리 정보와 시스템 기록을 기준으로 확인한다.</p>

<h3>제2조 (계약 성립)</h3>
<p>{seller}은(는) {buyer}에게 제1조의 목적물을 매도하고, {buyer}은(는) 이를 매수한다.</p>
<p>본 계약은 매도인과 매수인이 계약 내용을 확인하고 각각 전자 서명을 완료한 때 성립한다.</p>

${buyerPaymentSection}

${sellerSettlementSection}

<h3>제5조 (소유권 이전)</h3>
<p>매수인이 총 납부금액을 납부하면 해당 부동산의 소유권은 매수인에게 이전된다.</p>
<p>소유권 이전 결과는 학급 부동산 시스템의 소유자 기록에 반영된다.</p>

<h3>제6조 (시스템 기록 및 학급 규칙)</h3>
<p>계약서 상단의 당사자, 목적물, 매매대금은 시스템 기록을 기준으로 자동 표시된다.</p>
<p>본 계약에 적히지 않은 사항은 교사가 확인한 시스템 기록과 학급 규칙을 기준으로 처리한다.</p>

<h3>제7조 (특약사항)</h3>
${specialTerms || "<p>별도 특약사항 없음</p>"}

<h3>제8조 (확인 및 전자서명)</h3>
<p>매도인과 매수인은 위 계약 내용을 확인한 후 전자 서명하며, 서명 이후에는 학급 부동산 거래 절차에 따라 계약을 진행한다.</p>
`.trim();
};

export const getDefaultSaleTemplate = () =>
  buildSaleContractTemplate(getDefaultSaleSpecialTerms(), {
    acquisitionTaxRate: 0,
    capitalGainsTaxRate: 0,
  });

const normalizeHtml = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

export const isDefaultSaleTemplate = (template) =>
  // Recognize the old built-in template so it follows the current class policy.
  [getDefaultSaleTemplate(), buildSaleContractTemplate(getDefaultSaleSpecialTerms(), {
    acquisitionTaxRate: 5,
    capitalGainsTaxRate: 10,
  })].some((defaultTemplate) => normalizeHtml(template) === normalizeHtml(defaultTemplate));

const looksLikeFullSaleContractTemplate = (template) => {
  const normalized = normalizeHtml(template);
  if (!normalized) return false;

  return (
    /{seller}|{owner}|{buyer}|{tenant}|{deskLabel}|{price}/.test(normalized) ||
    /제\s*1\s*조|제1조|매매\s*목적물|계약\s*성립|소유권\s*이전/.test(normalized)
  );
};

export const resolveSaleContractTemplate = ({
  saleSpecialTerms,
  saleTemplate,
  acquisitionTaxRate,
  capitalGainsTaxRate,
} = {}) => {
  const specialTerms =
    typeof saleSpecialTerms === "string" ? saleSpecialTerms.trim() : "";
  if (specialTerms) {
    return buildSaleContractTemplate(specialTerms, {
      acquisitionTaxRate,
      capitalGainsTaxRate,
    });
  }

  const legacyTemplate = typeof saleTemplate === "string" ? saleTemplate.trim() : "";
  if (legacyTemplate && !isDefaultSaleTemplate(legacyTemplate)) {
    if (looksLikeFullSaleContractTemplate(legacyTemplate)) {
      return legacyTemplate;
    }

    return buildSaleContractTemplate(legacyTemplate, {
      acquisitionTaxRate,
      capitalGainsTaxRate,
    });
  }

  return buildSaleContractTemplate(getDefaultSaleSpecialTerms(), {
    acquisitionTaxRate: acquisitionTaxRate ?? 0,
    capitalGainsTaxRate: capitalGainsTaxRate ?? 0,
  });
};

export const renderRealEstateContractTemplate = (
  template,
  {
    sellerName,
    buyerName,
    deskLabel,
    priceLabel,
    acquisitionTaxLabel,
    acquisitionTaxRate,
    totalCostLabel,
    capitalGainsTaxLabel,
    capitalGainsTaxRate,
    sellerRevenueLabel,
    officialPriceLabel,
  } = {},
) => {
  if (!template) return "";

  return template
    .replace(
      /{seller}|{owner}/g,
      wrapValue(sellerName, "font-bold text-slate-900"),
    )
    .replace(
      /{buyer}|{tenant}/g,
      wrapValue(buyerName, "font-bold text-blue-700"),
    )
    .replace(
      /{deskLabel}/g,
      wrapValue(deskLabel, "font-bold text-slate-900"),
    )
    .replace(
      /{price}/g,
      wrapValue(priceLabel, "font-bold text-slate-900"),
    )
    .replace(
      /{acquisitionTax}/g,
      wrapValue(acquisitionTaxLabel, "font-bold text-rose-600"),
    )
    .replace(
      /{acquisitionTaxRate}/g,
      wrapValue(toPercentLabel(acquisitionTaxRate), "font-bold text-rose-500"),
    )
    .replace(
      /{totalCost}/g,
      wrapValue(totalCostLabel, "font-bold text-blue-700"),
    )
    .replace(
      /{capitalGainsTax}/g,
      wrapValue(capitalGainsTaxLabel, "font-bold text-emerald-600"),
    )
    .replace(
      /{capitalGainsTaxRate}/g,
      wrapValue(toPercentLabel(capitalGainsTaxRate), "font-bold text-emerald-500"),
    )
    .replace(
      /{sellerRevenue}/g,
      wrapValue(sellerRevenueLabel, "font-bold text-emerald-700"),
    )
    .replace(
      /{officialPrice}/g,
      wrapValue(officialPriceLabel, "font-bold text-amber-600"),
    );
};
