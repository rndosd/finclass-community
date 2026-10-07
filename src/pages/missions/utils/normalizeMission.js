// src/pages/missions/utils/normalizeMission.js
export function normalizeMission(raw, opts = {}) {
  const { selfUid } = opts;
  const data = { ...raw };

  if (!data.completions || typeof data.completions !== "object") {
    data.completions = {};
  }
  if (!data.stats || typeof data.stats !== "object") {
    data.stats = {};
  }
  if (!data.lastAttempts || typeof data.lastAttempts !== "object") {
    data.lastAttempts = {};
  }

  for (const [key, value] of Object.entries(raw || {})) {
    const completionMatch = /^completions\.([^.]+)\.(.+)$/.exec(key);
    if (completionMatch) {
      const [, uid, field] = completionMatch;
      data.completions[uid] = {
        ...(data.completions[uid] || {}),
        [field]: value,
      };
      delete data[key];
      continue;
    }

    const statsMatch = /^stats\.(.+)$/.exec(key);
    if (statsMatch) {
      const [, field] = statsMatch;
      data.stats[field] = value;
      delete data[key];
      continue;
    }

    const lastAttemptsMatch = /^lastAttempts\.([^.]+)$/.exec(key);
    if (lastAttemptsMatch) {
      const [, uid] = lastAttemptsMatch;
      data.lastAttempts[uid] = value;
      delete data[key];
    }
  }

  if (selfUid && data.completions[selfUid]) {
    data._completion = data.completions[selfUid];
  }

  return data;
}
