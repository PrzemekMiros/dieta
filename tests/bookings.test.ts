import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { bookingInputSchema, bookingSettings } from '../src/lib/server/bookings';
import {
  createGoogleEvent,
  deleteGoogleEvent,
  getGoogleBusy,
} from '../src/lib/server/google-calendar';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('rezerwacje konsultacji', () => {
  it('ustawia domyślny harmonogram i normalizuje dni tygodnia', () => {
    vi.stubEnv('BOOKING_TIMEZONE', 'Europe/Warsaw');
    vi.stubEnv('BOOKING_START', '09:00');
    vi.stubEnv('BOOKING_END', '17:00');
    vi.stubEnv('BOOKING_DURATION_MINUTES', '60');
    vi.stubEnv('BOOKING_NOTICE_HOURS', '24');
    vi.stubEnv('BOOKING_HORIZON_DAYS', '60');
    vi.stubEnv('BOOKING_DAYS', '1,2,3,4,5,5');

    expect(bookingSettings()).toEqual({
      timeZone: 'Europe/Warsaw',
      start: '09:00',
      end: '17:00',
      durationMinutes: 60,
      noticeHours: 24,
      horizonDays: 60,
      days: [1, 2, 3, 4, 5],
    });
  });

  it('odrzuca niepoprawne ustawienia oraz waliduje dane rezerwacji', () => {
    vi.stubEnv('BOOKING_START', '17:00');
    vi.stubEnv('BOOKING_END', '09:00');
    expect(() => bookingSettings()).toThrow('Invalid booking schedule configuration.');
    expect(
      bookingInputSchema.safeParse({
        date: '2030-02-31',
        time: '25:00',
        name: '',
        email: 'not-an-email',
        privacyAccepted: false,
      }).success,
    ).toBe(false);
    expect(
      bookingInputSchema.parse({
        date: '2030-02-28',
        time: '09:00',
        name: '  Anna  ',
        email: 'ANNA@example.test',
        privacyAccepted: true,
      }),
    ).toEqual({
      date: '2030-02-28',
      time: '09:00',
      name: 'Anna',
      email: 'anna@example.test',
      privacyAccepted: true,
    });
  });

  it('podpisuje konto usługi, odczytuje zajętość i zapisuje wydarzenie w kalendarzu', async () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'calendar@example.test');
    vi.stubEnv('GOOGLE_PRIVATE_KEY', privateKey);
    vi.stubEnv('GOOGLE_CALENDAR_ID', 'consultations@example.test');
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
        const [header, claims, signature] = assertion.split('.');
        const signedValue = `${header}.${claims}`;
        expect(
          verify(
            'RSA-SHA256',
            Buffer.from(signedValue),
            publicKey,
            Buffer.from(signature!, 'base64url'),
          ),
        ).toBe(true);
        expect(JSON.parse(Buffer.from(claims!, 'base64url').toString()).scope).toContain(
          'calendar.freebusy',
        );
        return Response.json({ access_token: 'test-token', expires_in: 3600 });
      }
      if (url.endsWith('/freeBusy')) {
        return Response.json({
          calendars: {
            'consultations@example.test': {
              busy: [{ start: '2030-02-28T09:00:00Z', end: '2030-02-28T10:00:00Z' }],
            },
          },
        });
      }
      if (url.endsWith('/events')) return Response.json({ id: 'booking' });
      if (init?.method === 'DELETE') return new Response(null, { status: 404 });
      throw new Error(`Unexpected Google URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getGoogleBusy(new Date('2030-02-28T00:00:00Z'), new Date('2030-03-01T00:00:00Z')),
    ).resolves.toEqual([
      { start: Date.parse('2030-02-28T09:00:00Z'), end: Date.parse('2030-02-28T10:00:00Z') },
    ]);
    await createGoogleEvent({
      id: 'booking',
      name: 'Anna',
      email: 'anna@example.test',
      start: '2030-02-28T09:00:00',
      end: '2030-02-28T10:00:00',
      timeZone: 'Europe/Warsaw',
    });
    await deleteGoogleEvent('booking');

    const eventRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/events'));
    expect(JSON.parse(String(eventRequest?.[1]?.body))).toMatchObject({
      summary: 'Konsultacja online — Anna',
      description: 'Rezerwacja konsultacji online.\nKontakt: anna@example.test',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
