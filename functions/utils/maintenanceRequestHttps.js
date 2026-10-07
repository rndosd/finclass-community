"use strict";

const https = require("firebase-functions/v2/https");
const { context } = require("./classMaintenanceContext");

// Capture the request lifetime without changing existing role/class policies.
// The scoped DB adapter reads the maintenance lock inside each transaction.
const onCallWithMaintenance = (...args) => {
    const handler = args.pop();
    return https.onCall(...args, (request) => context.run({
        ...context.getStore(),
        startedAt: Date.now(),
    }, () => handler(request)));
};

module.exports = { onCallWithMaintenance };
