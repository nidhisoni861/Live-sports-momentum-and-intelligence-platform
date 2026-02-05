import neo4j, { type Driver, type Session } from "neo4j-driver";

const uri = process.env.NEO4J_URI as string;
const user = process.env.NEO4J_USER as string;
const password = process.env.NEO4J_PASSWORD as string;

if (!uri || !user || !password) {
  throw new Error(
    "❌ Neo4j env vars missing: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD",
  );
}

/**
 * Neo4j best practice:
 * - ONE global Driver per process (expensive to create)
 * - Create/close Session per request (cheap)
 */

declare global {
  // eslint-disable-next-line no-var
  var _neo4jDriver: Driver | undefined;
}

export function getNeo4jDriver(): Driver {
  if (!global._neo4jDriver) {
    global._neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 5000,
    });
  }
  return global._neo4jDriver;
}

export function getNeo4jSession(
  accessMode: "READ" | "WRITE" = "READ",
): Session {
  const driver = getNeo4jDriver();
  return driver.session({
    defaultAccessMode:
      accessMode === "WRITE" ? neo4j.session.WRITE : neo4j.session.READ,
  });
}
