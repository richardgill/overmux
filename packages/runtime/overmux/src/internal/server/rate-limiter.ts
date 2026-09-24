export type RateLimiter = {
  attemptsByKey: Map<string, number[]>;
  globalAttempts: number[];
  maxAttemptsPerKey: number;
  maxGlobalAttempts: number;
  maxTrackedKeys: number;
  windowMs: number;
};

export const createRateLimiter = ({
  maxAttemptsPerKey,
  maxGlobalAttempts,
  maxTrackedKeys,
  windowMs,
}: {
  maxAttemptsPerKey: number;
  maxGlobalAttempts: number;
  maxTrackedKeys: number;
  windowMs: number;
}): RateLimiter => ({
  attemptsByKey: new Map(),
  globalAttempts: [],
  maxAttemptsPerKey,
  maxGlobalAttempts,
  maxTrackedKeys,
  windowMs,
});

export const hasRateLimitCapacity = ({
  currentTime = Date.now(),
  key,
  limiter,
}: {
  currentTime?: number;
  key: string;
  limiter: RateLimiter;
}) => {
  const threshold = currentTime - limiter.windowMs;
  const recent = (limiter.attemptsByKey.get(key) ?? []).filter(
    (attempt) => attempt > threshold,
  );
  limiter.globalAttempts = limiter.globalAttempts.filter(
    (attempt) => attempt > threshold,
  );
  if (
    recent.length >= limiter.maxAttemptsPerKey ||
    limiter.globalAttempts.length >= limiter.maxGlobalAttempts
  ) {
    limiter.attemptsByKey.set(key, recent);
    return false;
  }
  limiter.attemptsByKey.set(key, [...recent, currentTime]);
  limiter.globalAttempts.push(currentTime);
  if (limiter.attemptsByKey.size > limiter.maxTrackedKeys) {
    limiter.attemptsByKey.clear();
  }
  return true;
};
