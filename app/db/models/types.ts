export type TimeRange = {
  start: number;
  end: number;
  duration?: number;
};

export type ConfidenceItem = {
  name: string;
  confidence: number;
};

export type ParsedScore = {
  home?: string;
  away?: string;
  scoreHome?: number;
  scoreAway?: number;
  period?: number;
};
