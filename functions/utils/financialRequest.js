"use strict";

const { createHash } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");

// Use the existing server-only receipts collection. A receipt is committed
// together with the money, ledger and activity writes, including on retries.
function runFinancialRequest({ db, classId, actorUid, operation, clientRequestId, payload }, execute) {
    if (clientRequestId != null && (
        typeof clientRequestId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(clientRequestId)
    )) {
        throw new HttpsError("invalid-argument", "거래 요청 ID가 올바르지 않습니다.");
    }
    const receiptRef = clientRequestId
        ? db.doc(`classes/${classId}/students/${actorUid}/idempotency/${operation}_${clientRequestId}`)
        : null;
    const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

    return db.runTransaction(async (tx) => {
        if (receiptRef) {
            const receipt = await tx.get(receiptRef);
            if (receipt.exists) {
                const previous = receipt.data();
                if (previous.requestHash !== requestHash) {
                    throw new HttpsError("invalid-argument", "이미 사용된 요청 ID의 거래 내용이 다릅니다.");
                }
                return previous.result;
            }
        }
        const result = await execute(tx);
        if (receiptRef) {
            tx.set(receiptRef, { requestHash, result, createdAt: FieldValue.serverTimestamp() });
        }
        return result;
    });
}

module.exports = { runFinancialRequest };
