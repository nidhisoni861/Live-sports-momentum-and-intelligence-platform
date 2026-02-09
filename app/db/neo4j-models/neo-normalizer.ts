import { createVideo, createPlayer, createScore } from "./writer";

/**
 * Writes a simple video graph:
 * - Video node
 * - Player nodes derived from objects where name === "person"
 * - Score nodes derived from scoreEvents where score is a valid "X-Y"
 */
export async function normalizeToNeo4jGraph(data: {
  videoId: string;
  objects: any[];
  scoreEvents?: any[];
}) {
  const { videoId, objects, scoreEvents = [] } = data;

  // 1) Video node
  await createVideo(videoId);

  // 2) Players from PERSON objects (anonymous, but ensure name is never null)
  const persons = (objects ?? []).filter((o) => o?.name === "person");

  for (let i = 0; i < persons.length; i++) {
    // createPlayer should store at least:
    // playerId, name (fallback), confidence, and optionally start/end
    await createPlayer(videoId, i, persons[i]);
  }

  // 3) Scores (only write valid scores)
  for (const s of scoreEvents ?? []) {
    const rawScore = s?.score ?? null;

    // Only accept patterns like "0-2", "10-9"
    const score =
      typeof rawScore === "string" && /^\d{1,2}-\d{1,2}$/.test(rawScore)
        ? rawScore
        : null;

    if (!score) continue;

    await createScore(videoId, {
      ...s,
      score, // ensure non-null
    });
  }
}
