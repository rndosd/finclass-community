// Offline review probes: real callable bodies and local business helpers,
// in-memory Firestore, synthetic identities only. No network or credentials.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { FieldValue: SdkFieldValue, FieldPath: SdkFieldPath } = require('firebase-admin/firestore');
const root = path.resolve(__dirname, '../../..');
const fixedNow = Date.parse('2026-09-08T01:00:00Z');
class ReviewDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
  toMillis() { return this.getTime(); }
  toDate() { return new Date(this.getTime()); }
}
class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const FieldValue = Object.assign(function ReviewFieldValue() {}, {
  increment: value => { SdkFieldValue.increment(value).validate(); return { __op: 'increment', value }; },
  serverTimestamp: () => new Date(fixedNow),
  delete: () => ({ __op: 'delete' }),
  arrayUnion: (...values) => ({ __op: 'arrayUnion', values }),
});
function harness(seed, { retryTransaction = false, emulatorAdmin = null } = {}) {
  if (emulatorAdmin && !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Local emulator required");
  const data = new Map(Object.entries(structuredClone(seed)));
  const reads = [];
  const writes = [];
  let autoId = 0;
  const snapshot = ref => ({ ref, id: ref.id, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  function ref(docPath) {
    return { path: docPath, id: docPath.split('/').at(-1), collection: name => collection(`${docPath}/${name}`),
      set: (payload, options) => db.runTransaction(tx => tx.set(ref(docPath), payload, options)),
      update: payload => db.runTransaction(tx => tx.update(ref(docPath), payload)),
      delete: () => db.runTransaction(tx => tx.delete(ref(docPath))),
      get: async () => { reads.push(docPath); return snapshot(ref(docPath)); } };
  }
  function collection(collectionPath, filters = [], ordering = null, maxDocs = Infinity) {
    return { path: collectionPath, doc: id => ref(`${collectionPath}/${id || `review-${++autoId}`}`),
      where: (field, operator, value) => { assert(['==', 'in', '>'].includes(operator)); return collection(collectionPath, [...filters, [field, value, operator]], ordering, maxDocs); },
      orderBy: (field, direction = 'asc') => collection(collectionPath, filters, [field, direction], maxDocs),
      limit: count => collection(collectionPath, filters, ordering, count),
      select: () => collection(collectionPath, filters, ordering, maxDocs),
      get: async () => {
      reads.push(collectionPath);
      let docs = [...data.keys()].filter(key => key.startsWith(collectionPath + '/') && key.split('/').length === collectionPath.split('/').length + 1).map(key => snapshot(ref(key))).filter(item => filters.every(([field, value, operator]) => operator === 'in' ? value.includes(item.data()?.[field]) : operator === '>' ? item.data()?.[field] > value : item.data()?.[field] === value));
      if (ordering) docs.sort((a, b) => ((a.data()?.[ordering[0]] > b.data()?.[ordering[0]]) ? 1 : -1) * (ordering[1] === 'desc' ? -1 : 1));
      docs = docs.slice(0, maxDocs);
      return { docs, empty: docs.length === 0, size: docs.length, forEach: callback => docs.forEach(callback) };
    } };
  }
  const assign = (target, key, value) => {
    const parts = Array.isArray(key) ? key : key.split('.');
    let node = target;
    for (const part of parts.slice(0, -1)) node = node[part] ||= {};
    const leaf = parts.at(-1);
    if (value?.__op === 'increment') node[leaf] = (typeof node[leaf] === 'number' ? node[leaf] : 0) + value.value;
    else if (value?.__op === 'delete') delete node[leaf];
    else if (value?.__op === 'arrayUnion') node[leaf] = [...(node[leaf] || []), ...value.values];
    else node[leaf] = structuredClone(value);
  };
  const db = { doc: ref, collection, getAll: async (...refs) => Promise.all(refs.map(target => target.get())), runTransaction: async callback => {
    const staged = [];
    const tx = {
      get: async target => { assert.equal(staged.length, 0, 'Firestore reads must precede writes'); return target.get(); },
      getAll: async (...targets) => Promise.all(targets.filter(target => typeof target.get === 'function').map(target => tx.get(target))),
      update: (target, ...args) => {
        if (args[0]?.segments) {
          const fieldUpdates = [];
          for (let i = 0; i < args.length; i += 2) fieldUpdates.push([args[i].segments, args[i + 1]]);
          staged.push({ kind: 'update', path: target.path, payload: {}, fieldUpdates });
        } else staged.push({ kind: 'update', path: target.path, payload: args[0] });
      },
      set: (target, payload, options) => staged.push({ kind: 'set', path: target.path, payload, options }),
      create: (target, payload) => staged.push({ kind: 'create', path: target.path, payload }),
      delete: target => staged.push({ kind: 'delete', path: target.path }),
    };
    if (retryTransaction) { await callback(tx); staged.length = 0; } const result = await callback(tx);
    for (const write of staged) {
      if (write.kind === 'delete') data.delete(write.path);
      else {
        if (write.kind === 'update') assert(data.has(write.path), `update missing ${write.path}`);
        if (write.kind === 'create') assert(!data.has(write.path), `create existing ${write.path}`);
        const target = (write.kind === 'update' || write.options?.merge) ? (data.get(write.path) || {}) : {};
        for (const [key, value] of Object.entries(write.payload)) assign(target, key, value);
        for (const [segments, value] of write.fieldUpdates || []) assign(target, segments, value);
        data.set(write.path, target);
      }
    }
    writes.push(...staged);
    return result;
  } };
  db.batch = () => {
    const actions = [];
    return { set: (...args) => actions.push(['set', args]), update: (...args) => actions.push(['update', args]), delete: (...args) => actions.push(['delete', args]),
      commit: () => db.runTransaction(tx => { for (const [method, args] of actions) tx[method](...args); }) };
  };
  const firestore = () => db;
  const Timestamp = { now: () => new ReviewDate(), fromDate: date => new ReviewDate(date) };
  Object.assign(firestore, { FieldValue, Timestamp, FieldPath: SdkFieldPath });
  const admin = { firestore, apps: [{}], initializeApp() {} };
  const modules = new Map();
  function load(filename) {
    const resolved = path.resolve(filename);
    if (modules.has(resolved)) return modules.get(resolved).exports;
    const module = { exports: {} };
    modules.set(resolved, module);
    const localRequire = createRequire(resolved);
    const customRequire = name => {
      if (name.endsWith('firebaseAdminCompat')) return emulatorAdmin || admin;
      if (name === 'firebase-admin/firestore') return emulatorAdmin ? localRequire(name) : { FieldValue, Timestamp };
      if (name === 'firebase-functions/v2/https') return { onCall: (...args) => args.at(-1), HttpsError };
      if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (...args) => args.at(-1) };
      if (name === 'firebase-functions/v2/firestore') return {
        onDocumentWritten: (...args) => args.at(-1), onDocumentCreated: (...args) => args.at(-1),
        onDocumentUpdated: (...args) => args.at(-1),
      };
      if (name.endsWith('/planManager')) return { getGlobalConfig: async () => ({}), canUseFeature: () => true, canUsePagePolicy: () => true };
      if (name.endsWith('/notificationUtils')) return { stageNotification() {}, scheduleReminder: async () => {} };
      // Projection maintenance is unrelated to pricing/authorization under test.
      if (name.endsWith('/stockJobIndex')) return { STOCK_JOB_INDEX_VERSION: 1, applyPortfolioIndexDelta: async () => ({ shouldRebuild: false }) };
      if (name.startsWith('.')) return load(localRequire.resolve(name));
      return localRequire(name);
    };
    const wrapper = vm.runInNewContext(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(resolved, 'utf8')}\n})`, { console, Date: ReviewDate, Buffer, process, setTimeout, clearTimeout, structuredClone, Intl }, { filename: resolved });
    wrapper(customRequire, module, module.exports, resolved, path.dirname(resolved));
    return module.exports;
  }
  return { data, reads, writes, db, admin, load: filename => load(path.join(root, filename)) };
}

module.exports = { createCallableHarness: harness };
