import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Tx } from './db';
import { env } from './env';
import * as t from './schema';
import { createGoogleEvent, deleteGoogleEvent, getGoogleBusy } from './google-calendar';
import { HttpError } from './security';

export type BookingSettings = {
  timeZone: string;
  start: string;
  end: string;
  durationMinutes: number;
  noticeHours: number;
  horizonDays: number;
  days: number[];
};

function parseTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error('Invalid booking time configuration.');
  return Number(match[1]) * 60 + Number(match[2]);
}

export function bookingSettings(): BookingSettings {
  const timeZone = env('BOOKING_TIMEZONE', 'Europe/Warsaw');
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error('Invalid booking time zone configuration.');
  }
  const start = env('BOOKING_START', '09:00');
  const end = env('BOOKING_END', '17:00');
  const durationMinutes = Number(env('BOOKING_DURATION_MINUTES', '60'));
  const noticeHours = Number(env('BOOKING_NOTICE_HOURS', '24'));
  const horizonDays = Number(env('BOOKING_HORIZON_DAYS', '60'));
  const days = env('BOOKING_DAYS', '1,2,3,4,5').split(',').map(Number);
  if (
    parseTime(end) <= parseTime(start) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 240 ||
    !Number.isInteger(noticeHours) ||
    noticeHours < 0 ||
    noticeHours > 720 ||
    !Number.isInteger(horizonDays) ||
    horizonDays < 1 ||
    horizonDays > 365 ||
    days.length === 0 ||
    days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    throw new Error('Invalid booking schedule configuration.');
  }
  return {
    timeZone,
    start,
    end,
    durationMinutes,
    noticeHours,
    horizonDays,
    days: [...new Set(days)],
  };
}

function dateKeyInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedDateTime(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let timestamp = desired;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const values = formatter.formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(values.find((value) => value.type === type)?.value);
    const represented = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    const difference = desired - represented;
    if (difference === 0) return new Date(timestamp);
    timestamp += difference;
  }
  throw new Error('The selected time does not exist in the booking time zone.');
}

function dateRange(dateKey: string, settings: BookingSettings) {
  const start = zonedDateTime(dateKey, '00:00', settings.timeZone);
  const end = zonedDateTime(addDays(dateKey, 1), '00:00', settings.timeZone);
  return { start, end };
}

function validDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const date = new Date(`${dateKey}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateKey;
}

function candidateSlots(dateKey: string, settings: BookingSettings) {
  if (!validDateKey(dateKey)) return [];
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  const today = dateKeyInZone(new Date(), settings.timeZone);
  if (
    !settings.days.includes(day) ||
    dateKey < today ||
    dateKey > addDays(today, settings.horizonDays)
  ) {
    return [];
  }

  const start = parseTime(settings.start);
  const end = parseTime(settings.end);
  const minimumStart = Date.now() + settings.noticeHours * 60 * 60_000;
  const slots: Array<{ time: string; start: Date; end: Date }> = [];
  for (
    let minute = start;
    minute + settings.durationMinutes <= end;
    minute += settings.durationMinutes
  ) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const slotStart = zonedDateTime(dateKey, time, settings.timeZone);
    const slotEnd = new Date(slotStart.getTime() + settings.durationMinutes * 60_000);
    if (slotStart.getTime() >= minimumStart) slots.push({ time, start: slotStart, end: slotEnd });
  }
  return slots;
}

async function localBusy(tx: Tx | ReturnType<typeof db>, start: Date, end: Date) {
  return tx
    .select({ startAt: t.bookings.startAt, endAt: t.bookings.endAt })
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.status, 'confirmed'),
        lt(t.bookings.startAt, end),
        gt(t.bookings.endAt, start),
      ),
    );
}

export async function availableBookingTimes(dateKey: string) {
  const settings = bookingSettings();
  const slots = candidateSlots(dateKey, settings);
  if (!slots.length) return { date: dateKey, times: [] as string[] };

  const { start, end } = dateRange(dateKey, settings);
  const [busy, booked] = await Promise.all([
    getGoogleBusy(start, end),
    localBusy(db(), start, end),
  ]);
  return {
    date: dateKey,
    times: slots
      .filter(
        (slot) =>
          !busy.some(
            (interval) =>
              slot.start.getTime() < interval.end && slot.end.getTime() > interval.start,
          ) && !booked.some((booking) => slot.start < booking.endAt && slot.end > booking.startAt),
      )
      .map((slot) => slot.time),
  };
}

export const bookingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(validDateKey);

export const bookingInputSchema = z.object({
  date: bookingDateSchema,
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  name: z.string().trim().min(1).max(80),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  privacyAccepted: z.literal(true),
});

export async function createBooking(input: z.infer<typeof bookingInputSchema>) {
  const settings = bookingSettings();
  const slot = candidateSlots(input.date, settings).find(
    (candidate) => candidate.time === input.time,
  );
  if (!slot) throw new HttpError(400, 'Wybrany termin nie jest dostępny.');
  const eventId = randomUUID().replaceAll('-', '');
  let eventCreated = false;

  try {
    const [booking] = await db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.date}:${input.time}`}, 0))`,
      );
      const local = await localBusy(tx, slot.start, slot.end);
      if (local.length) throw new HttpError(409, 'Ten termin został właśnie zarezerwowany.');
      const { start, end } = dateRange(input.date, settings);
      const busy = await getGoogleBusy(start, end);
      if (
        busy.some(
          (interval) => slot.start.getTime() < interval.end && slot.end.getTime() > interval.start,
        )
      ) {
        throw new HttpError(409, 'Ten termin nie jest już dostępny. Wybierz inną godzinę.');
      }

      await createGoogleEvent({
        id: eventId,
        name: input.name,
        email: input.email,
        start: `${input.date}T${input.time}:00`,
        end: `${input.date}T${String(
          Math.floor((parseTime(input.time) + settings.durationMinutes) / 60),
        ).padStart(
          2,
          '0',
        )}:${String((parseTime(input.time) + settings.durationMinutes) % 60).padStart(2, '0')}:00`,
        timeZone: settings.timeZone,
      });
      eventCreated = true;
      return tx
        .insert(t.bookings)
        .values({
          name: input.name,
          email: input.email,
          startAt: slot.start,
          endAt: slot.end,
          googleEventId: eventId,
        })
        .returning({ id: t.bookings.id });
    });
    return { id: booking!.id, date: input.date, time: input.time };
  } catch (error) {
    if (eventCreated) {
      try {
        await deleteGoogleEvent(eventId);
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            event: 'booking_google_cleanup_failed',
            error: cleanupError instanceof Error ? cleanupError.name : 'Unknown',
          }),
        );
      }
    }
    throw error;
  }
}
