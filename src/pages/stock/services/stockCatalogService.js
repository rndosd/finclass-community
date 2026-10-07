import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "asia-northeast3");
const validateSymbolCallable = httpsCallable(functions, "validateStockCatalogSymbol");
const registerSymbolCallable = httpsCallable(functions, "registerStockCatalogSymbol");

const toResult = async (callable, payload, fallbackMessage) => {
  try {
    const response = await callable(payload);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("[stockCatalogService] callable failed", {
      code: error?.code,
      message: error?.message,
    });
    return {
      success: false,
      code: error?.code || "unknown",
      message: error?.message || fallbackMessage,
      details: error?.details || error?.customData || null,
    };
  }
};

export const validateStockCatalogSymbol = (classId, ticker) =>
  toResult(
    validateSymbolCallable,
    { classId, ticker },
    "종목을 확인하지 못했습니다.",
  );

export const registerStockCatalogSymbol = ({
  classId,
  ticker,
  categoryId,
  explorationKeywords = [],
}) =>
  toResult(
    registerSymbolCallable,
    { classId, ticker, categoryId, explorationKeywords },
    "종목 등록에 실패했습니다.",
  );
