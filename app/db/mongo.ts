// app/db/mongo.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables");
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;

  // eslint-disable-next-line no-var
  var _mongoIndexesReady: Promise<void> | undefined;
}

if (!global._mongoClientPromise) {
  const client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}

const clientPromise: Promise<MongoClient> = global._mongoClientPromise!;

export type VideoAnalysisDoc = {
  videoId: string;
  labels: any[];
  objects: any[];
  text: any[];
  scoreEvents?: any[];
  analyzedAt?: Date;
  createdAt?: Date;
};

export async function getDb() {
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "video-ai";
  return client.db(dbName);
}

async function ensureIndexes() {
  if (!global._mongoIndexesReady) {
    global._mongoIndexesReady = (async () => {
      const db = await getDb();

      // ✅ Professional: one doc per videoId
      await db
        .collection("videoAnalysis")
        .createIndex({ videoId: 1 }, { unique: true });

      // ✅ Helpful for sorting / browsing
      await db.collection("videoAnalysis").createIndex({ createdAt: -1 });

      console.log("🟢 [MONGO] Indexes ensured");
    })();
  }
  await global._mongoIndexesReady;
}

/**
 * Upsert by videoId so frontend always reads a single stable record.
 * Returns the raw update result plus upsertedId (if created).
 */
export async function saveVideoAnalysis(data: VideoAnalysisDoc) {
  const db = await getDb();
  await ensureIndexes();

  const doc = {
    ...data,
    createdAt: new Date(),
    _source: "analyze-video-route",
  };

  const result = await db
    .collection("videoAnalysis")
    .updateOne({ videoId: data.videoId }, { $set: doc }, { upsert: true });

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedId: (result as any).upsertedId?._id ?? null,
  };
}

export async function getVideoAnalysisById(videoId: string) {
  const db = await getDb();
  return db.collection("videoAnalysis").findOne({ videoId });
}

export default clientPromise;
