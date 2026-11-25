export type ExecutionOutcome = "passed" | "comparison_failed" | "execution_failed" | "partial" | "cancelled" | "pending";
const cancelled = /^(cancelled|canceled)$/i;
const failure = /auth|browserless|timeout|navigation|execution.*fail|scrape.*fail|error/i;
/** Filter read-back drift is diagnostic only — never an execution failure. */
export function isFilterVerificationError(error: unknown): boolean {
  const text = String(error ?? "").trim();
  return /^filter verification failed$/i.test(text)
    || /^(FILTER_DRIFT|FILTER_NOT_VERIFIED|FILTER_NOT_APPLIED)$/i.test(text);
}
export function executionErrors(value: unknown, depth = 0, seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object" || depth > 12 || seen.has(value)) return [];
  seen.add(value);
  const node = value as Record<string, any>;
  const errors: string[] = [];
  const own = node.ok === false
    ? String(node.error || node.message || "Execution failed")
    : (typeof node.error === "string" && node.error.trim() ? node.error.trim() : "");
  if (own && !isFilterVerificationError(own)) errors.push(own);
  // filter_verification is informational only — never an execution failure.
  for (const [key, child] of Object.entries(node)) {
    // Business data/table cells are not execution metadata.
    // filter_verification / filters_applied are informational only.
    if (["rows", "data", "headers", "columns", "diff", "filter_verification", "filters_applied", "requested_filters"].includes(key)) continue;
    if (child && typeof child === "object") errors.push(...executionErrors(child, depth + 1, seen));
  }
  return errors;
}
export function deriveExecutionOutcome(row: any, comparison: "pass" | "fail" | "pending"): ExecutionOutcome {
  const statuses = [row?.status, row?.actual?.execution_status, row?.expected?.execution_status,
    row?.actual?.execution?.failure_category, row?.actual?.execution?.status,
    row?.expected?.execution?.failure_category, row?.diff?.__execution?.failure_category].map(s => String(s ?? ""));
  const execErrs = [...executionErrors(row?.actual), ...executionErrors(row?.expected)];
  if (statuses.some(s => cancelled.test(s))) return "cancelled";
  if (statuses.some(s => failure.test(s)) || execErrs.length) return "execution_failed";
  // Clean compare wins over stale partial_extraction / filter-verification noise.
  if (comparison === "pass" && !execErrs.length) return "passed";
  if (statuses.some(s => /partial/i.test(s))) return "partial";
  if (statuses.some(s => /^(pending|running|queued|unresolved|unexecuted)$/i.test(s))) return "pending";
  return comparison === "pass" ? "passed" : comparison === "fail" ? "comparison_failed" : "pending";
}
export function outcomeStatus(outcome: ExecutionOutcome): "pass" | "fail" | "pending" {
  return outcome === "passed" ? "pass" : outcome === "pending" ? "pending" : "fail";
}
export function outcomeCounts(outcomes: ExecutionOutcome[]) {
  const count = (outcome: ExecutionOutcome) => outcomes.filter(o => o === outcome).length;
  const passed = count("passed"), comparison_failed = count("comparison_failed"), execution_failed = count("execution_failed"), partial = count("partial"), cancelledCount = count("cancelled"), pending = count("pending");
  return { passed, comparison_failed, execution_failed, partial, cancelled: cancelledCount, pending, unresolved: pending, pass: passed, fail: comparison_failed + execution_failed + partial, total: outcomes.length };
}