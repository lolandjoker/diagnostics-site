/**
 * Обработчики звонка, общие для клиента, эксперта и админа. Кто есть кто и к какому чату есть доступ,
 * проверяет сам маршрут; здесь — разбор запроса и действия.
 * GET ?call=<id>&after=<номер сигнала> — состояние звонка и новые сигналы другой стороны.
 * POST {action, callId?, sdp?}:
 *   клиент — request (попросить звонок), accept, decline, hangup, signal (answer);
 *   сотрудник — start, hangup, signal (offer).
 */
import type { Db } from "@/db";
import { addSignal, answerCall, hangupCall, pollCall, requestCall, startCall } from "./calls";
import type { CallCaller, CallSide } from "./calls";
import type { Conversation } from "./chat";
import { afterParam, jsonBody, jsonError, noStore } from "./http";

export async function callGet(req: Request, db: Db, conversation: Conversation, side: CallSide): Promise<Response> {
  const callId = new URL(req.url).searchParams.get("call");
  const poll = await pollCall(db, conversation, side, { callId, after: afterParam(req) }, new Date());
  return Response.json(poll, { headers: noStore });
}

export async function callPost(
  req: Request,
  db: Db,
  conversation: Conversation,
  who: { side: "client" } | ({ side: "staff" } & CallCaller),
): Promise<Response> {
  const data = await jsonBody(req);
  const action = typeof data?.action === "string" ? data.action : "";
  const callId = typeof data?.callId === "string" ? data.callId : "";
  const sdp = typeof data?.sdp === "string" ? data.sdp : "";
  const now = new Date();

  if (action === "hangup") {
    await hangupCall(db, conversation, callId, now);
    return Response.json({ ok: true }, { headers: noStore });
  }
  if (action === "signal") {
    const res = await addSignal(db, conversation, callId, who.side, sdp);
    return res.ok ? Response.json(res, { headers: noStore }) : jsonError(res.error, 409);
  }

  if (who.side === "client") {
    if (action === "request") {
      const res = await requestCall(db, conversation, now);
      return res.ok ? Response.json(res, { headers: noStore }) : jsonError(res.error, 429);
    }
    if (action === "accept" || action === "decline") {
      const res = await answerCall(db, conversation, callId, action === "accept", now);
      return res.ok ? Response.json(res, { headers: noStore }) : jsonError(res.error, 409);
    }
  } else if (action === "start") {
    const by: CallCaller = who.caller === "expert" ? { caller: "expert", expertId: who.expertId } : { caller: "admin" };
    const res = await startCall(db, conversation, by, now);
    return res.ok ? Response.json(res, { headers: noStore }) : jsonError(res.error, 409);
  }
  return jsonError("Неизвестное действие", 400);
}
