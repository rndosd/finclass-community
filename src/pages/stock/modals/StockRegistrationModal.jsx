import React, { useEffect, useMemo, useState } from "react";
import { SearchCheck, ShieldCheck } from "lucide-react";

import { Alert, Button, InputField, Modal } from "../../../components/ui";
import { STOCK_CATEGORY_DEFINITIONS } from "../../../config/stockCatalog";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  registerStockCatalogSymbol,
  validateStockCatalogSymbol,
} from "../services/stockCatalogService";

const normalizeTicker = (value) =>
  String(value || "").trim().toUpperCase().replaceAll(".", "-");

const parseKeywords = (value) =>
  Array.from(new Set(
    String(value || "")
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  )).slice(0, 2);

export default function StockRegistrationModal({
  isOpen,
  onClose,
  classId,
  onRegistered,
}) {
  const { showFeedback } = useFeedback();
  const [ticker, setTicker] = useState("");
  const [evidence, setEvidence] = useState(null);
  const [categoryId, setCategoryId] = useState("");
  const [keywords, setKeywords] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const categoryOptions = useMemo(
    () => STOCK_CATEGORY_DEFINITIONS.filter(
      (category) => !evidence || category.type === evidence.securityType,
    ),
    [evidence],
  );

  useEffect(() => {
    if (!isOpen) return;
    setTicker("");
    setEvidence(null);
    setCategoryId("");
    setKeywords("");
  }, [isOpen]);

  const handleTickerChange = (event) => {
    setTicker(event.target.value.toUpperCase());
    setEvidence(null);
    setCategoryId("");
  };

  const handleValidate = async () => {
    const normalizedTicker = normalizeTicker(ticker);
    if (!normalizedTicker) {
      showFeedback("확인할 티커를 입력해주세요.", "warning");
      return;
    }
    setIsValidating(true);
    const result = await validateStockCatalogSymbol(classId, normalizedTicker);
    setIsValidating(false);
    if (!result.success) {
      showFeedback(result.message, "error");
      return;
    }
    const nextEvidence = result.data?.evidence || null;
    setTicker(nextEvidence?.ticker || normalizedTicker);
    setEvidence(nextEvidence);
    const firstCategory = STOCK_CATEGORY_DEFINITIONS.find(
      (category) => category.type === nextEvidence?.securityType,
    );
    setCategoryId(firstCategory?.id || "");
    showFeedback("가격 API에서 종목을 확인했습니다.", "success");
  };

  const handleRegister = async () => {
    if (!evidence || !categoryId) return;
    setIsRegistering(true);
    const result = await registerStockCatalogSymbol({
      classId,
      ticker: evidence.ticker,
      categoryId,
      explorationKeywords: parseKeywords(keywords),
    });
    setIsRegistering(false);
    if (!result.success) {
      showFeedback(result.message, "error");
      return;
    }
    showFeedback(
      `${evidence.ticker} 종목을 전역 카탈로그에 기본 비노출로 등록했습니다.`,
      "success",
    );
    await onRegistered?.(result.data?.stock || null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-black text-slate-800">신규 종목 등록</h2>
        </div>
      </Modal.Header>
      <Modal.Body className="space-y-5">
        <Alert
          type="info"
          message="미국 정규 거래소 종목만 등록할 수 있습니다. 가격 API 확인을 통과한 종목은 전역 카탈로그에 추가되지만 학생 화면에는 기본적으로 공개되지 않습니다."
        />

        <div className="flex items-end gap-2">
          <InputField
            label="미국 주식·ETF 티커"
            value={ticker}
            onChange={handleTickerChange}
            placeholder="예: ACME"
            className="flex-1"
          />
          <Button
            tone="blue"
            kind="outline"
            icon={SearchCheck}
            onClick={handleValidate}
            isLoading={isValidating}
            disabled={isValidating || isRegistering}
          >
            API 확인
          </Button>
        </div>

        {evidence ? (
          <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black text-slate-800">
                  {evidence.ticker} · {evidence.companyName}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {evidence.securityType} · {evidence.exchange || "미국 거래소"} · {evidence.currency}
                </p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-emerald-700 shadow-sm">
                ${Number(evidence.currentPriceUSD || 0).toLocaleString("en-US", {
                  maximumFractionDigits: 4,
                })}
              </span>
            </div>

            <label className="block space-y-1.5 text-sm font-bold text-slate-700">
              <span>주 카테고리</span>
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-bold outline-none focus:border-blue-500"
              >
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>

            <InputField
              label="탐구 키워드 (선택, 쉼표로 최대 2개)"
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="예: AI·로봇, 데이터센터"
            />

            <p className="rounded-xl bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
              등록 후 교사는 전체 종목 검색에서 확인할 수 있습니다. 학생에게 공개하려면 학급 카테고리나 공개 템플릿에서 별도로 선택해야 합니다.
            </p>
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button tone="slate" kind="ghost" onClick={onClose} disabled={isRegistering}>
          취소
        </Button>
        <Button
          tone="blue"
          onClick={handleRegister}
          isLoading={isRegistering}
          disabled={!evidence || !categoryId || isValidating || isRegistering}
        >
          전역 카탈로그에 등록
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
