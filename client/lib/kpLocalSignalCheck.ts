export interface KpLocalSignalSummary {
  gpsSampleCount: number;
  gpsMedianAccuracyMeters: number | null;
  magneticSampleCount: number;
  magneticMeanMicrotesla: number | null;
  magneticRangeMicrotesla: number | null;
}

function finiteNonNegativeValues(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value) && value >= 0);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function summarizeKpLocalSignalCheck(
  gpsAccuracyMeters: number[],
  magneticMagnitudesMicrotesla: number[],
): KpLocalSignalSummary {
  const gps = finiteNonNegativeValues(gpsAccuracyMeters);
  const magnetic = finiteNonNegativeValues(magneticMagnitudesMicrotesla);

  return {
    gpsSampleCount: gps.length,
    gpsMedianAccuracyMeters: median(gps),
    magneticSampleCount: magnetic.length,
    magneticMeanMicrotesla: magnetic.length > 0
      ? magnetic.reduce((sum, value) => sum + value, 0) / magnetic.length
      : null,
    magneticRangeMicrotesla: magnetic.length > 0
      ? Math.max(...magnetic) - Math.min(...magnetic)
      : null,
  };
}
