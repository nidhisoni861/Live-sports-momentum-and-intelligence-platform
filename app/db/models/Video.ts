export type Video = {
  videoId: string;

  metadata?: {
    source?: string;
    sport?: string;
    duration?: number;
  };

  detectedMatch?: {
    home?: string;
    away?: string;
  };

  createdAt: Date;
  updatedAt?: Date;
};
