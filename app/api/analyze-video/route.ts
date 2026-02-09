// app/api/analyze-video/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";

import { saveVideoAnalysis, getVideoAnalysisById } from "@/app/db/mongo";
import {
  buildLiveStateAtTime,
  getLiveStateAtTime,
} from "@/app/db/redis-models/live";
import { normalizeToModels } from "@/app/db/models/normalizer";

/* ================= ADDED NEO4J IMPORT (FIXED NAME) ================= */
import { normalizeToNeo4jGraph } from "@/app/db/neo4j-models/neo-normalizer";
/* =================================================================== */

export const runtime = "nodejs";

const MAX_SIZE_MB = 50;

/* ================= HELPERS ================= */

function toSeconds(d: any): number {
  const s = Number(d?.seconds ?? 0);
  const n = Number(d?.nanos ?? 0);
  return s + n / 1e9;
}

function validateFile(file: any) {
  if (!file?.type?.startsWith("video/")) {
    throw new Error("Only video files allowed");
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Max file size is ${MAX_SIZE_MB}MB`);
  }
}

function extractScore(text: string): string | null {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (/\b\d{1,2}:\d{2}\b/.test(s)) return null;

  const m = s.match(/(\d{1,2})\s*[- ]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function getSegStart(seg: any) {
  return (
    seg?.segment?.startTimeOffset ??
    seg?.startTimeOffset ??
    seg?.startTime ??
    null
  );
}

function getSegEnd(seg: any) {
  return (
    seg?.segment?.endTimeOffset ?? seg?.endTimeOffset ?? seg?.endTime ?? null
  );
}

/* ========================================================= */

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video") as any;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 },
      );
    }

    validateFile(file);

    const serviceAccountPath = join(
      process.cwd(),
      "app",
      "secrets",
      "video-sa.json",
    );
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

    const videoClient = new VideoIntelligenceServiceClient({
      projectId: serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });

    const inputContent = Buffer.from(await file.arrayBuffer());

    const [operation] = await videoClient.annotateVideo({
      inputContent,
      features: [
        protos.google.cloud.videointelligence.v1.Feature.LABEL_DETECTION,
        protos.google.cloud.videointelligence.v1.Feature.OBJECT_TRACKING,
        protos.google.cloud.videointelligence.v1.Feature.TEXT_DETECTION,
      ],
    });

    const [operationResult] = await operation.promise();
    const annotation = operationResult.annotationResults?.[0];
    if (!annotation) throw new Error("No annotation results returned");

    const labels = (annotation.segmentLabelAnnotations ?? []).map((l: any) => ({
      name: l.entity?.description ?? "",
      confidence: Number(l.segments?.[0]?.confidence ?? 0),
    }));

    const objects = (annotation.objectAnnotations ?? []).map((obj: any) => ({
      name: obj.entity?.description ?? "",
      confidence: Number(obj.confidence ?? 0),
      start: toSeconds(obj.segment?.startTimeOffset),
      end: toSeconds(obj.segment?.endTimeOffset),
      frames: (obj.frames ?? []).map((frame: any) => ({
        t: toSeconds(frame.timeOffset),
        box: {
          left: Number(frame.normalizedBoundingBox?.left ?? 0),
          top: Number(frame.normalizedBoundingBox?.top ?? 0),
          right: Number(frame.normalizedBoundingBox?.right ?? 0),
          bottom: Number(frame.normalizedBoundingBox?.bottom ?? 0),
        },
      })),
    }));

    const text: any[] = [];

    for (const ta of annotation.textAnnotations ?? []) {
      const segs = Array.isArray(ta?.segments) ? ta.segments : [];

      if (segs.length) {
        for (const seg of segs) {
          const startSec = toSeconds(getSegStart(seg));
          const endSec = toSeconds(getSegEnd(seg));

          text.push({
            text: ta?.text ?? "",
            confidence: Number(seg?.confidence ?? 0),
            start: startSec,
            end: endSec,
            timestamp: startSec,
          });
        }
      }
    }

    const scoreEvents = text
      .map((ev) => {
        const score = extractScore(ev.text);
        return score
          ? {
              score,
              text: ev.text,
              confidence: ev.confidence,
              start: ev.start,
              end: ev.end,
            }
          : null;
      })
      .filter(Boolean) as any[];

    const analyzedAt = new Date();

    const mongoWrite = await saveVideoAnalysis({
      videoId: file.name,
      labels,
      objects,
      text,
      scoreEvents,
      analyzedAt,
    });

    const analysis = await getVideoAnalysisById(file.name);

    try {
      await normalizeToModels({
        videoId: file.name,
        labels,
        objects,
        text,
        scoreEvents,
        analyzedAt,
      });
    } catch (normErr) {
      console.warn("⚠ Normalization failed:", normErr);
    }

    /* ================= ADDED NEO4J BLOCK (FIXED CALL) ================= */
    try {
      await normalizeToNeo4jGraph({
        videoId: file.name,
        objects,
        scoreEvents,
      });

      console.log("✅ Neo4j graph written for", file.name);
    } catch (neoErr) {
      console.warn("⚠ Neo4j write failed:", neoErr);
    }
    /* ================================================================= */

    try {
      await buildLiveStateAtTime(file.name, 0);
    } catch (redisErr) {
      console.warn("⚠ Redis init failed:", redisErr);
    }

    return NextResponse.json({
      success: true,
      videoId: file.name,
      mongo: {
        upsertedId: mongoWrite.upsertedId ?? null,
        matchedCount: mongoWrite.matchedCount ?? 0,
        modifiedCount: mongoWrite.modifiedCount ?? 0,
      },
      analysis,
      summary: {
        labelCount: labels.length,
        objectCount: objects.length,
        textCount: text.length,
        scoreEventCount: scoreEvents.length,
      },
    });
  } catch (error: any) {
    console.error("❌ Video processing failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed" },
      { status: 500 },
    );
  }
}
