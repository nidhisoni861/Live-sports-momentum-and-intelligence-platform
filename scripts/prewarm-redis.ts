import { buildLiveStateAtTime } from "../app/db/redis-models/live";
import { getDb, COLLECTIONS } from "../app/db/models";

/**
 * Prewarm Redis timeline cache
 * - builds snapshots every STEP seconds
 */

const STEP = 5; // every 5 seconds
const MAX_DURATION = 600; // safety cap 10 minutes

async function getVideoDuration(videoId: string) {
  const db = await getDb();

  const analysis = await db
    .collection(COLLECTIONS.ANALYSIS)
    .find({ videoId })
    .sort({ analyzedAt: -1 })
    .limit(1)
    .toArray();

  if (!analysis.length) return 0;

  const analysisId = analysis[0]._id.toString();

  const lastObject = await db
    .collection(COLLECTIONS.OBJECTS)
    .find({ analysisId })
    .sort({ end: -1 })
    .limit(1)
    .toArray();

  return lastObject[0]?.end || 0;
}

async function prewarm(videoId: string) {
  console.log("🔥 Prewarming Redis for:", videoId);

  const duration = await getVideoDuration(videoId);
  const limit = Math.min(duration, MAX_DURATION);

  for (let t = 0; t <= limit; t += STEP) {
    await buildLiveStateAtTime(videoId, t);
    console.log(`✓ built t=${t}`);
  }

  console.log("✅ Prewarm complete");
}

// Read videoId from CLI
const videoId = process.argv[2];

if (!videoId) {
  console.error('Usage: npm run prewarm "VIDEO_NAME.mp4"');
  process.exit(1);
}

prewarm(videoId)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
