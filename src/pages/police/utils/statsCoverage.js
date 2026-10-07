// An explicit empty daily document is a confirmed zero; a missing document is not.
export function getPoliceStatsCoverage(dateKeys, dailyRows) {
  const byDate = new Map(dailyRows.map((row) => [row.date || row.id, row]));
  let readyDays = 0;
  let emptyDays = 0;
  for (const date of dateKeys) {
    const status = byDate.get(date)?.status;
    if (status === "ready") readyDays += 1;
    if (status === "empty") emptyDays += 1;
  }
  return {
    totalDays: dateKeys.length,
    readyDays,
    emptyDays,
    availableDays: readyDays + emptyDays,
    missingDays: dateKeys.length - readyDays - emptyDays,
  };
}
