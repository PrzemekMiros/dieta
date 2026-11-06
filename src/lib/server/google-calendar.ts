import { createSign } from 'node:crypto';
import { env } from './env';

type GoogleConfig = {
  email: string;
  privateKey: string;
  calendarId: string;
};

type BusyInterval = {
  start: number;
  end: number;
};

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let tokenCache: { key: string; value: string; expiresAt: number } | undefined;

function config(): GoogleConfig {
  const email = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const calendarId = env('GOOGLE_CALENDAR_ID');
  if (!email || !privateKey || !calendarId) {
    throw new Error('Google Calendar is not configured.');
  }
  return { email, privateKey, calendarId };
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

async function accessToken(settings: GoogleConfig) {
  const cacheKey = `${settings.email}:${settings.privateKey}`;
  if (tokenCache?.key === cacheKey && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    base64Url(
      JSON.stringify({
        iss: settings.email,
        scope:
          'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ),
  ].join('.');
  const signature = createSign('RSA-SHA256').update(unsigned).sign(settings.privateKey);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new GoogleCalendarError(
      `Google token request failed (${response.status}).`,
      response.status,
    );
  }

  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('access_token' in body) ||
    typeof body.access_token !== 'string' ||
    !('expires_in' in body) ||
    typeof body.expires_in !== 'number'
  ) {
    throw new Error('Google returned an invalid access token response.');
  }
  tokenCache = {
    key: cacheKey,
    value: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return tokenCache.value;
}

async function request(path: string, init: RequestInit = {}) {
  const settings = config();
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken(settings)}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new GoogleCalendarError(
      `Google Calendar request failed (${response.status}).`,
      response.status,
    );
  }
  return response.status === 204 ? undefined : response.json();
}

export async function getGoogleBusy(start: Date, end: Date): Promise<BusyInterval[]> {
  const { calendarId } = config();
  const body = (await request('freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: calendarId }],
    }),
  })) as {
    calendars?: Record<
      string,
      { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }
    >;
  };
  const calendar = body.calendars?.[calendarId];
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
    throw new Error('Google Calendar availability could not be read.');
  }
  return calendar.busy.map(({ start: busyStart, end: busyEnd }) => {
    const startTime = Date.parse(busyStart);
    const endTime = Date.parse(busyEnd);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      throw new Error('Google Calendar returned an invalid busy interval.');
    }
    return { start: startTime, end: endTime };
  });
}

export async function createGoogleEvent(input: {
  id: string;
  name: string;
  email: string;
  start: string;
  end: string;
  timeZone: string;
}) {
  const { calendarId } = config();
  await request(`calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      id: input.id,
      summary: `Konsultacja online — ${input.name}`,
      description: `Rezerwacja konsultacji online.\nKontakt: ${input.email}`,
      start: { dateTime: input.start, timeZone: input.timeZone },
      end: { dateTime: input.end, timeZone: input.timeZone },
    }),
  });
}

export async function deleteGoogleEvent(id: string) {
  const { calendarId } = config();
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await accessToken(config())}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar event cleanup failed (${response.status}).`);
  }
}
