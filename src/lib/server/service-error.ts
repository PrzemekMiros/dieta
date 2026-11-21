// Only allowlisted metadata may reach logs. SDK messages can contain payloads
// and credentials, so never include them or the response body.
export function serviceError(error: unknown) {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current) && visited.size < 8) {
    visited.add(current);
    const item = current as { message?: unknown; statusCode?: unknown; cause?: unknown };
    for (const variable of ['SMTP_HOST', 'SMTP_FROM', 'SMTP_PASSWORD']) {
      if (item.message === `Brak konfiguracji: ${variable}`)
        return { reason: 'mail_not_configured', configuration: variable };
    }
    if ([401, 403, 429, 500, 502, 503, 504].includes(Number(item.statusCode)))
      return { reason: 'upstream_service_error', upstreamStatus: Number(item.statusCode) };
    current = item.cause;
  }
  return undefined;
}
