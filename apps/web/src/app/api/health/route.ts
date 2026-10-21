/**
 * Проверка, что сайт жив. Используется Docker (healthcheck) и мониторингом.
 * Ничего не раскрывает о внутреннем устройстве — только статус.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
