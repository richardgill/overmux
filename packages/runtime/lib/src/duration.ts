const durationPattern = /^([1-9]\d*)(ms|s|m|h|d)$/;
const millisecondsByUnit = {
  d: 24 * 60 * 60 * 1_000,
  h: 60 * 60 * 1_000,
  m: 60 * 1_000,
  ms: 1,
  s: 1_000,
} as const;

export const durationToMilliseconds = (duration: string) => {
  const match = durationPattern.exec(duration);
  if (!match) {
    return undefined;
  }
  const unit = match[2] as keyof typeof millisecondsByUnit;
  const milliseconds = Number(match[1]) * millisecondsByUnit[unit];
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
};
