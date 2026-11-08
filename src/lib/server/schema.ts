import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
const id = () => uuid('id').primaryKey().defaultRandom();
const created = (name = 'created_at') =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const customers = pgTable('customers', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: created(),
});
export const orders = pgTable(
  'orders',
  {
    id: id(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    status: text('status').notNull().default('pending'),
    total: integer('total').notNull(),
    shipping: integer('shipping').notNull(),
    currency: text('currency').notNull().default('PLN'),
    shippingMethod: text('shipping_method'),
    address: jsonb('address').$type<Record<string, string>>(),
    invoice: jsonb('invoice').$type<Record<string, string>>(),
    consents: jsonb('consents').notNull(),
    accessHash: text('access_hash').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    requestHash: text('request_hash').notNull(),
    createdAt: created(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    updatedAt: created('updated_at'),
  },
  (t) => [check('order_total_positive', sql`${t.total}>0`)],
);
export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    productId: text('product_id').notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    taxRate: integer('tax_rate').notNull(),
    assetKey: text('asset_key'),
  },
  (t) => [
    check('item_quantity_positive', sql`${t.quantity}>0`),
    uniqueIndex('order_product_unique').on(t.orderId, t.productId),
  ],
);
export const payments = pgTable('payments', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .unique()
    .references(() => orders.id),
  sessionId: text('session_id').notNull().unique(),
  p24OrderId: text('p24_order_id').unique(),
  token: text('token'),
  status: text('status').notNull().default('registering'),
  lastError: text('last_error'),
  createdAt: created(),
});
export const paymentEvents = pgTable('payment_events', {
  id: id(),
  orderId: uuid('order_id').references(() => orders.id),
  eventKey: text('event_key').notNull().unique(),
  kind: text('kind').notNull(),
  data: jsonb('data'),
  createdAt: created(),
});
export const shipments = pgTable('shipments', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .unique()
    .references(() => orders.id),
  status: text('status').notNull().default('preparing'),
  tracking: text('tracking'),
  updatedAt: created('updated_at'),
});
export const entitlements = pgTable('digital_entitlements', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  itemId: uuid('item_id')
    .notNull()
    .unique()
    .references(() => orderItems.id),
  assetKey: text('asset_key').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
});
export const downloadTokens = pgTable('download_tokens', {
  id: id(),
  entitlementId: uuid('entitlement_id')
    .notNull()
    .references(() => entitlements.id),
  hash: text('hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
});
export const inventory = pgTable(
  'inventory',
  {
    productId: text('product_id').primaryKey(),
    available: integer('available').notNull(),
    updatedAt: created('updated_at'),
  },
  (t) => [check('inventory_nonnegative', sql`${t.available}>=0`)],
);
export const inventoryMovements = pgTable('inventory_movements', {
  id: id(),
  productId: text('product_id')
    .notNull()
    .references(() => inventory.productId),
  orderId: uuid('order_id').references(() => orders.id),
  quantity: integer('quantity').notNull(),
  kind: text('kind').notNull(),
  key: text('key').notNull().unique(),
  createdAt: created(),
});
export const adminUsers = pgTable('admin_users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
});
export const adminSessions = pgTable('admin_sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => adminUsers.id),
  hash: text('hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
});
export const auditLogs = pgTable('audit_logs', {
  id: id(),
  adminId: uuid('admin_id').references(() => adminUsers.id),
  orderId: uuid('order_id').references(() => orders.id),
  action: text('action').notNull(),
  data: jsonb('data'),
  createdAt: created(),
});
export const emailOutbox = pgTable('email_outbox', {
  id: id(),
  key: text('key').notNull().unique(),
  to: text('recipient').notNull(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttempt: timestamp('next_attempt', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: created(),
});
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
});
export const newsletter = pgTable('newsletter_subscribers', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('pending'),
  confirmHash: text('confirm_hash').notNull(),
  unsubscribeHash: text('unsubscribe_hash').notNull(),
  createdAt: created(),
});
export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    googleEventId: text('google_event_id').notNull().unique(),
    status: text('status').notNull().default('confirmed'),
    createdAt: created(),
  },
  (t) => [
    check('booking_end_after_start', sql`${t.endAt}>${t.startAt}`),
    uniqueIndex('booking_start_at_unique').on(t.startAt),
  ],
);
