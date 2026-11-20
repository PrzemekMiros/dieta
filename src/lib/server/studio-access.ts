import { env } from './env';
import { HttpError } from './security';

// Only this API accepts requests from Studio. Storefront cookie authentication
// and its same-origin policy remain separate.
export function studioOrigin(request: Request) {
  const allowed = env('SANITY_STUDIO_ORIGINS', 'https://dietetyka-dla-smyka.sanity.studio')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (env('APP_ENV') !== 'production') allowed.push('http://localhost:3333');
  const origin = request.headers.get('origin');
  if (!origin || !allowed.includes(origin))
    throw new HttpError(403, 'Niedozwolone źródło żądania.');
  return origin;
}

export function studioToken(request: Request) {
  const match = /^Bearer ([A-Za-z0-9._~-]{20,4096})$/.exec(
    request.headers.get('authorization') || '',
  );
  return match?.[1];
}

export async function studioAdmin(request: Request) {
  const token = studioToken(request);
  if (!token) throw new HttpError(401, 'Brak aktywnej sesji Sanity.');
  const projectId = env('SANITY_PROJECT_ID', 'fip0o8g2');
  if (!/^[a-z0-9]+$/.test(projectId)) throw new HttpError(503, 'Niepoprawna konfiguracja Sanity.');
  let response: Response;
  try {
    // Sanity authenticates the supplied user token and identifies its owner.
    // Never trust roles, email or user IDs supplied by the browser.
    response = await fetch(
      `https://api.sanity.io/v2021-06-07/projects/${projectId}?includeMembers=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
        cache: 'no-store',
      },
    );
  } catch {
    throw new HttpError(503, 'Nie udało się sprawdzić uprawnień Sanity. Spróbuj ponownie.');
  }
  if (response.status === 401) throw new HttpError(401, 'Sesja Sanity wygasła. Odśwież Studio.');
  if (response.status === 403 || response.status === 404)
    throw new HttpError(403, 'Brak uprawnień administratora projektu Sanity.');
  if (!response.ok) throw new HttpError(503, 'Nie udało się sprawdzić uprawnień Sanity.');
  const project = (await response.json()) as {
    id?: string;
    isBlocked?: boolean;
    isDisabled?: boolean;
    members?: {
      id?: string;
      isCurrentUser?: boolean;
      isRobot?: boolean;
      roles?: { name: string }[];
    }[];
  };
  const member = project.members?.find((entry) => entry.isCurrentUser === true);
  if (
    project.id !== projectId ||
    project.isBlocked ||
    project.isDisabled ||
    !member?.id ||
    member.isRobot !== false ||
    !member.roles?.some((role) => role.name === 'administrator')
  )
    throw new HttpError(403, 'Obsługa zamówień wymaga roli administratora projektu Sanity.');
  return { id: null, sanityUserId: member.id };
}

export function studioCors(response: Response, origin: string) {
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.headers.set('Vary', 'Origin');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
