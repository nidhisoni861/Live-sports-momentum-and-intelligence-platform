import { getRedis } from "../redis";
import { getDb, COLLECTIONS } from "../models";

const key = (videoId: string, t: number) =>
  `live:video:${videoId}:t:${Math.floor(t)}`;

const labelKey = (videoId: string, t: number) =>
  `live:video:${videoId}:t:${Math.floor(t)}:labels`;

const TTL = 360; // short TTL for live timeline

/* ---------- HELPERS ---------- */

function getRange(e: any): { start: number; end: number } {
  const start = Number(e?.start ?? e?.timestamp ?? 0);
  const end = Number(e?.end ?? start); // if no end, treat as point
  return { start, end };
}

function isInWindow(e: any, t: number): boolean {
  const { start, end } = getRange(e);
  // allow point events (start==end) and ranged events
  return start <= t && (end >= t || end === start);
}

/**
 * Robust score extraction:
 * - works for: "ARG 0 2 POR", "ARG 0-2 POR", "2 ARG 0 2 POR", "ARG 0 2 PORS"
 * - prefers the two numbers BETWEEN team tokens if present
 */
function extractScore(text: string): string | null {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  // team-based pattern (best)
  const teamMatch = s.match(
    /(ARG|ESP|POR)\D*(\d{1,2})\D+(\d{1,2})\D*(ARG|ESP|POR)/i,
  );
  if (teamMatch) return `${teamMatch[2]}-${teamMatch[3]}`;

  // generic 0-2 / 0 2 / 0 - 2
  const dashMatch = s.match(/(\d{1,2})\s*[- ]\s*(\d{1,2})/);
  if (dashMatch) return `${dashMatch[1]}-${dashMatch[2]}`;

  // fallback: first two numbers in string
  const nums = s.match(/\d{1,2}/g);
  if (nums && nums.length >= 2) return `${nums[0]}-${nums[1]}`;

  return null;
}

/**
 * Scoreboard candidates:
 * - must contain a team token (ARG/ESP/POR) AND at least two numbers
 * - avoids picking "1st PERIOD" type OCR
 */
function isScoreboardCandidate(text: string) {
  const s = String(text || "");
  const hasTeam = /(ARG|ESP|POR)/i.test(s);
  const nums = s.match(/\d+/g) ?? [];
  return hasTeam && nums.length >= 2;
}

/* =========================================================
   BUILD LIVE STATE AT SPECIFIC TIME
   ========================================================= */
export async function buildLiveStateAtTime(videoId: string, timeSec: number) {
  const t = Math.floor(Number(timeSec) || 0);

  const db = await getDb();
  const redis = await getRedis();

  // Latest analysis doc for this video
  const analysisArr = await db
    .collection(COLLECTIONS.ANALYSIS)
    .find({ videoId })
    .sort({ analyzedAt: -1 })
    .limit(1)
    .toArray();

  if (!analysisArr.length) return null;

  const analysisId = analysisArr[0]._id.toString();

  // Pull related docs (do NOT filter by timestamp in query, because older data may have timestamp=0)
  const [objects, ocr, labels] = await Promise.all([
    db.collection(COLLECTIONS.OBJECTS).find({ analysisId }).toArray(),
    db.collection(COLLECTIONS.OCR).find({ analysisId }).toArray(),
    db.collection(COLLECTIONS.LABELS).find({ analysisId }).toArray(),
  ]);

  /* ----- PLAYER COUNT (time-aware + cap) ----- */
  const peopleOnScene = objects.filter((o: any) => {
    if (o?.name !== "person") return false;
    const { start, end } = getRange(o);
    const dur = Math.max(0, end - start);
    return dur >= 2 && isInWindow(o, t);
  });

  // many "person" tracks include crowd; keep it realistic for futsal
  const playerCount = Math.min(peopleOnScene.length, 14);

  /* ----- SCOREBOARD (time-aware) ----- */
  const candidates = ocr
    .filter((ev: any) => isScoreboardCandidate(ev?.text))
    .filter((ev: any) => isInWindow(ev, t));

  // Choose current scoreboard:
  // 1) latest start time within window
  // 2) highest confidence
  // 3) longest end time
  const best = candidates.sort((a: any, b: any) => {
    const ra = getRange(a);
    const rb = getRange(b);

    if (rb.start !== ra.start) return rb.start - ra.start;
    const cb = Number(b?.confidence ?? 0);
    const ca = Number(a?.confidence ?? 0);
    if (cb !== ca) return cb - ca;
    return rb.end - ra.end;
  })[0];

  const scoreboardText = String(best?.text ?? "");
  const score = scoreboardText ? (extractScore(scoreboardText) ?? "") : "";

  /* ----- WRITE REDIS (atomic-ish) ----- */
  const k = key(videoId, t);
  const lk = labelKey(videoId, t);

  const pipeline = redis.multi();

  pipeline.hSet(k, {
    videoId,
    t: String(t),
    playerCount: String(playerCount),
    scoreboard: scoreboardText,
    score,
    lastUpdated: new Date().toISOString(),
  });
  pipeline.expire(k, TTL);

  pipeline.del(lk);

  const sortedLabels = [...labels].sort(
    (a: any, b: any) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0),
  );

  for (const l of sortedLabels.slice(0, 5)) {
    pipeline.zAdd(lk, {
      score: Number(l?.confidence ?? 0),
      value: String(l?.name ?? ""),
    });
  }
  pipeline.expire(lk, TTL);

  await pipeline.exec();

  return { score, scoreboard: scoreboardText };
}

/* ---------- READ STATE ---------- */

export async function getLiveStateAtTime(videoId: string, timeSec: number) {
  const t = Math.floor(Number(timeSec) || 0);

  const redis = await getRedis();
  const data = await redis.hGetAll(key(videoId, t));
  if (!data || !data.videoId) return null;

  const labels = await redis.zRangeWithScores(labelKey(videoId, t), 0, -1);

  return {
    ...data,
    playerCount: Number(data.playerCount || 0),
    t: Number(data.t || 0),
    labels,
  };
}
