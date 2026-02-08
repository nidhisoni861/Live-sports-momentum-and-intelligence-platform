/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient } from "mongodb";

import { Video } from "./models/Video";
import { Analysis } from "./models/Analysis";
import { ObjectSegment } from "./models/ObjectSegment";
import { OcrEvent } from "./models/OcrEvent";
import { LabelEvent } from "./models/LabelEvent";

/* =========================================================
   CONNECTION SINGLETON (Next.js safe)
   ========================================================= */

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not defined");
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (!global._mongoClientPromise) {
  const client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}

const clientPromise = global._mongoClientPromise;

export async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB || "video-ai");
}

/* ========================================================= */

export const COLLECTIONS = {
  VIDEO: "videos",
  ANALYSIS: "analyses",
  OBJECTS: "objectSegments",
  OCR: "ocrEvents",
  LABELS: "labelEvents",
};

/* =========================================================
   SAVE PIPELINE – FINAL
   ========================================================= */

export async function saveVideoAnalysis(input: {
  videoId: string;
  labels: any[];
  objects: any[];
  text: any[];
  scoreEvents?: any[];
  analyzedAt?: Date;
}) {
  const db = await getDb();

  /* ----- Video ----- */
  const video: Video = {
    videoId: input.videoId,
    createdAt: new Date(),
  };

  await db
    .collection(COLLECTIONS.VIDEO)
    .updateOne(
      { videoId: input.videoId },
      { $setOnInsert: video },
      { upsert: true },
    );

  /* ----- Analysis ----- */
  const analysis: Analysis = {
    videoId: input.videoId,
    summary: {
      topLabels: input.labels.slice(0, 10),
    },
    analyzedAt: input.analyzedAt ?? new Date(),
    createdAt: new Date(),
  };

  const analysisRes = await db
    .collection(COLLECTIONS.ANALYSIS)
    .insertOne(analysis);

  const analysisId = analysisRes.insertedId.toString();

  /* ----- Objects (WITH FRAMES) ----- */
  const objectDocs: ObjectSegment[] = input.objects.map((o: any) => ({
    videoId: input.videoId,
    analysisId,

    name: o.type ?? o.name ?? "",
    entityId: o.entityId ?? null,

    confidence: Number(o?.confidence ?? 0),

    time: {
      start: Number(o?.segment?.start ?? o?.start ?? 0),
      end: Number(o?.segment?.end ?? o?.end ?? o?.start ?? 0),
    },

    frames: Array.isArray(o?.frames)
      ? o.frames.map((f: any) => ({
          t: Number(f?.t ?? 0),
          box: {
            left: Number(f?.box?.left ?? 0),
            top: Number(f?.box?.top ?? 0),
            right: Number(f?.box?.right ?? 0),
            bottom: Number(f?.box?.bottom ?? 0),
          },
        }))
      : [],

    trackId: o?.trackId?.toString(),
  }));

  if (objectDocs.length) {
    await db.collection(COLLECTIONS.OBJECTS).insertMany(objectDocs);
  }

  /* ----- OCR ----- */
  const ocrDocs: OcrEvent[] = (input.text ?? []).map((t: any) => ({
    videoId: input.videoId,
    analysisId,
    text: t.text || t,
    confidence: t.confidence || 0,
    timestamp: t.timestamp || 0,
  }));

  if (ocrDocs.length) {
    await db.collection(COLLECTIONS.OCR).insertMany(ocrDocs);
  }

  /* ----- Labels ----- */
  const labelDocs: LabelEvent[] = (input.labels ?? []).map((l: any) => ({
    videoId: input.videoId,
    analysisId,
    name: l.name,
    confidence: l.confidence,
  }));

  if (labelDocs.length) {
    await db.collection(COLLECTIONS.LABELS).insertMany(labelDocs);
  }

  return {
    analysisId,
    insertedObjects: objectDocs.length,
  };
}

/* =========================================================
   READ HELPER
   ========================================================= */

export async function getVideoAnalysisById(videoId: string) {
  const db = await getDb();

  const analysis = await db
    .collection(COLLECTIONS.ANALYSIS)
    .findOne({ videoId });

  if (!analysis) return null;

  const objects = await db
    .collection(COLLECTIONS.OBJECTS)
    .find({ videoId })
    .toArray();

  const labels = await db
    .collection(COLLECTIONS.LABELS)
    .find({ videoId })
    .toArray();

  const ocr = await db.collection(COLLECTIONS.OCR).find({ videoId }).toArray();

  return {
    ...analysis,
    objects,
    labels,
    ocr,
  };
}

/* compatibility */
export { saveVideoAnalysis as saveAnalyzedVideo };
