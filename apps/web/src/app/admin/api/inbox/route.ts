import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { inbox } from "@/lib/chat";
import { jsonError, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return jsonError("Нужно войти", 401);
  return Response.json({ items: await inbox(await getDb()) }, { headers: noStore });
}
