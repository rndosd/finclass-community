"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
const runMaintenance = (classId, callback) => context.run({ maintenanceClassId: classId }, callback);
module.exports = { context, runMaintenance };
