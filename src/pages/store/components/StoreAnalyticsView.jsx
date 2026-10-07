import React, { useMemo, useState } from "react";
import { ChartBar, Info, TrendUp } from "@phosphor-icons/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, DataTable, InputField, SelectField, Tabs } from "../../../components/ui";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { buildStoreAnalyticsModel } from "../utils/storeAnalyticsModel";
import "./StoreAnalyticsUI.css";

const count = (value) => Number(value || 0).toLocaleString("ko-KR");
const percent = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
function AnalyticsSurface({ children, className = "", ...props }) {
  return <Card noPadding className={`!overflow-visible ${className}`}><section {...props}>{children}</section></Card>;
}

function Chart({ rows, dataKey, unit, color = "#2563eb", label, moneyFormat, emptyDescription }) {
  if (!rows.some((row) => row[dataKey] !== null && row[dataKey] !== undefined)) {
    return <div className="store-chart-empty"><p className="font-semibold text-slate-800">{label} 표시 준비 중</p><p className="mt-2 text-sm leading-relaxed text-slate-700">{emptyDescription || "집계가 준비되면 일별 흐름을 확인할 수 있습니다. 미집계 날짜는 0으로 표시하지 않습니다."}</p></div>;
  }
  return (
    <div className="h-56" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 16, right: 14, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => dataKey === "index" ? Number(value).toFixed(1) : dataKey === "amount" ? moneyFormat(value) : count(value)} width={52} axisLine={false} tickLine={false} domain={dataKey === "index" ? ["dataMin - 2", "dataMax + 2"] : [0, "auto"]} allowDecimals={dataKey === "index" || dataKey === "amount"} />
          <Tooltip formatter={(value) => [`${dataKey === "amount" ? moneyFormat(value) : count(Math.round(value * 10) / 10)}${unit}`, label]} />
          <Line type="linear" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function StoreAnalyticsView({ rows, previousRows, range, items, currencyUnit, totalStudentCount, onOpenCpi }) {
  const { formatClassCurrency } = useNumberFormat();
  const [metric, setMetric] = useState("quantity");
  const [onlyUnsold, setOnlyUnsold] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentSort, setStudentSort] = useState("number");
  const model = useMemo(() => buildStoreAnalyticsModel(rows, previousRows, range, items), [rows, previousRows, range, items]);
  const { summary, previous, prices, comparable, productRows, previousRange } = model;
  const amount = (value, unit = currencyUnit) => `${formatClassCurrency(value)}${unit}`;
  const amounts = (currencies, zero = `0${currencyUnit}`) => Object.entries(currencies)
    .map(([key, row]) => amount(row.amount, key === "cash" ? currencyUnit : row.unit || key.toUpperCase())).join(" · ") || zero;
  const deltaText = (value, previousValue, unit, isMoney = false) => {
    if (!comparable) return "비교 기간 집계 준비 중";
    const delta = value - previousValue;
    if (delta === 0) return "직전 기간과 같음";
    return `직전 기간보다 ${isMoney ? formatClassCurrency(Math.abs(delta)) : count(Math.abs(delta))}${unit} ${delta > 0 ? "증가" : "감소"}`;
  };
  const metricOptions = [{ id: "quantity", label: "판매 수량" }, { id: "amount", label: "구매 금액" }, { id: "participants", label: "구매 학생" }];
  const metricLabel = metricOptions.find((option) => option.id === metric).label;
  const metricUnit = metric === "amount" ? currencyUnit : metric === "quantity" ? "개" : "명";
  const ready = summary.readyDays > 0;
  const metrics = [
    { label: "학생 구매 금액", value: ready ? amounts(summary.byCurrency) : "집계 대기", note: `${deltaText(summary.byCurrency.cash?.amount || 0, previous.byCurrency.cash?.amount || 0, currencyUnit, true)}${Object.keys(summary.byCurrency).some((key) => key !== "cash") ? ` (${currencyUnit} 기준)` : ""}` },
    { label: "구매 학생", value: ready ? `${count(summary.participantCount)}${totalStudentCount ? ` / ${count(totalStudentCount)}` : ""}명` : "집계 대기", note: deltaText(summary.participantCount, previous.participantCount, "명") },
    { label: "판매 수량", value: ready ? `${count(summary.quantity)}개` : "집계 대기", note: deltaText(summary.quantity, previous.quantity, "개") },
    { label: "공통 상품 가격 변화", value: prices.change === null ? "비교 준비 중" : percent(prices.change), note: prices.change === null ? prices.capturedDays > 0 ? "당시 화폐가 확인된 공통 상품이 필요합니다" : "두 기간의 가격 기록이 필요합니다" : `${prices.previousDate.slice(5)} → ${prices.currentDate.slice(5)} · ${prices.itemCount}종의 평균 변동률`, price: true },
  ];
  const showUnsold = onlyUnsold && summary.complete;
  const studentRows = Object.values(summary.byStudent).filter((row) => {
    const query = studentQuery.trim().toLocaleLowerCase("ko-KR");
    return !query || String(row.name || "").toLocaleLowerCase("ko-KR").includes(query) || (/^\d+번?$/.test(query) && String(row.studentNumber || "").includes(query.replace(/번$/, "")));
  }).sort((a, b) => {
    const byNumber = (a.studentNumber || 9999) - (b.studentNumber || 9999) || String(a.name || "").localeCompare(String(b.name || ""), "ko-KR");
    return studentSort === "quantity" ? b.quantity - a.quantity || byNumber : byNumber;
  });
  const filteredProducts = productRows.filter((row) => !showUnsold || row.quantity === 0);
  const productHint = (row) => {
    if (!comparable || summary.trend.length !== previous.trend.length) return "집계된 날짜의 현황";
    if (row.priceChange > 0 && row.quantity < row.previousQuantity) return "가격 변경 후 판매 흐름 확인";
    if (row.quantity > row.previousQuantity) return "재고 확인";
    if (row.quantity === 0) return "판매 상태·수요 확인";
    return "판매 흐름 확인";
  };
  return (
    <div className="store-analytics-ui space-y-6">
      <section className="py-2" aria-labelledby="store-insight-title">
        <div className="flex items-start gap-3">
          <ChartBar className="mt-1 h-6 w-6 shrink-0 text-slate-600" aria-hidden="true" />
          <div>
            <h3 id="store-insight-title" className="text-sm font-bold text-slate-700">이번 기간 점검할 내용</h3>
            <p className="mt-3 text-xl font-bold leading-7 text-slate-900">{model.insight}</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">{model.guidance}</p>
            {model.highlights.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="이번 기간 특이점">
              {model.highlights.map((highlight) => <li className="min-w-0 max-w-full" key={highlight.id}><Badge tone={highlight.tone} size="sm" className="!whitespace-normal break-words text-left">{highlight.label}</Badge></li>)}
            </ul>}
            <p className="mt-4 text-xs text-slate-500">학생 유료 구매 합계 · 직전 같은 길이 기간과 비교 · 가격 변경이 판매 변화의 원인이라는 뜻은 아닙니다.</p>
          </div>
        </div>
      </section>

      {(!summary.complete || !previous.complete) && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>현재 기간 {summary.readyDays}/{summary.trend.length}일 · 비교 기간 {previous.readyDays}/{previous.trend.length}일 집계.
            {summary.excludedCount + previous.excludedCount > 0 ? " 일부 구매 기록의 정보가 부족합니다." : ""}
            {summary.readyDays > 0 ? " 준비된 기록만 표시하며, 불완전한 기간의 증감 안내는 보류합니다." : " 새 통계 기록이 쌓이면 구매 현황을 표시합니다."}</p>
        </div>
      )}
      <Card noPadding>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0" role="group" aria-label="상점 주요 지표">
        {metrics.map((row) => (
          <div className="min-w-0 p-4 sm:p-5" key={row.label}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-600">{row.price && <TrendUp className="h-4 w-4" aria-hidden="true" />}{row.label}</h3>
            <p className="mt-3 break-words text-2xl font-bold tabular-nums text-slate-900">{row.value}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{row.note}</p>
          </div>
        ))}
      </div>
      </Card>

      <div className="grid gap-4 pt-1 lg:grid-cols-5">
        <AnalyticsSurface className="lg:col-span-3" aria-labelledby="store-trend-title">
          <div className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="store-trend-title" className="text-base font-bold text-slate-900">일별 판매 흐름</h3>
            <Tabs tabs={metricOptions} activeTab={metric} onTabChange={setMetric} variant="pills" size="sm" ariaLabel="일별 판매 지표" />
          </div>
          <p className="mb-2 mt-3 text-xs text-slate-500">{metric === "amount" ? `${currencyUnit} 구매만 표시` : "학생 유료 구매 기준"} · 미집계 날짜는 그래프가 끊어집니다.</p>
          {metric === "participants" && <p className="mb-2 text-xs text-slate-500">그래프는 날짜별 구매 학생 수입니다. 위 요약에서는 같은 학생의 기간 내 여러 번 구매는 한 명으로 집계합니다.</p>}
          <Chart rows={summary.trend} dataKey={metric} unit={metricUnit} label={metricLabel} moneyFormat={formatClassCurrency} />
          <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer py-2">날짜별 수치 보기</summary>
            <ul className="space-y-1">{summary.trend.map((row) => <li key={row.date}>{row.date} · {row[metric] === null ? "미집계" : `${metric === "amount" ? formatClassCurrency(row[metric]) : count(row[metric])}${metricUnit}`}</li>)}</ul>
          </details>
          </div>
        </AnalyticsSurface>
        <AnalyticsSurface className="lg:col-span-2" aria-labelledby="store-price-title">
          <div className="p-4 sm:p-6">
          <h3 id="store-price-title" className="text-base font-bold text-slate-900">상품 가격 흐름</h3>
          <p className="mb-2 mt-3 text-xs text-slate-500">직전 기간의 마지막 기록 = 100 · 동일 상품을 같은 비중으로 비교</p>
          <Chart rows={prices.trend} dataKey="index" unit="" color="#475569" label="상품 가격 지수" moneyFormat={formatClassCurrency} emptyDescription={prices.priceRecordDays > 0 ? "가격 기록은 있지만 당시 수집일·화폐가 확인된 비교 기록이 부족합니다. 아래 가격 이력과 비교 기준을 확인해 주세요." : "두 기간에 저장된 가격 기록이 준비되면 비교할 수 있습니다. 기록이 없는 날짜는 비교할 수 없습니다."} />
          {prices.priceRecordDays > 0 && <p className="store-price-note mt-3 text-sm leading-relaxed text-slate-700">
            가격 기록 {prices.priceRecordDays}일 중 당시 수집이 확인된 자료 {prices.capturedDays}일.
            {prices.legacyCapturedDays > 0 ? ` 기존 일별 수집 자료 ${prices.legacyCapturedDays}일을 포함합니다.` : ""}
            {prices.unknownCurrencyPrices > 0 ? ` 화폐를 확인할 수 없는 가격 ${prices.unknownCurrencyPrices}개는 가격 지수에서 제외합니다.` : ""}
          </p>}
          {prices.capturedHistory.length > 0 && <details aria-label="기록된 상품 가격 이력" className="mt-2 text-xs leading-relaxed text-slate-600">
            <summary className="cursor-pointer py-2 text-blue-700">기록된 상품 가격 이력</summary>
            <p>선택한 두 기간의 수집 기록입니다. 화폐가 미확인인 가격도 기록 자체를 표시하며, 최근 50개를 보여 줍니다.</p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">{prices.capturedHistory.slice().reverse().slice(0, 50).map((entry) =>
              <li key={`${entry.date}-${entry.id}`}>{entry.date} · {entry.name} · {formatClassCurrency(entry.price)}
                {entry.currencyType ? entry.currencyUnit || ` (${entry.currencyType === "cash" ? "학급 화폐" : entry.currencyType}·단위 미확인)` : " (화폐 미확인)"}
                {entry.provenance === "legacyScheduledSnapshot" ? " · 기존 일별 수집" : " · 일별 수집"}
              </li>)}
            </ul>
          </details>}
          <details className="mt-2 text-xs leading-relaxed text-slate-600"><summary className="cursor-pointer py-2 text-blue-700">비교 기준 보기</summary>
            <p>선택 기간 {range.startDate} ~ {range.endDate}</p>
            <p>직전 기간 {previousRange?.startDate} ~ {previousRange?.endDate}</p>
            <p className="mt-2">가격 기록: {prices.previousDate || "없음"} → {prices.currentDate || "없음"}. 두 기록에 모두 있는 일반 화폐 판매 상품 {prices.itemCount || 0}종의 가격 변동률을 같은 비중으로 평균합니다. 판매 구성 변화는 반영하지 않습니다.</p>
            <p className="mt-2">다른 화폐 상품·신규/삭제 상품·기록이 없는 상품은 가격 비교에서 제외합니다. 현재 가격으로 과거 기록을 대신하지 않습니다.</p>
            <p className="mt-2">가격과 판매량이 함께 변해도 가격이 원인이라고 단정할 수는 없습니다. 날짜별 현황과 상품 상태를 함께 확인하세요.</p>
            <Button size="xs" variant="secondary" className="mt-3" onClick={onOpenCpi}>직접 설정한 물가 비교</Button>
          </details>
          </div>
        </AnalyticsSurface>
      </div>

      <AnalyticsSurface aria-labelledby="store-products-title">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h3 id="store-products-title" className="text-base font-bold text-slate-900">상품별 가격·판매 비교</h3>
          <div className="flex gap-2">
            <Button size="sm" kind={showUnsold ? "outline" : "solid"} tone={showUnsold ? "slate" : "blue"} aria-pressed={!showUnsold} onClick={() => setOnlyUnsold(false)}>전체 상품</Button>
            <Button size="xs" kind={showUnsold ? "solid" : "outline"} tone={showUnsold ? "blue" : "slate"} aria-pressed={showUnsold} disabled={!summary.complete} aria-describedby={!summary.complete ? "store-unsold-help" : undefined} onClick={() => setOnlyUnsold(true)}>판매 없음</Button>
          </div>
        </div>
        {!summary.complete && <p id="store-unsold-help" className="px-4 pb-3 text-sm text-slate-700">미집계 또는 제외된 거래가 있어 판매 없음 여부를 판단할 수 없습니다. 전체 상품을 표시합니다.</p>}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="상품별 가격·판매 비교 목록" aria-describedby="store-product-scroll-help">
          <DataTable className="!overflow-visible" minWidth="min-w-[760px]" tableClassName="w-full text-left">
            <caption className="sr-only">상품별 두 기간 가격 기록과 유료 구매 수량 비교</caption>
            <DataTable.Header><DataTable.Row interactive={false}>{["상품", "이전 가격", "이번 가격", "가격 변화", "이전 판매", "이번 판매", "점검 안내"].map((heading, index) => <DataTable.HeadCell align={index > 0 && index < 6 ? "right" : "left"} key={heading} scope="col">{heading}</DataTable.HeadCell>)}</DataTable.Row></DataTable.Header>
            <DataTable.Body>
              {filteredProducts.map((row) => <DataTable.Row key={row.id}>
                <th scope="row" className="px-5 py-4 font-bold text-slate-800">{row.name}</th>
                <DataTable.Cell align="right" className="whitespace-nowrap tabular-nums">{row.previousPrice !== undefined ? amount(row.previousPrice, row.previousCurrencyUnit || " (단위 미확인)") : "—"}</DataTable.Cell>
                <DataTable.Cell align="right" className="whitespace-nowrap tabular-nums">{row.price !== undefined ? amount(row.price, row.currencyUnit || " (단위 미확인)") : "—"}</DataTable.Cell>
                <DataTable.Cell align="right" className="whitespace-nowrap tabular-nums">{row.priceChange !== undefined && Math.abs(row.priceChange) >= 0.05 ? <Badge tone="slate" size="sm">{percent(row.priceChange)}</Badge> : <span className="text-slate-700">{row.priceChange !== undefined ? "변동 없음" : "기록 부족"}</span>}</DataTable.Cell>
                <DataTable.Cell align="right" className="tabular-nums">{row.previousQuantity === null ? "—" : `${count(row.previousQuantity)}개`}</DataTable.Cell>
                <DataTable.Cell align="right" strong className="tabular-nums">{row.quantity === null ? "—" : `${count(row.quantity)}개`}</DataTable.Cell>
                <DataTable.Cell className="text-sm text-slate-700">{productHint(row)}</DataTable.Cell>
              </DataTable.Row>)}
              {!filteredProducts.length && <DataTable.Empty colSpan={7} className="text-center text-slate-500">{onlyUnsold ? "판매가 없는 상품이 없습니다." : "표시할 상품이 없습니다."}</DataTable.Empty>}
            </DataTable.Body>
          </DataTable>
        </div>
        <p id="store-product-scroll-help" className="px-4 pt-3 text-xs text-slate-500">표의 오른쪽 열이 보이지 않으면 좌우로 스크롤하세요. 키보드로는 표 영역을 선택한 뒤 방향키로 이동할 수 있습니다.</p>
        <p className="p-4 text-xs leading-relaxed text-slate-500">판매: {range.startDate} ~ {range.endDate} / 직전 {previousRange?.startDate} ~ {previousRange?.endDate} · 주말 제외 ({summary.trend.length}일 / {previous.trend.length}일). 가격: 각 기간의 마지막 저장 기록. 신규 상품의 판매 없음은 판매 부진을 뜻하지 않습니다.</p>
      </AnalyticsSurface>

      <Card noPadding className="!overflow-visible">
      <div className="divide-y divide-slate-100">
        <details className="p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">학생별 구매 내역 보기</summary>
          <div className="mt-4 max-w-3xl">
            <p className="text-sm leading-relaxed text-slate-700">{range.startDate} ~ {range.endDate}의 학생별 유료 구매 합계입니다.</p>
            <div className="my-4 flex flex-wrap items-end gap-3">
              <InputField label="학생 검색" type="search" placeholder="이름 또는 번호" value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} wrapperClassName="min-w-0 w-full sm:w-auto sm:flex-1" />
              {studentQuery.trim() && <Button variant="outline" size="sm" onClick={() => setStudentQuery("")}>검색 초기화</Button>}
              <div className="w-36 shrink-0"><SelectField label="정렬" value={studentSort} onChange={(event) => setStudentSort(event.target.value)} options={[{ value: "number", label: "번호순" }, { value: "quantity", label: "구매 수량순" }]} /></div>
            </div>
            <p className="mb-2 text-sm font-semibold text-slate-700" aria-live="polite">구매 학생 {count(summary.participantCount)}명 중 {count(studentRows.length)}명 표시</p>
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-200" tabIndex={0} role="region" aria-label="학생별 구매 합계 목록">
              <DataTable className="!overflow-visible" tableClassName="w-full table-fixed">
                <caption className="sr-only">학생별 선택 기간 구매 금액과 수량</caption>
                <DataTable.Header className="sticky top-0"><DataTable.Row interactive={false}><DataTable.HeadCell scope="col" className="w-2/5 !px-3">학생</DataTable.HeadCell><DataTable.HeadCell scope="col" align="right" className="w-2/5 !px-3">구매 금액</DataTable.HeadCell><DataTable.HeadCell scope="col" align="right" className="w-1/5 !px-3">수량</DataTable.HeadCell></DataTable.Row></DataTable.Header>
                <DataTable.Body>{studentRows.map((row) => <DataTable.Row key={row.uid}>
                  <th scope="row" className="break-words px-3 py-3 text-left font-semibold text-slate-800"><span className="mb-1 block text-xs font-normal text-slate-700">{row.studentNumber ? `${row.studentNumber}번` : "번호 없음"}</span>{row.name}</th>
                  <DataTable.Cell align="right" className="break-words !px-3 tabular-nums text-slate-900">{amounts(row.byCurrency)}</DataTable.Cell>
                  <DataTable.Cell align="right" className="whitespace-nowrap !px-3 tabular-nums text-slate-700">{count(row.quantity)}개</DataTable.Cell>
                </DataTable.Row>)}
                  {!studentRows.length && <DataTable.Empty colSpan={3} className="text-center text-slate-500">{summary.participantCount ? "검색 결과가 없습니다." : "집계된 유료 구매 학생이 없습니다."}</DataTable.Empty>}
                </DataTable.Body>
              </DataTable>
            </div>
          </div>
        </details>
        <details className="p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">무료 지급·기금 구매 보기</summary>
          <p className="mt-3 text-sm text-slate-700">{ready ? `무료 지급 ${count(summary.gifts.quantity)}개 · 기금 구매 ${amounts(summary.classFund.byCurrency)} / ${count(summary.classFund.quantity)}개` : "집계된 지급·기금 구매 기록이 없습니다."}</p>
          <p className="mt-2 text-xs text-slate-500">학생 구매 금액·구매 학생·판매 수량에는 포함하지 않습니다.</p>
        </details>
      </div>
      </Card>
    </div>
  );
}
