/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables");
}

/**
 * Global cached MongoDB connection
 * Prevents multiple connections during Next.js hot reloads
 */
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
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
  scoreEvents?: any[]; // optional timeline scores
  analyzedAt?: Date;
  createdAt?: Date;
};

/** ✅ Exported so other modules (normalizer) can reuse the same DB connection */
export async function getDb() {
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "video-ai";
  return client.db(dbName);
}

// Ensure indexes once per process (hot-reload safe)
declare global {
  // eslint-disable-next-line no-var
  var _mongoIndexesReady: Promise<void> | undefined;
}

async function ensureIndexes() {
  if (!global._mongoIndexesReady) {
    global._mongoIndexesReady = (async () => {
      const db = await getDb();
      await db.collection("videoAnalysis").createIndex({ videoId: 1 });
      await db.collection("videoAnalysis").createIndex({ createdAt: -1 });
      console.log("🟢 [MONGO] Indexes ensured");
    })();
  }
  await global._mongoIndexesReady;
}

export async function saveVideoAnalysis(data: VideoAnalysisDoc) {
  console.log("🟡 [MONGO] saveVideoAnalysis CALLED");
  console.log("🟡 [MONGO] videoId:", data.videoId);

  try {
    const db = await getDb();
    const dbName = process.env.MONGODB_DB || "video-ai";
    console.log("🟡 [MONGO] Using DB:", dbName);

    await ensureIndexes();

    const doc = {
      ...data,
      createdAt: new Date(),
      _source: "analyze-video-route",
    };

    const result = await db.collection("videoAnalysis").insertOne(doc);

    console.log("🟢 [MONGO] INSERT SUCCESS:", result.insertedId);

    const check = await db
      .collection("videoAnalysis")
      .findOne({ _id: result.insertedId });

    console.log("🟢 [MONGO] VERIFY READ:", check ? "FOUND" : "NOT FOUND");

    return result;
  } catch (err: any) {
    console.error("🔴 [MONGO] INSERT FAILED:", err?.message || err);
    throw err;
  }
}

export async function getVideoAnalysisById(videoId: string) {
  const db = await getDb();
  return db.collection("videoAnalysis").findOne({ videoId });
}

export default clientPromise;
