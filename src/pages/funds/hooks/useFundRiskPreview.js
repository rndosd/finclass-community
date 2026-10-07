import { useEffect, useMemo, useState } from "react";

import { previewFundRisk } from "../services/fundService";

export default function useFundRiskPreview(classId, holdings = [], { enabled = true } = {}) {
  const normalized = useMemo(
    () => (Array.isArray(holdings) ? holdings : [])
      .map((holding) => ({
        symbol: String(holding?.symbol || "").trim().toUpperCase(),
        weightBps: Math.max(0, Math.round(Number(holding?.weightBps) || 0)),
      }))
      .filter((holding) => holding.symbol && holding.weightBps > 0),
    [holdings],
  );
  const requestKey = JSON.stringify(normalized);
  const previewHoldings = useMemo(() => JSON.parse(requestKey), [requestKey]);
  const totalWeightBps = previewHoldings.reduce((sum, holding) => sum + holding.weightBps, 0);
  const canPreview = enabled && Boolean(classId) && normalized.length > 0 && totalWeightBps === 10000;
  const [state, setState] = useState({ data: null, isLoading: false, message: "" });

  useEffect(() => {
    let cancelled = false;
    if (!canPreview) {
      setState({ data: null, isLoading: false, message: "" });
      return () => { cancelled = true; };
    }

    setState((current) => ({ ...current, isLoading: true, message: "" }));
    const timer = setTimeout(async () => {
      const result = await previewFundRisk(classId, previewHoldings);
      if (cancelled) return;
      setState({
        data: result.success ? result.data : null,
        isLoading: false,
        message: result.success ? "" : result.message,
      });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canPreview, classId, previewHoldings]);

  return state;
}
