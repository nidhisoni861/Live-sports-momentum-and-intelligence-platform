import clientPromise from "../mongo";
import { Video } from "./Video";
import { Analysis } from "./Analysis";
import { ObjectSegment } from "./ObjectSegment";
import { OcrEvent } from "./OcrEvent";
import { LabelEvent } from "./LabelEvent";

export async function getDb() {
  const client = await clientPromise;
  return client.db("video-ai");
}

export const COLLECTIONS = {
  VIDEO: "videos",
  ANALYSIS: "analyses",
  OBJECTS: "objectSegments",
  OCR: "ocrEvents",
  LABELS: "labelEvents",
};

/**
 * NEW PROFESSIONAL SAVE PIPELINE
 */
export async function saveAnalyzedVideo(input: {
  videoId: string;
  labels: any[];
  objects: any[];
  text: any[];
}) {
  const db = await getDb();

  // 1) Create/Upsert Video
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

  // 2) Create Analysis record
  const analysis: Analysis = {
    videoId: input.videoId,
    summary: {
      topLabels: input.labels.slice(0, 10),
    },
    analyzedAt: new Date(),
    createdAt: new Date(),
  };

  const analysisRes = await db
    .collection(COLLECTIONS.ANALYSIS)
    .insertOne(analysis);

  const analysisId = analysisRes.insertedId.toString();

  // 3) Objects → separate docs
  const objectDocs: ObjectSegment[] = input.objects.map((o) => ({
    videoId: input.videoId,
    analysisId,
    name: o.name,
    confidence: o.confidence,
    time: {
      start: o.start || 0,
      end: o.end || 0,
    },
  }));

  if (objectDocs.length) {
    await db.collection(COLLECTIONS.OBJECTS).insertMany(objectDocs);
  }

  // 4) OCR events
  const ocrDocs: OcrEvent[] = input.text.map((t) => ({
    videoId: input.videoId,
    analysisId,
    text: t.text || t,
    confidence: t.confidence || 0,
    timestamp: t.timestamp || 0,
  }));

  if (ocrDocs.length) {
    await db.collection(COLLECTIONS.OCR).insertMany(ocrDocs);
  }

  // 5) Label events
  const labelDocs: LabelEvent[] = input.labels.map((l) => ({
    videoId: input.videoId,
    analysisId,
    name: l.name,
    confidence: l.confidence,
  }));

  if (labelDocs.length) {
    await db.collection(COLLECTIONS.LABELS).insertMany(labelDocs);
  }

  return { analysisId };
}
