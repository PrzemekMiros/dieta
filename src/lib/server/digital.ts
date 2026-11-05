import { and, eq, gt } from 'drizzle-orm';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { db, type Tx } from './db';
import { entitlements, downloadTokens, orders } from './schema';
import { token, hash, HttpError } from './security';
import { required, env, siteUrl } from './env';
export async function issueLink(tx: Tx, entitlementId: string) {
  const raw = token();
  await tx
    .insert(downloadTokens)
    .values({ entitlementId, hash: hash(raw), expiresAt: new Date(Date.now() + 72 * 3600_000) });
  return `${siteUrl()}/pobierz/${raw}`;
}
export async function entitlementFor(raw: string) {
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new HttpError(404, 'Link jest nieprawidłowy.');
  const [row] = await db()
    .select({ entitlement: entitlements })
    .from(downloadTokens)
    .innerJoin(entitlements, eq(entitlements.id, downloadTokens.entitlementId))
    .innerJoin(orders, eq(orders.id, entitlements.orderId))
    .where(
      and(
        eq(downloadTokens.hash, hash(raw)),
        gt(downloadTokens.expiresAt, new Date()),
        eq(entitlements.active, true),
        eq(orders.status, 'paid'),
      ),
    );
  if (!row)
    throw new HttpError(410, 'Link wygasł lub nie jest już aktywny. Skontaktuj się ze sklepem.');
  return row.entitlement;
}
export async function signedDownload(raw: string) {
  const e = await entitlementFor(raw);
  const client = new S3Client({
    region: env('S3_REGION', 'auto'),
    endpoint: env('S3_ENDPOINT') || undefined,
    forcePathStyle: env('S3_FORCE_PATH_STYLE') === 'true',
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  });
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: required('S3_BUCKET'),
      Key: e.assetKey,
      ResponseContentDisposition: 'attachment; filename="Tortowe-Ciocho.pdf"',
      ResponseContentType: 'application/pdf',
    }),
    { expiresIn: 60 },
  );
}
