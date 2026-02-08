/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient } from "mongodb";

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

/* =========================================================
   OPTION A – RAW CLOUD STORAGE (SINGLE DOCUMENT)
   ========================================================= */

/**
 * Store the Cloud response EXACTLY as received.
 * No normalization, no flattening.
 */
export async function saveVideoAnalysis(input: {
  videoId: string;

  // raw cloud fields
  filename: string;
  analyzedAt: Date;

  summary: any;
  objects: any[];
  text: any[];
}) {
  const db = await getDb();

  await db.collection("videoAnalysisRaw").updateOne(
    { filename: input.filename },
    {
      $set: {
        filename: input.filename,
        analyzedAt: input.analyzedAt,

        summary: input.summary,
        objects: input.objects,
        text: input.text,

        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return { ok: true };
}

/**
 * Read EXACTLY the same document back.
 */
export async function getVideoAnalysisById(videoId: string) {
  const db = await getDb();

  const doc = await db
    .collection("videoAnalysisRaw")
    .findOne({ filename: videoId });

  if (!doc) return null;

  // return as-is (minus Mongo internal _id)
  const { _id, ...rest } = doc;
  return rest;
}

/* compatibility alias */
export { saveVideoAnalysis as saveAnalyzedVideo };
