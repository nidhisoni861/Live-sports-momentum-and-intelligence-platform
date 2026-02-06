import { ConfidenceItem } from "./types";

export type Analysis = {
  videoId: string;

  summary: {
    topLabels: ConfidenceItem[];

    playerStats?: {
      maxPlayers?: number;
      avgPlayers?: number;
    };
  };

  modelInfo?: {
    provider: string;
    version: string;
  };

  analyzedAt: Date;
  createdAt: Date;
};
