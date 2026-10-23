/** Общее для обработчиков API: проверка источника запроса и разбор параметров. */

/**
 * POST только со своего сайта. Для серверных действий Next проверяет это сам,
 * для обработчиков маршрутов — нет. Сравниваем Origin с Host (Caddy передаёт Host как есть).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** ?after=<id> — номер последнего уже полученного сообщения. */
export function afterParam(req: Request): number {
  const v = new URL(req.url).searchParams.get("after");
  return v && /^\d{1,10}$/.test(v) ? Number(v) : 0;
}

export async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await req.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const noStore = { "Cache-Control": "no-store" };

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: noStore });
}
