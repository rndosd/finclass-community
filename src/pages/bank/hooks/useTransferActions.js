import { useState, useCallback, useRef, useEffect } from "react";
import { getSpendableBankBalance } from "../../../utils/bankMoney";
import {
  bankCommandApi,
  createBankClientRequestId,
} from "../services/bankCommandApi";

export default function useTransferActions({ classId, currentStudent }) {
  const [isTransferring, setIsTransferring] = useState(false);
  const requestsRef = useRef(new Map());
  const studentUid = currentStudent?.uid || currentStudent?.id || "";

  useEffect(() => {
    requestsRef.current.clear();
  }, [classId, studentUid]);

  /**
   * 🚀 송금 실행 (피드백은 부모에게 위임)
   */
  const handleTransfer = useCallback(
    async (toUid, amount, memo = "", fee = 0) => {
      const amountNum = Math.floor(Number(amount));
      const feeNum = Number(fee) || 0;
      const totalNeeded = amountNum + feeNum;

      if (!toUid) return { success: false, message: "수신자 정보가 없습니다." };
      if (!Number.isSafeInteger(amountNum) || amountNum <= 0) {
        return { success: false, message: "송금액은 0보다 커야 합니다." };
      }
      const transferMemo = String(memo || "").trim();
      const requestKey = JSON.stringify([classId, studentUid, toUid, amountNum, transferMemo]);
      const pending = requestsRef.current.get(requestKey);
      if (pending?.promise) return pending.promise;

      const availableCash = getSpendableBankBalance(currentStudent?.assets);
      // A timed-out request may already have committed. Let the server return
      // its stored result even if the newly refreshed balance is now lower.
      if (!pending && availableCash < totalNeeded) {
        return { success: false, message: "잔액이 부족합니다." };
      }

      const entry = pending || { id: createBankClientRequestId(), promise: null };
      requestsRef.current.set(requestKey, entry);
      setIsTransferring(true);
      entry.promise = (async () => {
        try {
          const result = await bankCommandApi.transferMoney({
            classId,
            toUid,
            amount: amountNum,
            memo: transferMemo,
            clientRequestId: entry.id,
          });

          if (result?.success) requestsRef.current.delete(requestKey);
          return { success: result?.success };
        } catch (err) {
          console.error("송금 오류:", err);
          return { success: false, message: err?.details?.message || err.message };
        } finally {
          entry.promise = null;
          setIsTransferring(false);
        }
      })();
      return entry.promise;
    },
    [classId, currentStudent, studentUid]
  );

  const hasPendingTransfer = (toUid, amount, memo = "") => requestsRef.current.has(
    JSON.stringify([classId, studentUid, toUid, Math.floor(Number(amount)), String(memo || "").trim()]),
  );
  return { isTransferring, handleTransfer, hasPendingTransfer };
}
