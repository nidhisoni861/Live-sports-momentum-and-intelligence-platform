import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI as string;

if (!uri) {
  throw new Error("❌ MONGODB_URI is not defined in environment variables");
}

/**
 * Global cached MongoDB connection
 * Prevents multiple connections during Next.js hot reloads
 */
let client: MongoClient;
let clientPromise: Promise<MongoClient>;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (!global._mongoClientPromise) {
  client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}

clientPromise = global._mongoClientPromise;

/* =========================================================
   DATA ACCESS LAYER
   ========================================================= */

/**
 * Save video analysis result to MongoDB
 */
export async function saveVideoAnalysis(data: {
  videoId: string;
  labels: any[];
  objects: any[];
  text: any[];
  analyzedAt?: Date;
}) {
  const client = await clientPromise;
  const db = client.db("video-ai");

  return db.collection("videoAnalysis").insertOne({
    ...data,
    createdAt: new Date(),
  });
}

/**
 * Get video analysis by videoId
 */
export async function getVideoAnalysisById(videoId: string) {
  const client = await clientPromise;
  const db = client.db("video-ai");

  return db.collection("videoAnalysis").findOne({ videoId });
}

export default clientPromise;
