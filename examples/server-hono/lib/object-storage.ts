/**
 * S3-compatible storage client.
 *
 * Works against AWS S3, Cloudflare R2, MinIO, and Garage. The OTA pipelines
 * (M6 = iOS Capgo, M8 = Electron shell, M9 = Electron renderer) all read +
 * write through this module.
 *
 * Garage quirk:
 *   AWS SDK v3.600+ adds CRC32 checksums to every request by default. Garage
 *   rejects these as InvalidDigest. The two `*ChecksumCalculation: 'WHEN_REQUIRED'`
 *   options below disable the default and only send checksums when the API
 *   actually requires them. R2 + MinIO accept either setting; AWS S3 ignores it.
 */

import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (_s3) return _s3;

  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY — needed for OTA endpoints.',
    );
  }

  _s3 = new S3Client({
    endpoint,
    region: process.env.S3_REGION || 'auto',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _s3;
}

export async function createPresignedGetUrl(
  bucket: string,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function createPresignedPutUrl(
  bucket: string,
  key: string,
  contentType?: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(
    getS3(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ...(contentType && { ContentType: contentType }) }),
    { expiresIn },
  );
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getObjectContent(bucket: string, key: string): Promise<Buffer> {
  const res = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error('Empty S3 response');
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function uploadObject(
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(contentType && { ContentType: contentType }),
    }),
  );
}
