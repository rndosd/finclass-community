// Operator-wide telemetry is excluded from the community source edition.
export const trackFirestorePayload = () => {};
export const flushFirestoreTelemetry = async () => {};
export const createSnapshotTelemetryModeTracker = () => {
  let received = false;
  return (snapshot) => {
    if (snapshot?.metadata?.fromCache || snapshot?.metadata?.hasPendingWrites) return "snapshot_cache";
    const mode = received ? "snapshot_update" : "snapshot_initial";
    received = true;
    return mode;
  };
};
export const withFirestoreSnapshotTelemetry = (_options, onNext) => onNext;
