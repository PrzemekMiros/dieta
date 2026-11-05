import { db } from '../src/lib/server/db';
import { adminUsers } from '../src/lib/server/schema';
import { passwordHash } from '../src/lib/server/security';
import { required } from '../src/lib/server/env';
import { z } from 'zod';
const email = z.email().parse(required('ADMIN_EMAIL')).toLowerCase();
const password = z.string().min(14).max(200).parse(required('ADMIN_PASSWORD'));
await db()
  .insert(adminUsers)
  .values({ email, passwordHash: await passwordHash(password) });
console.log('Administrator utworzony. Usuń ADMIN_PASSWORD z otoczenia procesu.');
process.exit(0);
