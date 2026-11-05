import { and, eq, lt } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { orders, paymentEvents } from '../src/lib/server/schema';
import { lookupPayment, p24Config, verifyPayment, type Notification } from '../src/lib/server/p24';
import { acceptPayment } from '../src/lib/server/orders';
// A read/verify operation only. Never registers a second charge and never expires
// a reservation based solely on the absence of a notification.
const rows = await db()
  .select()
  .from(orders)
  .where(and(eq(orders.status, 'pending'), lt(orders.createdAt, new Date(Date.now() - 300_000))))
  .limit(100);
for (const order of rows) {
  try {
    const remote = await lookupPayment(order.id);
    if (
      remote.sessionId !== order.id ||
      remote.amount !== order.total ||
      remote.currency !== order.currency
    )
      throw new Error('Mismatch');
    if (remote.status !== 1 && remote.status !== 2) continue;
    const c = p24Config();
    const notification: Notification = {
      merchantId: c.merchantId,
      posId: c.posId,
      sessionId: order.id,
      amount: order.total,
      originAmount: order.total,
      currency: 'PLN',
      orderId: remote.orderId,
      methodId: remote.paymentMethod,
      statement: remote.statement,
      sign: '',
    };
    await acceptPayment(notification, async (n) => {
      if (remote.status === 1) await verifyPayment(n);
    });
    console.log(`Reconciled ${order.id}`);
  } catch {
    await db()
      .insert(paymentEvents)
      .values({
        orderId: order.id,
        eventKey: `reconcile:${order.id}:${new Date().toISOString().slice(0, 13)}`,
        kind: 'reconcile_failed',
      })
      .onConflictDoNothing();
    console.error(`Reconciliation requires review: ${order.id}`);
  }
}
process.exit(0);
