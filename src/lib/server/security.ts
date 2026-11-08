import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { eq, sql, and, gt } from 'drizzle-orm';
import { db } from './db';
import { rateLimits, adminSessions, adminUsers } from './schema';
import { env, siteUrl } from './env';
const scrypt = (password: string, salt: string, _length: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export const token = () => randomBytes(32).toString('hex');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = [new URL(request.url).origin, new URL(siteUrl()).origin];
  if (env('APP_ENV') !== 'production')
    allowed.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:4321',
      'http://127.0.0.1:4321',
    );
  if (!origin || !allowed.includes(origin))
    throw new HttpError(403, 'Niedozwolone źródło żądania.');
}
export async function limited(key: string, max = 10, seconds = 60) {
  const reset = new Date(Date.now() + seconds * 1000);
  const [row] = await db()
    .insert(rateLimits)
    .values({ key: hash(key), count: 1, resetAt: reset })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt}<now() then 1 else ${rateLimits.count}+1 end`,
        resetAt: sql`case when ${rateLimits.resetAt}<now() then ${reset.toISOString()}::timestamptz else ${rateLimits.resetAt} end`,
      },
    })
    .returning();
  if (row!.count > max) throw new HttpError(429, 'Za dużo prób. Spróbuj za chwilę.');
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [, salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
export async function session(raw: string | undefined) {
  if (!raw || !env('DATABASE_URL')) return null;
  const [result] = await db()
    .select({ id: adminUsers.id, email: adminUsers.email })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
    .where(
      and(
        eq(adminSessions.hash, hash(raw)),
        gt(adminSessions.expiresAt, new Date()),
        eq(adminUsers.active, true),
      ),
    );
  return result || null;
}
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
export async function readJson(request: Request) {
  const body = await request.text();
  if (body.length > 32_000) throw new HttpError(413, 'Żądanie jest zbyt duże.');
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Niepoprawne dane JSON.');
  }
}
