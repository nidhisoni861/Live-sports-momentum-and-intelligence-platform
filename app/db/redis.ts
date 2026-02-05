import { createClient, type RedisClientType } from "redis";

const url = process.env.REDIS_URL as string;

if (!url) {
  throw new Error("❌ REDIS_URL is not defined in environment variables");
}

/**
 * Next.js dev/hot-reload safe Redis singleton.
 * - Create ONE client for the whole process
 * - Connect lazily once, reuse everywhere
 * - Avoid reconnect storms
 */

declare global {
  // eslint-disable-next-line no-var
  var _redisClient: RedisClientType | undefined;
  // eslint-disable-next-line no-var
  var _redisClientPromise: Promise<RedisClientType> | undefined;
}

export async function getRedis(): Promise<RedisClientType> {
  if (global._redisClient) return global._redisClient;

  if (!global._redisClientPromise) {
    const client = createClient({
      url,
      socket: {
        // protects you from long hangs if redis is down
        connectTimeout: 5000,
        // optional: keep retry strategy simple & controlled
        reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
      },
    });

    client.on("error", (err) => {
      console.error("Redis Client Error:", err);
    });

    global._redisClientPromise = client.connect().then(() => client);
  }

  global._redisClient = await global._redisClientPromise;
  return global._redisClient;
}
