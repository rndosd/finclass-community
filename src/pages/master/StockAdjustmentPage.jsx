import { appConfirm } from "../../utils/appDialogs";
// src/pages/master/StockAdjustmentPage.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import { functions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { useFeedback } from "../../contexts/FeedbackContext";
import { Card, Button, Alert } from "../../components/ui";
import {
  TrendingUp,
  ArrowLeft,
  Users,
  DollarSign,
} from "lucide-react";

const StockAdjustmentPage = () => {
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();
  const [symbol, setSymbol] = useState("NFLX");
  const [splitRatio, setSplitRatio] = useState("10");
  const [processingStep, setProcessingStep] = useState(null);

  // 1. 차트 보정
  const handleChartSplit = async () => {
    if (!symbol || !splitRatio) return;
    if (
      !(await appConfirm(
        `⚠️ ${symbol.toUpperCase()} 차트 히스토리를 ${splitRatio}:1로 보정하시겠습니까?`,
      ))
    )
      return;

    setProcessingStep(1);
    try {
      const task = httpsCallable(functions, "adjustSymbolForSplit");
      await task({
        symbol: symbol.toUpperCase().trim(),
        splitRatio: parseFloat(splitRatio),
      });
      showFeedback("1단계: 차트 보정 완료", "success");
    } catch (e) {
      showFeedback(e.message, "error");
    } finally {
      setProcessingStep(null);
    }
  };

  // 2. 수량 조정
  const handleQuantityAdjust = async () => {
    if (!(await appConfirm(`⚠️ 보유 수량을 ${splitRatio}배로 늘리시겠습니까?`)))
      return;
    setProcessingStep(2);
    try {
      const task = httpsCallable(functions, "adjustPortfolioQuantity");
      await task({
        symbol: symbol.toUpperCase().trim(),
        splitRatio: parseFloat(splitRatio),
      });
      showFeedback("2단계: 수량 조정 완료", "success");
    } catch (e) {
      showFeedback(e.message, "error");
    } finally {
      setProcessingStep(null);
    }
  };

  // 3. 단가 복구
  const handlePriceRecover = async () => {
    if (!(await appConfirm("평균 단가를 재계산하여 복구하시겠습니까?"))) return;
    setProcessingStep(3);
    try {
      const task = httpsCallable(functions, "recoverPortfolioPrice");
      await task({ symbol: symbol.toUpperCase().trim() });
      showFeedback("3단계: 단가 복구 완료", "success");
    } catch (e) {
      showFeedback(e.message, "error");
    } finally {
      setProcessingStep(null);
    }
  };

  return (
    <AppLayout title="주식 분할 보정">
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <Button tone="slate" kind="ghost" size="md"
          onClick={() => navigate("/admin/master")}
          className="flex items-center gap-2 transition-colors"
        >
          <ArrowLeft size={18} /> 마스터 허브로 돌아가기
        </Button>
        <Card>
          <Card.Header>
            <Card.Title>주식 분할 보정 시스템</Card.Title>
            <Card.Description>
              차트와 포트폴리오 데이터를 순서대로 보정합니다.
            </Card.Description>
          </Card.Header>
          <Card.Content noPadding className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold mb-2">
                  종목 심볼
                </label>
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full p-3 border rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2">
                  분할 비율
                </label>
                <input
                  type="number"
                  value={splitRatio}
                  onChange={(e) => setSplitRatio(e.target.value)}
                  className="w-full p-3 border rounded-xl"
                />
              </div>
            </div>

            <Alert type="warning" message="반드시 아래 순서대로 실행하세요." />

            <div className="flex flex-col gap-4">
              <Button
                color="blue"
                icon={TrendingUp}
                onClick={handleChartSplit}
                isLoading={processingStep === 1}
                disabled={!!processingStep}
              >
                1단계: 차트 히스토리 보정
              </Button>
              <Button
                color="blue"
                icon={Users}
                onClick={handleQuantityAdjust}
                isLoading={processingStep === 2}
                disabled={!!processingStep}
              >
                2단계: 포트폴리오 수량 조정
              </Button>
              <Button
                color="green"
                icon={DollarSign}
                onClick={handlePriceRecover}
                isLoading={processingStep === 3}
                disabled={!!processingStep}
              >
                3단계: 포트폴리오 단가 복구
              </Button>
            </div>
          </Card.Content>
        </Card>
      </div>
    </AppLayout>
  );
};

export default StockAdjustmentPage;
