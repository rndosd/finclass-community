function getAlwaysMissionLastAttempts(mission) {
  const nested =
    mission?.lastAttempts && typeof mission.lastAttempts === "object"
      ? mission.lastAttempts
      : {};

  const fromFlat = Object.entries(mission || {}).reduce((acc, [key, value]) => {
    const match = /^lastAttempts\.([^.]+)$/.exec(key);
    if (match) {
      acc[match[1]] = value;
    }
    return acc;
  }, {});

  return { ...fromFlat, ...nested };
}

export function getAlwaysMissionPendingCount(mission) {
  if (mission?.autoApprove) return 0;

  const statsPending = Number(
    mission?.stats?.pendingCount ?? mission?.["stats.pendingCount"] ?? 0,
  );
  const latestPending = Object.values(getAlwaysMissionLastAttempts(mission)).filter(
    (attempt) => attempt?.status === "pending",
  ).length;

  return Math.max(statsPending, latestPending);
}

export function getAlwaysMissionPendingTotal(missions = []) {
  if (!Array.isArray(missions)) return 0;

  return missions.reduce(
    (total, mission) => total + getAlwaysMissionPendingCount(mission),
    0,
  );
}
