/* eslint-disable @typescript-eslint/no-explicit-any */
import neo4j, { Driver } from "neo4j-driver";

const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) {
  throw new Error("NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD must be set");
}

declare global {
  // eslint-disable-next-line no-var
  var _neo4jDriver: Driver | undefined;
}

function getDriver(): Driver {
  if (!global._neo4jDriver) {
    global._neo4jDriver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
      { maxConnectionPoolSize: 10 },
    );
  }
  return global._neo4jDriver;
}

export async function runCypher<T = any>(
  query: string,
  params: Record<string, any> = {},
): Promise<T[]> {
  const driver = getDriver();
  const session = driver.session();
  try {
    const res = await session.run(query, params);
    return res.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

/* =========================================================
   EASY GRAPH UPSERT:
   Video → Analysis → (Label/Object/OCR)
   ========================================================= */

export async function upsertAnalysisGraph(input: {
  videoId: string;
  analyzedAtISO: string;

  // keep small/flat
  labels: { description: string; confidence: number; categories?: string[] }[];
  objectTypes: string[]; // e.g. ["person","ball"]
  ocrTexts: string[]; // keep only top N short strings
}) {
  const q = `
MERGE (v:Video {videoId: $videoId})
ON CREATE SET v.createdAt = datetime()
SET v.updatedAt = datetime()

CREATE (a:Analysis {analysisId: randomUUID(), analyzedAt: datetime($analyzedAtISO)})
MERGE (v)-[:HAS_ANALYSIS]->(a)

// Labels
WITH a
UNWIND $labels AS l
MERGE (lab:Label {description: l.description})
SET lab.updatedAt = datetime()
MERGE (a)-[r:HAS_LABEL]->(lab)
SET r.confidence = l.confidence

// Object types
WITH a
UNWIND $objectTypes AS ot
WITH a, trim(toLower(ot)) AS otn
WHERE otn <> ""
MERGE (obj:ObjectType {name: otn})
SET obj.updatedAt = datetime()
MERGE (a)-[:HAS_OBJECT_TYPE]->(obj)

// OCR strings (small)
WITH a
UNWIND $ocrTexts AS txt
WITH a, txt WHERE txt IS NOT NULL AND trim(txt) <> ""
MERGE (t:OcrText {text: txt})
SET t.updatedAt = datetime()
MERGE (a)-[:HAS_OCR_TEXT]->(t)

RETURN v.videoId AS videoId, a.analysisId AS analysisId
`;

  const rows = await runCypher<{ videoId: string; analysisId: string }>(q, {
    videoId: input.videoId,
    analyzedAtISO: input.analyzedAtISO,
    labels: input.labels ?? [],
    objectTypes: input.objectTypes ?? [],
    ocrTexts: input.ocrTexts ?? [],
  });

  return rows[0] ?? null;
}

/* =========================================================
   EASY QUERIES
   ========================================================= */

// Videos that contain ALL given object types (e.g. ["person","ball"])
export async function findVideosByObjectTypes(objectTypes: string[]) {
  const q = `
WITH [x IN $objectTypes | trim(toLower(x))] AS wanted
MATCH (v:Video)-[:HAS_ANALYSIS]->(a:Analysis)-[:HAS_OBJECT_TYPE]->(o:ObjectType)
WITH v, collect(DISTINCT o.name) AS have, wanted
WHERE ALL(x IN wanted WHERE x IN have)
RETURN v.videoId AS videoId
ORDER BY videoId
LIMIT 50
`;
  return runCypher<{ videoId: string }>(q, { objectTypes });
}

// Top labels across all analyses
export async function topLabels(limit = 20) {
  const q = `
MATCH (:Analysis)-[r:HAS_LABEL]->(l:Label)
RETURN l.description AS label, avg(r.confidence) AS avgConfidence, count(*) AS uses
ORDER BY uses DESC
LIMIT $limit
`;
  return runCypher(q, { limit });
}
