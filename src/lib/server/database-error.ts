// Allowlisted diagnostics only: never serialize SQL, connection strings,
// driver messages or parameters (they can contain credentials/customer data).
export function databaseError(error: unknown) {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current) && visited.size < 8) {
    visited.add(current);
    const item = current as { message?: unknown; code?: unknown; cause?: unknown };
    if (item.message === 'Brak konfiguracji: DATABASE_URL')
      return {
        reason: 'database_not_configured',
        message:
          'Brak konfiguracji bazy zamówień. Ustaw DATABASE_URL w Netlify dla Functions i wykonaj ponowne wdrożenie.',
      };
    if (item.code === '42P01' || item.code === '42703')
      return {
        reason: 'database_schema_missing',
        message:
          'Baza zamówień wymaga migracji. Uruchom npm run db:migrate dla bazy używanej przez Netlify.',
      };
    if (item.code === '28P01' || item.code === '28000')
      return {
        reason: 'database_authentication_failed',
        message: 'Baza odrzuciła dane logowania. Sprawdź DATABASE_URL w konfiguracji Netlify.',
      };
    if (item.code === '3D000')
      return {
        reason: 'database_not_found',
        message: 'Nie znaleziono bazy wskazanej w DATABASE_URL. Sprawdź konfigurację Netlify.',
      };
    if (
      ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED'].includes(
        String(item.code),
      )
    )
      return {
        reason: 'database_connection_failed',
        message:
          'Nie można połączyć się z bazą zamówień. Sprawdź jej dostępność i DATABASE_URL w Netlify.',
      };
    current = item.cause;
  }
  return undefined;
}
