import { createFinancialRequestTracker } from "./financialRequests";

test("coalesces simultaneous submissions and reuses the original payload after uncertain failure", async () => {
  const tracker = createFinancialRequestTracker();
  let resolve;
  const original = jest.fn(() => new Promise((done) => { resolve = done; }));
  const first = tracker.run("buy-1", original);
  expect(tracker.run("buy-1", jest.fn())).toBe(first);
  await Promise.resolve();
  resolve({ success: false, code: "functions/deadline-exceeded" });
  await first;
  const id = original.mock.calls[0][0];
  original.mockResolvedValueOnce({ success: true, data: { tradeId: "trade-1" } });
  const changedQuote = jest.fn();
  await tracker.run("buy-1", changedQuote);
  expect(changedQuote).not.toHaveBeenCalled();
  expect(original.mock.calls[1][0]).toBe(id);
  expect(tracker.has("buy-1")).toBe(false);
  const next = jest.fn().mockResolvedValue({ success: true });
  await tracker.run("buy-1", next);
  expect(next.mock.calls[0][0]).not.toBe(id);
});

test("definite rejection releases the request, while a thrown network error preserves it", async () => {
  const tracker = createFinancialRequestTracker();
  const call = jest.fn().mockRejectedValueOnce(new Error("network failure"))
    .mockResolvedValueOnce({ success: false, details: { reason: "stock-price-changed" } });
  await expect(tracker.run("order", call)).rejects.toThrow("network failure");
  expect(tracker.has("order")).toBe(true);
  await tracker.run("order", call);
  expect(tracker.has("order")).toBe(false);
  expect(call.mock.calls[0][0]).toBe(call.mock.calls[1][0]);
});

test("an opted-in marketplace tracker preserves the ID through maintenance after an uncertain commit", async () => {
  const tracker = createFinancialRequestTracker({
    retainRequestOnError: (error) => error?.details?.reason === "class-maintenance",
  });
  const call = jest.fn()
    .mockRejectedValueOnce(new Error("response lost"))
    .mockRejectedValueOnce({ code: "functions/failed-precondition", details: { reason: "class-maintenance" } })
    .mockResolvedValueOnce({ success: true });
  await expect(tracker.run("purchase", call)).rejects.toThrow("response lost");
  await expect(tracker.run("purchase", call)).rejects.toMatchObject({ code: "functions/failed-precondition" });
  expect(tracker.has("purchase")).toBe(true);
  await tracker.run("purchase", call);
  expect(call.mock.calls[1][0]).toBe(call.mock.calls[0][0]);
  expect(call.mock.calls[2][0]).toBe(call.mock.calls[0][0]);
  expect(tracker.has("purchase")).toBe(false);
});
