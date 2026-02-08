import { TimeRange } from "./types";

export type BoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ObjectFrame = {
  t: number;
  box: BoundingBox;
};

export type ObjectSegment = {
  videoId: string;
  analysisId?: string;

  name: string;
  entityId?: string | null;

  confidence: number;

  time: TimeRange;

  frames: ObjectFrame[];

  trackId?: string;
};
