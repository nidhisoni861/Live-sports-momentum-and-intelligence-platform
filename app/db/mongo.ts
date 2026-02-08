// app/db/mongo.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
console.log("Mongo URI:", process.env.MONGODB_URI);
console.log("Mongo DB:", process.env.MONGODB_DB || "video-ai");

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables");
}

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
  scoreEvents?: any[];
  analyzedAt?: Date;
  createdAt?: Date;
};

export async function getDb() {
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "video-ai";
  return client.db(dbName);
}

/* ======================================================
   SAFE INDEX ENSURE – NO CACHING, NO CRASH ON DUPLICATES
   ====================================================== */
async function ensureIndexes() {
  const db = await getDb();
  const collection = db.collection("videoAnalysis");

  console.log("==== RUNTIME DB CHECK FROM APP ====");
  console.log("DB NAME:", db.databaseName);

  const count = await collection.countDocuments();
  console.log("DOC COUNT FROM APP:", count);

  const allDocs = await collection.find({}).limit(5).toArray();
  console.log("SAMPLE DOCS FROM APP:", allDocs);

  try {
    await collection.createIndex({ videoId: 1 }, { unique: true });
    await collection.createIndex({ createdAt: -1 });

    console.log("🟢 [MONGO] Indexes ensured (safe)");
  } catch (err: any) {
    // DO NOT CRASH ON DUPLICATE OR EXISTING INDEX
    if (err.code === 11000 || err.codeName === "DuplicateKey") {
      console.warn(
        "⚠ Index already exists or previous build conflict – skipping",
      );
      return;
    }

    console.error("❌ Index creation failed:", err);
    throw err;
  }
}

/* ======================================================
   UPSERT LOGIC – CREATED AT ONLY ON INSERT
   ====================================================== */
export async function saveVideoAnalysis(data: VideoAnalysisDoc) {
  const db = await getDb();

  // ensure indexes but never crash the request
  await ensureIndexes().catch((e) =>
    console.warn("Index ensure skipped due to:", e?.message),
  );

  const result = await db.collection("videoAnalysis").updateOne(
    { videoId: data.videoId },
    {
      $set: {
        ...data,
        updatedAt: new Date(),
        _source: "analyze-video-route",
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

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
