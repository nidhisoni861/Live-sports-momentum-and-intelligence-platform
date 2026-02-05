import { NextResponse } from 'next/server';
import {
  VideoIntelligenceServiceClient,
  protos,
} from '@google-cloud/video-intelligence';
import { readFileSync } from 'fs';
import { join } from 'path';

// IMPORTANT: Video Intelligence + Buffer require Node.js runtime
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('video') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No video file provided' },
        { status: 400 }
      );
    }

    // Initialize client with explicit service account credentials
    const serviceAccountPath = join(process.cwd(), 'app', 'secrets', 'video-sa.json');
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    
    const client = new VideoIntelligenceServiceClient({
      projectId: serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });

    // Convert uploaded file to Buffer
    const inputContent = Buffer.from(await file.arrayBuffer());

    // Call Video Intelligence API
    const [operation] = await client.annotateVideo({
      inputContent,
      features: [
        protos.google.cloud.videointelligence.v1.Feature.LABEL_DETECTION,
        protos.google.cloud.videointelligence.v1.Feature.OBJECT_TRACKING,
        protos.google.cloud.videointelligence.v1.Feature.TEXT_DETECTION,
        protos.google.cloud.videointelligence.v1.Feature.LOGO_RECOGNITION,
      ],
    });

    // Wait for async processing
    const [operationResult] = await operation.promise();

    const annotationResults = operationResult.annotationResults?.[0];
    
    // Get labels
    const labels = annotationResults?.segmentLabelAnnotations ?? [];
    
    // Get objects
    const objects = annotationResults?.objectAnnotations ?? [];
    
    // Get text
    const textAnnotations = annotationResults?.textAnnotations ?? [];
    
    // Get logos
    const logoAnnotations = annotationResults?.logoRecognitionAnnotations ?? [];

    return NextResponse.json({
      labels: labels.map((label: any) => ({
        description: label.entity?.description ?? '',
        confidence: label.segments?.[0]?.confidence ?? 0,
        categoryEntities:
          label.categoryEntities?.map((cat: any) => cat.description) ?? [],
      })),
      objects: objects.map((object: any) => ({
        description: object.entity?.description ?? '',
        confidence: object.confidence ?? 0,
        frames: object.frames?.map((frame: any) => ({
          timeOffset: frame.timeOffset?.seconds ? `${frame.timeOffset.seconds}s` : '0s',
          normalizedBoundingBox: frame.normalizedBoundingBox
        })) ?? []
      })),
      text: textAnnotations.map((text: any) => ({
        text: text.text ?? '',
        segments: text.segments?.map((segment: any) => ({
          startTime: segment.startTime?.seconds ? `${segment.startTime.seconds}s` : '0s',
          endTime: segment.endTime?.seconds ? `${segment.endTime.seconds}s` : '0s',
          confidence: segment.confidence ?? 0
        })) ?? []
      })),
      logos: logoAnnotations.map((logo: any) => ({
        description: logo.entity?.description ?? '',
        confidence: logo.segments?.[0]?.confidence ?? 0,
        tracks: logo.tracks?.map((track: any) => ({
          startTime: track.segment?.startTime?.seconds ? `${track.segment.startTime.seconds}s` : '0s',
          endTime: track.segment?.endTime?.seconds ? `${track.segment.endTime.seconds}s` : '0s',
          confidence: track.confidence ?? 0,
          timestampedObjects: track.timestampedObjects?.map((obj: any) => ({
            normalizedBoundingBox: obj.normalizedBoundingBox,
            timeOffset: obj.timeOffset?.seconds ? `${obj.timeOffset.seconds}s` : '0s'
          })) ?? []
        })) ?? []
      }))
    });
  } catch (error) {
    console.error('Error processing video:', error);
    
    // Provide more detailed error information
    let errorMessage = 'Failed to process video';
    if (error instanceof Error) {
      errorMessage = `Failed to process video: ${error.message}`;
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: error instanceof Error ? error.stack : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
