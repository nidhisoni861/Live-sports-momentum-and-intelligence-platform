import { ParsedScore } from "./types";

export type OcrEvent = {
  videoId: string;
  analysisId?: string;

  text: string;
  confidence: number;

  parsed?: ParsedScore;

  timestamp: number;
};
