// app/db/neo4j-models/schema.ts

export type NeoVideo = {
  videoId: string;
  analyzedAt: Date;
};

export type NeoLabel = {
  name: string;
  confidence: number;
};

export type NeoObject = {
  type: string;
};

export type NeoEvent = {
  type: "SCORE_CHANGE" | "OCR" | "OBJECT_SPIKE";
  time: number;
  score?: string;
};

export type NeoText = {
  value: string;
};
