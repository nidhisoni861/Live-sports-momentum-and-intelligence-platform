import { TimeRange } from "./types";

export type ObjectSegment = {
  videoId: string;
  analysisId?: string;

  name: string;
  confidence: number;

  time: TimeRange;

  trackId?: string;
};
