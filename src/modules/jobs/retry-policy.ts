export type RetryPolicyOptions = {
  baseDelayMs?: number;
  maximumDelayMs?: number;
  random?: () => number;
};

export function retryDelayMs(retryCount: number, options: RetryPolicyOptions = {}): number {
  const base = options.baseDelayMs ?? 5_000;
  const maximum = options.maximumDelayMs ?? 15 * 60_000;
  const random = options.random ?? Math.random;
  const exponential = Math.min(maximum, base * (3 ** Math.max(0, retryCount - 1)));
  const jitter = Math.floor(exponential * 0.1 * Math.min(1, Math.max(0, random())));
  return Math.min(maximum, exponential + jitter);
}
