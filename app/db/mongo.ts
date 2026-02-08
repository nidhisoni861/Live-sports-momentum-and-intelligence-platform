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

/**
 * Ensure indexes once per process (hot-reload safe).
 * - Never crashes your API (best-effort)
 * - Handles legacy index-name conflicts
 * - Creates indexes only if missing
 */
async function ensureIndexes() {
  if (!global._mongoIndexesReady) {
    global._mongoIndexesReady = (async () => {
      const db = await getDb();
      const col = db.collection("videoAnalysis");

      try {
        const indexes = await col.indexes();

        // If old auto-generated index exists but isn't unique, drop it
        const old = indexes.find((i) => i.name === "videoId_1");
        if (old && !old.unique) {
          await col.dropIndex("videoId_1");
        }

        // Create unique index only if missing
        const hasVideoUnique = indexes.some((i) => i.name === "videoId_unique");
        if (!hasVideoUnique) {
          await col.createIndex(
            { videoId: 1 },
            { unique: true, name: "videoId_unique" },
          );
        }

        // Create createdAt index only if missing
        const hasCreatedAt = indexes.some((i) => i.name === "createdAt_desc");
        if (!hasCreatedAt) {
          await col.createIndex({ createdAt: -1 }, { name: "createdAt_desc" });
        }

        console.log("🟢 [MONGO] Indexes ensured");
      } catch (e: any) {
        // ✅ critical: do not kill POST because of index issues
        console.warn("⚠ [MONGO] ensureIndexes skipped:", e?.message || e);
      }
    })();
  }

  await global._mongoIndexesReady;
}

/**
 * Upsert by videoId so frontend always reads a single stable record.
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
