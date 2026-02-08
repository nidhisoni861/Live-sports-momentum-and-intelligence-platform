/* eslint-disable @typescript-eslint/no-explicit-any */
import { getRedis } from "../redis";
import clientPromise from "../mongo";

const key = (videoId: string, t: number) =>
  `live:video:${videoId}:t:${Math.floor(t)}`;

const labelKey = (videoId: string, t: number) =>
  `live:video:${videoId}:t:${Math.floor(t)}:labels`;

const TTL = 1200;

/* ---------- HELPERS ---------- */

function getRange(e: any) {
  const start = Number(e?.start ?? e?.timestamp ?? 0);
  const end = Number(e?.end ?? start);
  return { start, end };
}

function isInWindow(e: any, t: number) {
  const { start, end } = getRange(e);

  // If timestamps are all zero → fallback mode
  if (start === 0 && end === 0) return true;

  return start <= t && (end >= t || end === start);
}

function extractScore(text: string): string | null {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  const teamMatch = s.match(
    /(ARG|ESP|POR)\D*(\d{1,2})\D+(\d{1,2})\D*(ARG|ESP|POR)/i,
  );
  if (teamMatch) return `${teamMatch[2]}-${teamMatch[3]}`;

  const dashMatch = s.match(/(\d{1,2})\s*[- ]\s*(\d{1,2})/);
  if (dashMatch) return `${dashMatch[1]}-${dashMatch[2]}`;

  const nums = s.match(/\d{1,2}/g);
  if (nums && nums.length >= 2) return `${nums[0]}-${nums[1]}`;

  return null;
}

function isScoreboardCandidate(text: string) {
  const s = String(text || "");
  const hasTeam = /(ARG|ESP|POR)/i.test(s);
  const nums = s.match(/\d+/g) ?? [];
  return hasTeam && nums.length >= 2;
}

/* ========================================================= */

export async function buildLiveStateAtTime(videoId: string, timeSec: number) {
  const t = Math.floor(Number(timeSec) || 0);

  const redis = await getRedis();

  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "video-ai";
  const db = client.db(dbName);

  const docArr = await db
    .collection("videoAnalysis")
    .find({ videoId })
    .sort({ analyzedAt: -1 })
    .limit(1)
    .toArray();

  const doc = docArr[0];
  if (!doc) return null;

  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const ocr = Array.isArray(doc.text) ? doc.text : [];
  const labels = Array.isArray(doc.labels) ? doc.labels : [];

  /* ----- PLAYER COUNT ----- */
  const peopleOnScene = objects.filter((o: any) => {
    const name = String(o?.name ?? "")
      .trim()
      .toLowerCase();
    if (name !== "person") return false;

    const conf = Number(o?.confidence ?? 0);
    if (conf < 0.5) return false;

    const { start, end } = getRange(o);
    const dur = Math.max(0, end - start);

    return dur >= 0.5 && isInWindow(o, t);
  });

  const playerCount = Math.min(peopleOnScene.length, 14);

  /* ----- SCOREBOARD FIX ----- */

  const candidates = ocr.filter((ev: any) => isScoreboardCandidate(ev?.text));

  // Sort by confidence first since timestamps unreliable
  const best = candidates.sort(
    (a: any, b: any) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0),
  )[0];

  const scoreboardText = String(best?.text ?? "");
  const score = extractScore(scoreboardText) ?? "";

  /* ----- WRITE REDIS ----- */

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

/* ---------- READ ---------- */

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
