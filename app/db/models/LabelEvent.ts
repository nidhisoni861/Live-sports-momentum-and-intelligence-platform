import { TimeRange } from "./types";

export type LabelEvent = {
  videoId: string;
  analysisId?: string;

  name: string;
  confidence: number;

  timeRange?: TimeRange;
};
