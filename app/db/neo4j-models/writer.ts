import { getSession } from "../neo4j";

/* ===================== VIDEO ===================== */
export async function createVideo(videoId: string) {
  const session = getSession();
  try {
    await session.run(`MERGE (v:Video { videoId: $videoId })`, { videoId });
  } finally {
    await session.close();
  }
}

/* ===================== PLAYER ===================== */
export async function createPlayer(videoId: string, index: number, obj: any) {
  const session = getSession();
  const pid = `${videoId}_p${index}`;

  // Temporary but REQUIRED identity
  const name = obj.nameTag || `Player_${index}`;

  try {
    await session.run(
      `
      MATCH (v:Video { videoId: $videoId })

      MERGE (p:Player { playerId: $pid })
      SET
        p.name = $name,
        p.confidence = $confidence

      MERGE (v)-[:HAS_PLAYER]->(p)
      `,
      {
        videoId,
        pid,
        name,
        confidence: obj.confidence ?? 0,
      },
    );

    // Frame → Time graph
    for (const f of obj.frames || []) {
      const t = Math.floor(f.t);

      await session.run(
        `
        MERGE (tm:Time { t: $t })
        MATCH (p:Player { playerId: $pid })
        MERGE (p)-[:APPEARS_AT]->(tm)
        `,
        { t, pid },
      );
    }
  } finally {
    await session.close();
  }
}

/* ===================== SCORE ===================== */
export async function createScore(videoId: string, s: any) {
  if (!s?.score) return; // 🚨 prevent null scores

  const session = getSession();

  try {
    await session.run(
      `
      MATCH (v:Video { videoId: $videoId })

      CREATE (sc:Score {
        score: $score,
        start: $start,
        end: $end
      })

      MERGE (v)-[:HAS_SCORE]->(sc)
      `,
      {
        videoId,
        score: s.score,
        start: s.start ?? 0,
        end: s.end ?? s.start ?? 0,
      },
    );
  } finally {
    await session.close();
  }
}
