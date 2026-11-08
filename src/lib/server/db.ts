import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { required } from './env';
let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function db() {
  return (instance ??= drizzle(
    postgres(required('DATABASE_URL'), { max: 10, idle_timeout: 20, connect_timeout: 10 }),
    { schema },
  ));
}
export type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
