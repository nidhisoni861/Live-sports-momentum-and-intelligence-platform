import { getNeo4jSession } from "../neo4j";

/* ===============================
   GRAPH READ QUERIES
================================= */

/**
 * Get all labels connected to a video
 */
export async function getVideoGraph(videoId: string) {
  const session = getNeo4jSession("READ");

  try {
    const result = await session.run(
      `
      MATCH (v:Video {videoId: $videoId})
      OPTIONAL MATCH (v)-[r:HAS_LABEL]->(l:Label)
      RETURN v, collect({label:l, rel:r}) as labels
      `,
      { videoId },
    );

    return result.records.map((r) => ({
      video: r.get("v").properties,
      labels: r.get("labels").map((x: any) => ({
        name: x.label.properties.name,
        confidence: x.rel.properties.confidence,
      })),
    }))[0];
  } finally {
    await session.close();
  }
}

/**
 * Get score timeline from graph
 */
export async function getScoreTimeline(videoId: string) {
  const session = getNeo4jSession("READ");

  try {
    const result = await session.run(
      `
      MATCH (v:Video {videoId: $videoId})
      MATCH (v)-[:HAS_SCORE]->(s:ScoreEvent)
      RETURN s.score as score,
             s.timestamp as timestamp
      ORDER BY s.timestamp
      `,
      { videoId },
    );

    return result.records.map((r) => ({
      score: r.get("score"),
      timestamp: r.get("timestamp"),
    }));
  } finally {
    await session.close();
  }
}

/**
 * Find label relationships (co-occurrence)
 */
export async function getLabelConnections(videoId: string) {
  const session = getNeo4jSession("READ");

  try {
    const result = await session.run(
      `
      MATCH (v:Video {videoId: $videoId})-[:HAS_LABEL]->(l1:Label)
      MATCH (v)-[:HAS_LABEL]->(l2:Label)
      WHERE l1.name < l2.name
      RETURN l1.name as A,
             l2.name as B,
             count(*) as weight
      ORDER BY weight DESC
      `,
      { videoId },
    );

    return result.records.map((r) => ({
      A: r.get("A"),
      B: r.get("B"),
      weight: r.get("weight"),
    }));
  } finally {
    await session.close();
  }
}
