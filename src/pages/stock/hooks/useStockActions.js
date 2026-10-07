// src/pages/stock/hooks/useStockActions.js
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFinancialRequestTracker } from "../../../utils/financialRequests";
import { performStockBuy, performStockSell, performExchange } from "../services/stockService";
import { useFeedback } from "../../../contexts/FeedbackContext";

export function useStockActions(classId, uid) {
    const queryClient = useQueryClient();
    const { showFeedback } = useFeedback();
    // Each account/class needs a fresh request scope, including after a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const requests = useMemo(() => createFinancialRequestTracker(), [classId, uid]);
    const tradeKey = (type, { symbol, quantity, studentUid = "", classFundId = "" }) =>
        JSON.stringify([type, String(symbol).trim().toUpperCase(), Number(quantity), studentUid || "", classFundId]);
    const exchangeKey = ({ direction, amount }) => JSON.stringify(["exchange", direction, Number(amount)]);

    // 🚀 공통 성공 처리: 잔고와 포트폴리오 쿼리를 무효화하여 최신 데이터로 갱신
    const handleSuccess = (message, classFundId = "") => {
        queryClient.invalidateQueries({ queryKey: ["userProfile", classId, uid] });
        queryClient.invalidateQueries({ queryKey: ["stockPortfolio", classId, uid] });
        if (classFundId) {
            queryClient.invalidateQueries({ queryKey: ["tax", "classFunds", classId] });
            queryClient.invalidateQueries({ queryKey: ["stock", "classFundPortfolio", classId, classFundId] });
        }
        if (message) showFeedback(message, "success");
    };

    const handleTradeResult = (res, variables) => {
        if (res.success) handleSuccess("", variables?.classFundId || "");
        else if (res.details?.reason === "stock-price-changed") {
            queryClient.invalidateQueries({ queryKey: ["stock", "quotes", "all"] });
        }
    };

    // 1. 매수 Mutation
    const buyMutation = useMutation({
        mutationFn: (order) => requests.run(tradeKey("buy", order), (clientRequestId) =>
            performStockBuy(classId, order.symbol, order.priceUSD, order.quantity, order.classFundId || "", clientRequestId)),
        onSuccess: handleTradeResult,
        onError: (err) => showFeedback(err.message || "매수 중 오류가 발생했습니다.", "error"),
    });

    // 2. 매도 Mutation
    const sellMutation = useMutation({
        mutationFn: (order) => requests.run(tradeKey("sell", order), (clientRequestId) =>
            performStockSell(classId, order.symbol, order.priceUSD, order.quantity, order.studentUid || null, order.classFundId || "", clientRequestId)),
        onSuccess: handleTradeResult,
        onError: (err) => showFeedback(err.message || "매도 중 오류가 발생했습니다.", "error"),
    });

    // 3. 환전 Mutation
    const exchangeMutation = useMutation({
        mutationFn: (order) => requests.run(exchangeKey(order), (clientRequestId) =>
            performExchange(classId, order.direction, order.amount, clientRequestId)),
        onSuccess: (res) => res.success && handleSuccess(res.data?.message || "환전이 완료되었습니다."),
        onError: (err) => showFeedback(err.message || "환전 중 오류가 발생했습니다.", "error"),
    });

    return {
        buyStock: buyMutation.mutateAsync,
        sellStock: sellMutation.mutateAsync,
        exchangeCurrency: exchangeMutation.mutateAsync,
        hasPendingBuy: (order) => requests.has(tradeKey("buy", order)),
        hasPendingSell: (order) => requests.has(tradeKey("sell", order)),
        hasPendingExchange: (order) => requests.has(exchangeKey(order)),
        isSubmitting: buyMutation.isPending || sellMutation.isPending || exchangeMutation.isPending,
    };
}
