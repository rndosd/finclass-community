"use strict";
const scheduler = require("firebase-functions/v2/scheduler");
const { context } = require("./classMaintenanceContext");
module.exports = {
    ...scheduler,
    onSchedule: (...args) => {
        const handler = args.pop();
        return scheduler.onSchedule(...args, (...handlerArgs) => context.run({ startedAt: Date.now() }, () => handler(...handlerArgs)));
    },
};
