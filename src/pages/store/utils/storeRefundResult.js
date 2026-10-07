export const isBulkRefundSuccessful = (data) => {
  if (!data || data.taxRecordError) return false;
  if (typeof data.failedCount === "number") {
    return data.failedCount === 0 && Number(data.successCount) > 0 && data.allSucceeded !== false;
  }
  return data.allSucceeded === true || data.success === true;
};
