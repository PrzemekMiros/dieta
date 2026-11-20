import { describe, expect, it } from 'vitest';
import { databaseError } from '../src/lib/server/database-error';

describe('safe database diagnostics', () => {
  it('identifies the missing environment variable without exposing other configuration', () => {
    expect(databaseError(new Error('Brak konfiguracji: DATABASE_URL'))?.reason).toBe(
      'database_not_configured',
    );
    expect(databaseError(new Error('Brak konfiguracji: PRIVATE_SECRET'))).toBeUndefined();
  });
  it.each([
    ['42P01', 'database_schema_missing'],
    ['42703', 'database_schema_missing'],
    ['28P01', 'database_authentication_failed'],
    ['3D000', 'database_not_found'],
    ['ECONNREFUSED', 'database_connection_failed'],
    ['CONNECT_TIMEOUT', 'database_connection_failed'],
  ])('unwraps driver code %s while excluding SQL and secrets', (code, reason) => {
    const result = databaseError(
      new Error('SQL with private data', {
        cause: Object.assign(new Error('postgres://user:secret@host/db'), { code }),
      }),
    );
    expect(result?.reason).toBe(reason);
    expect(JSON.stringify(result)).not.toMatch(/secret|private data|postgres:\/\//);
  });
  it('handles unknown errors and circular causes', () => {
    const circular: { cause?: unknown } = {};
    circular.cause = circular;
    expect(databaseError(circular)).toBeUndefined();
    expect(databaseError(null)).toBeUndefined();
    expect(databaseError({ code: 'secret-value', message: 'password' })).toBeUndefined();
  });
});
