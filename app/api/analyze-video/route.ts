/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";

import { saveVideoAnalysis, getVideoAnalysisById } from "@/app/db/mongo";

export const runtime = "nodejs";

const MAX_SIZE_MB = 50;

/* ---------- helpers ---------- */

function validateFile(file: any) {
  if (!file?.type?.startsWith("video/"))
    throw new Error("Only video files allowed");

  if (file.size > MAX_SIZE_MB * 1024 * 1024)
    throw new Error(`Max file size is ${MAX_SIZE_MB}MB`);
}

/* =========================================================
   POST → return EXACT cloud format (no transformation)
   ========================================================= */
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

    /* ---- Google client ---- */
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

    if (!annotation) {
      throw new Error("No annotation results returned");
    }

    /* =========================================================
       BUILD RESPONSE EXACTLY LIKE CLOUD FILE
       ========================================================= */

    const responseDoc = {
      filename: file.name,
      analyzedAt: new Date(),

      summary: {
        labels:
          annotation.segmentLabelAnnotations?.map((l: any) => ({
            description: l.entity?.description ?? "",
            confidence: Number(l.segments?.[0]?.confidence ?? 0),
            categories:
              l.categoryEntities?.map((c: any) => c.description) ?? [],
          })) ?? [],
      },

      // RAW CLOUD OBJECTS (contain frames + segments)
      objects: annotation.objectAnnotations ?? [],

      // RAW CLOUD TEXT
      text: annotation.textAnnotations ?? [],
    };

    /* ---- Store raw without mutation ---- */
    await saveVideoAnalysis({
      videoId: file.name,
      ...responseDoc,
    });

    return NextResponse.json({
      success: true,
      ...responseDoc,
    });
  } catch (error: any) {
    console.error("❌ Video processing failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed" },
      { status: 500 },
    );
  }
}

/* =========================================================
   GET → return SAME cloud structure from DB
   ========================================================= */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: "videoId required" },
        { status: 400 },
      );
    }

    const doc = await getVideoAnalysisById(videoId);

    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,

      filename: doc.filename,
      analyzedAt: doc.analyzedAt,

      summary: doc.summary,

      // EXACT CLOUD STRUCTURE
      objects: doc.objects,
      text: doc.text,
    });
  } catch (error: any) {
    console.error("❌ GET failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed" },
      { status: 500 },
    );
  }
}
