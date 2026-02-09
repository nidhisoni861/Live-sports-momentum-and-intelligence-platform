/* eslint-disable @typescript-eslint/no-explicit-any */

import neo4j, { Driver, Session, QueryResult } from "neo4j-driver";

/**
 * Next.js safe singleton driver
 */

declare global {
  // eslint-disable-next-line no-var
  var _neo4jDriver: Driver | undefined;
}

function createDriver(): Driver {
  const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
  const user = process.env.NEO4J_USER || "neo4j";
  const pass = process.env.NEO4J_PASS || "password";

  return neo4j.driver(uri, neo4j.auth.basic(user, pass), {
    maxConnectionPoolSize: 50,
    connectionTimeout: 5000,
    disableLosslessIntegers: true,
  });
}

export function getNeoDriver(): Driver {
  if (!global._neo4jDriver) {
    global._neo4jDriver = createDriver();
  }

  return global._neo4jDriver;
}

/**
 * Get short lived session
 */
export function getSession(): Session {
  return getNeoDriver().session();
}

/**
 * Helper to run a query safely
 */
export async function run<T = any>(
  cypher: string,
  params: Record<string, any> = {},
): Promise<QueryResult<T>> {
  const session = getSession();

  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

/**
 * Health check used at app start
 */
export async function checkNeo4j(): Promise<boolean> {
  try {
    const res = await run("RETURN 1 as ok");
    return res.records.length > 0;
  } catch (err) {
    console.error("❌ Neo4j not reachable:", err);
    return false;
  }
}

/**
 * Graceful shutdown (optional)
 */
export async function closeNeo4j() {
  if (global._neo4jDriver) {
    await global._neo4jDriver.close();
    global._neo4jDriver = undefined;
  }
}

/**
 * Convert Neo4j int → JS number
 */
export function toNumber(v: any): number {
  if (neo4j.isInt(v)) return v.toNumber();
  return Number(v ?? 0);
}
