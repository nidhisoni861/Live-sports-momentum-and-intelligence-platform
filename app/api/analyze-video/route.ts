import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

type NormalizedBox = { left: number; top: number; right: number; bottom: number };

function toSeconds(timeOffset: any): number {
  const s = Number(timeOffset?.seconds ?? 0);
  const n = Number(timeOffset?.nanos ?? 0);
  return s + n / 1e9;
}

function safeBox(box: any): NormalizedBox | null {
  if (!box) return null;
  const left = Number(box.left ?? 0);
  const top = Number(box.top ?? 0);
  const right = Number(box.right ?? 0);
  const bottom = Number(box.bottom ?? 0);
  return { left, top, right, bottom };
}

export async function POST(request: Request) {
  try {
    // ==============================
    // 1) READ VIDEO FROM REQUEST
    // ==============================
    const formData = await request.formData();
    const file = formData.get("video") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 }
      );
    }

    const sizeMB = Math.round((file.size / (1024 * 1024)) * 10) / 10;
    console.log(`📥 Video received: ${file.name} (${sizeMB} MB)`);

    // ==============================
    // 2) LOAD SERVICE ACCOUNT (LOCAL)
    // ==============================
    const serviceAccountPath = join(
      process.cwd(),
      "app",
      "secrets",
      "video-sa.json"
    );

    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

    const videoClient = new VideoIntelligenceServiceClient({
      projectId: serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });

    console.log("🔐 Google service account loaded");

    // ==============================
    // 3) CALL GOOGLE VIDEO API
    // ==============================
    const inputContent = Buffer.from(await file.arrayBuffer());

    const [operation] = await videoClient.annotateVideo({
      inputContent,
      features: [
        protos.google.cloud.videointelligence.v1.Feature.LABEL_DETECTION,
        protos.google.cloud.videointelligence.v1.Feature.OBJECT_TRACKING,
        protos.google.cloud.videointelligence.v1.Feature.TEXT_DETECTION,
      ],
    });

    console.log("🟡 Google API request submitted");

    const [operationResult] = await operation.promise();
    console.log("✅ Google API processing completed");

    const annotation = operationResult.annotationResults?.[0];
    if (!annotation) {
      return NextResponse.json(
        { success: false, error: "No annotation results returned" },
        { status: 500 }
      );
    }

    // ==============================
    // 4) EXTRACT + SUMMARIZE (FRONTEND FRIENDLY)
    // ==============================

    // LABELS (segment labels)
    const segmentLabels = annotation.segmentLabelAnnotations ?? [];
    const labels = segmentLabels.map((l: any) => ({
      description: l.entity?.description ?? "",
      confidence: Number(l.segments?.[0]?.confidence ?? 0),
      categories: (l.categoryEntities ?? []).map((c: any) => c.description).filter(Boolean),
    }));

    // OBJECTS (TRACKING)
    const objectAnnotations = annotation.objectAnnotations ?? [];

    // Keep objects as a lighter structure:
    // each object: type + confidence + segment + frames with (t + box)
    const objects = objectAnnotations.map((obj: any) => {
      const frames = (obj.frames ?? [])
        .map((f: any) => {
          const box = safeBox(f.normalizedBoundingBox);
          if (!box) return null;
          return {
            t: toSeconds(f.timeOffset), // seconds as number (e.g., 26.4)
            box,
          };
        })
        .filter(Boolean);

      const start = toSeconds(obj.segment?.startTimeOffset);
      const end = toSeconds(obj.segment?.endTimeOffset);

      return {
        type: obj.entity?.description ?? "",
        entityId: obj.entity?.entityId ?? "",
        confidence: Number(obj.confidence ?? 0),
        segment: { start, end },
        frames,
      };
    });

    // TEXT
    const textAnnotations = annotation.textAnnotations ?? [];
    const text = textAnnotations.map((t: any) => ({
      text: t.text ?? "",
      segments: (t.segments ?? []).map((s: any) => ({
        start: toSeconds(s.startTime),
        end: toSeconds(s.endTime),
        confidence: Number(s.confidence ?? 0),
      })),
    }));

    console.log(
      `📊 Extracted → labels=${labels.length}, objects=${objects.length}, text=${text.length}`
    );

    // OPTIONAL: backend-only raw logging (comment out if too big)
    // console.log("🔵 RAW GOOGLE RESPONSE:", JSON.stringify(operationResult, null, 2));

    // ==============================
    // 5) RETURN SUMMARY TO FRONTEND
    // ==============================
    return NextResponse.json({
      success: true,
      filename: file.name,
      analyzedAt: new Date().toISOString(),
      summary: {
        labels,
        objects,
        text,
      },
    });
  } catch (error) {
    console.error("❌ Video processing failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to process video",
      },
      { status: 500 }
    );
  }
}
