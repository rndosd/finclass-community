"use strict";
const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

exports.ping = onCall({ region: "asia-northeast3" }, async (req) => {
    logger.info("[ping] invoked", { uid: req.auth?.uid || null });
    return { ok: true, ts: Date.now(), uid: req.auth?.uid || null };
});
