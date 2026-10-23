import { getDb } from "@/db";
import { inbox } from "@/lib/chat";
import { currentExpert } from "@/lib/expert-auth";
import { jsonError, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentExpert())) return jsonError("Нужно войти", 401);
  return Response.json({ items: await inbox(await getDb()) }, { headers: noStore });
}
