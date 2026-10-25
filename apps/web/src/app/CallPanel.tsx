"use client";

/**
 * Голосовой звонок в чате через браузер (WebRTC).
 * role=staff — эксперт или админ: кнопка «Позвонить», исходящий вызов, разговор — полосой над чатом.
 * role=client — кнопка «Заказать звонок» и экран входящего звонка/разговора поверх чата.
 *
 * Состояние звонка хранит сервер (lib/calls.ts); компонент его опрашивает и пересылает «рукопожатие»
 * браузеров: сотрудник — offer, клиент — answer. Адреса для соединения (ICE) браузер сначала собирает
 * целиком (до ICE_WAIT_MS) и отправляет одним сообщением — так проще при связи через опрос.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallPoll, CallView, IceServer } from "@/lib/calls";
import { Avatar } from "./Avatar";

const IDLE_POLL_MS = 2500;
const CALL_POLL_MS = 1000;
const ICE_WAIT_MS = 3000;
const ENDED_SHOW_MS = 3000;

type Role = "client" | "staff";

/** Гудки: ring — входящий (два коротких), back — исходящий (длинный). Без нажатия браузер может не дать играть звуку. */
function startTone(kind: "ring" | "back"): () => void {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const beep = (at: number, len: number, freq: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    gain.gain.setValueAtTime(0.18, at + len - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + len);
  };
  const play = () => {
    const t = ctx.currentTime + 0.05;
    if (kind === "ring") {
      beep(t, 0.35, 880);
      beep(t + 0.5, 0.35, 880);
      navigator.vibrate?.([300, 200, 300]);
    } else {
      beep(t, 1, 425);
    }
  };
  play();
  const timer = setInterval(play, kind === "ring" ? 2000 : 4000);
  return () => {
    clearInterval(timer);
    navigator.vibrate?.(0);
    void ctx.close().catch(() => {});
  };
}

/** Ждём, пока браузер соберёт адреса для соединения (или ICE_WAIT_MS — чего хватает почти всегда). */
function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, ICE_WAIT_MS);
  });
}

function micError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Нет доступа к микрофону — разрешите его для этого сайта в настройках браузера";
  if (name === "NotFoundError") return "Микрофон не найден";
  return "Не удалось включить микрофон";
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function PhoneIcon({ down }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
      style={down ? { transform: "rotate(135deg)" } : undefined}
    >
      <path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.6a1 1 0 01-.25 1z" />
    </svg>
  );
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" strokeLinecap="round" />
      {off && <path d="M4 4l16 16" strokeLinecap="round" />}
    </svg>
  );
}

export function CallPanel({
  url,
  role,
  peer,
  initialRequested = false,
}: {
  /** Адрес звонка: GET — опрос, POST — действия (lib/call-http.ts). */
  url: string;
  role: Role;
  /** Кого видно на экране звонка: для клиента — эксперт чата, для сотрудника — клиент. */
  peer: { name: string; photo?: string | null | undefined };
  /** Клиент уже просил позвонить. */
  initialRequested?: boolean;
}) {
  const [call, setCall] = useState<CallView | null>(null);
  /** Звонок ведёт эта вкладка (есть микрофон), а не другая вкладка или коллега. */
  const [mine, setMine] = useState(false);
  const [requested, setRequested] = useState(initialRequested);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const callRef = useRef<CallView | null>(null);
  const mineRef = useRef(false);
  const lastSignal = useRef(0);
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const ice = useRef<IceServer[]>([]);
  const sent = useRef(false);
  const ticking = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);
  const stopTone = useRef<(() => void) | null>(null);

  const tone = useCallback((kind: "ring" | "back" | null) => {
    stopTone.current?.();
    stopTone.current = kind ? startTone(kind) : null;
  }, []);

  const cleanup = useCallback(() => {
    tone(null);
    pc.current?.close();
    pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    sent.current = false;
    lastSignal.current = 0;
    mineRef.current = false;
    setMine(false);
    setConnected(false);
    setMuted(false);
  }, [tone]);

  const send = useCallback(
    async (body: Record<string, string>) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; call?: CallView };
      if (!res.ok) throw new Error(data.error ?? "Не удалось выполнить действие");
      return data;
    },
    [url],
  );

  const createPeer = useCallback(() => {
    const p = new RTCPeerConnection({ iceServers: ice.current });
    const stream = local.current;
    stream?.getTracks().forEach((t) => p.addTrack(t, stream));
    p.ontrack = (e) => {
      const el = audio.current;
      if (!el) return;
      el.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void el.play().catch(() => {});
    };
    p.onconnectionstatechange = () => {
      if (p.connectionState === "connected") {
        setConnected(true);
        tone(null);
      }
      if (p.connectionState === "failed") {
        setError("Не удалось соединиться — проверьте интернет и попробуйте ещё раз");
        const c = callRef.current;
        if (c) void send({ action: "hangup", callId: c.id }).catch(() => {});
      }
    };
    pc.current = p;
    return p;
  }, [send, tone]);

  /** Отправить своё описание соединения: сотрудник — offer, клиент — answer. */
  const sendDescription = useCallback(
    async (p: RTCPeerConnection, callId: string) => {
      await waitIce(p);
      const sdp = p.localDescription?.sdp;
      if (sdp) await send({ action: "signal", callId, sdp });
    },
    [send],
  );

  const tick = useCallback(async () => {
    if (ticking.current) return;
    ticking.current = true;
    try {
      const current = callRef.current;
      const q = new URLSearchParams({ after: String(lastSignal.current) });
      if (current) q.set("call", current.id);
      const res = await fetch(`${url}?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const poll = (await res.json()) as CallPoll;
      setRequested(poll.callRequested);
      if (poll.iceServers.length > 0) ice.current = poll.iceServers;

      const next = poll.call;
      const open = next && (next.status === "ringing" || next.status === "active");
      if (!open) {
        if (current) {
          const label =
            next?.status === "declined"
              ? "Звонок отклонён"
              : next?.status === "missed"
                ? role === "staff"
                  ? "Не ответили"
                  : "Пропущенный звонок"
                : "Звонок завершён";
          cleanup();
          setEnded(label);
          setTimeout(() => setEnded(null), ENDED_SHOW_MS);
        }
        callRef.current = null;
        setCall(null);
        return;
      }
      callRef.current = next;
      setCall(next);

      // Клиент обновил страницу посреди разговора — микрофона в этой вкладке нет, разговор не продолжить
      if (role === "client" && next.status === "active" && !mineRef.current) {
        await send({ action: "hangup", callId: next.id }).catch(() => {});
        return;
      }
      if (!mineRef.current) return;

      if (role === "staff" && next.status === "active" && !sent.current) {
        sent.current = true;
        tone(null);
        const p = createPeer();
        await p.setLocalDescription(await p.createOffer());
        await sendDescription(p, next.id);
      }
      for (const s of poll.signals) {
        lastSignal.current = s.id;
        if (role === "staff" && s.kind === "answer" && pc.current && !pc.current.remoteDescription) {
          await pc.current.setRemoteDescription({ type: "answer", sdp: s.sdp });
        }
        if (role === "client" && s.kind === "offer" && !sent.current) {
          sent.current = true;
          const p = createPeer();
          await p.setRemoteDescription({ type: "offer", sdp: s.sdp });
          await p.setLocalDescription(await p.createAnswer());
          await sendDescription(p, next.id);
        }
      }
    } catch {
      // Нет связи или сбой соединения — следующий опрос попробует снова; пропавший звонок закроет сервер
    } finally {
      ticking.current = false;
    }
  }, [cleanup, createPeer, role, send, sendDescription, tone, url]);

  // Опрос: во время звонка — раз в секунду; клиент в остальное время ждёт входящий; сотрудник — только проверка при открытии
  const open = call !== null && (call.status === "ringing" || call.status === "active");
  useEffect(() => {
    void tick();
    const ms = open ? CALL_POLL_MS : role === "client" ? IDLE_POLL_MS : null;
    if (ms === null) return;
    const timer = setInterval(() => void tick(), ms);
    return () => clearInterval(timer);
  }, [open, role, tick, mine]);

  // Входящий звонок: гудки, пока клиент не ответил
  const incoming = role === "client" && call?.status === "ringing" && !mine;
  useEffect(() => {
    if (!incoming) return;
    tone("ring");
    const title = document.title;
    document.title = `📞 ${peer.name} звонит`;
    return () => {
      tone(null);
      document.title = title;
    };
  }, [incoming, peer.name, tone]);

  // Таймер разговора
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  // Ушли со страницы или закрыли вкладку — положить трубку (иначе сервер закроет звонок сам через SEEN_TIMEOUT_MS)
  useEffect(() => {
    const hangupOnLeave = () => {
      const c = callRef.current;
      if (c && mineRef.current) {
        navigator.sendBeacon?.(url, new Blob([JSON.stringify({ action: "hangup", callId: c.id })], { type: "application/json" }));
      }
    };
    window.addEventListener("pagehide", hangupOnLeave);
    return () => {
      window.removeEventListener("pagehide", hangupOnLeave);
      hangupOnLeave();
      cleanup();
    };
  }, [cleanup, url]);

  async function getMic(): Promise<boolean> {
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      mineRef.current = true;
      setMine(true);
      return true;
    } catch (e) {
      setError(micError(e));
      return false;
    }
  }

  async function startCall() {
    setError(null);
    setBusy(true);
    try {
      if (!(await getMic())) return;
      const { call: started } = await send({ action: "start" });
      if (!started) throw new Error("Не удалось начать звонок");
      callRef.current = started;
      setCall(started);
      tone("back");
    } catch (e) {
      cleanup();
      setError(e instanceof Error ? e.message : "Не удалось начать звонок");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    const c = callRef.current;
    if (!c) return;
    setError(null);
    setBusy(true);
    tone(null);
    try {
      if (!(await getMic())) return;
      const { call: answered } = await send({ action: "accept", callId: c.id });
      if (answered) {
        callRef.current = answered;
        setCall(answered);
      }
    } catch (e) {
      cleanup();
      setError(e instanceof Error ? e.message : "Не удалось ответить");
    } finally {
      setBusy(false);
    }
  }

  async function finish(action: "decline" | "hangup") {
    const c = callRef.current;
    if (!c) return;
    tone(null);
    await send({ action, callId: c.id }).catch(() => {});
    await tick();
  }

  async function requestCall() {
    setBusy(true);
    setError(null);
    try {
      await send({ action: "request" });
      setRequested(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить просьбу");
    } finally {
      setBusy(false);
    }
  }

  function toggleMute() {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  const talking = call?.status === "active" && mine;
  const status = talking
    ? connected
      ? clock(now - new Date(call.answeredAt ?? now).getTime())
      : "Соединение…"
    : call?.status === "ringing" && mine
      ? role === "staff"
        ? "Звоним…"
        : "Соединение…"
      : "";

  const controls = (
    <>
      <button
        type="button"
        className={muted ? "call-btn call-btn--muted" : "call-btn"}
        onClick={toggleMute}
        disabled={!talking}
        aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
        title={muted ? "Включить микрофон" : "Выключить микрофон"}
      >
        <MicIcon off={muted} />
      </button>
      <button
        type="button"
        className="call-btn call-btn--end"
        onClick={() => void finish("hangup")}
        aria-label="Завершить звонок"
        title="Завершить"
      >
        <PhoneIcon down />
      </button>
    </>
  );

  if (role === "staff") {
    return (
      <div className="call-staff">
        <audio ref={audio} autoPlay playsInline />
        {mine && call ? (
          <div className="call-bar">
            <span className={connected ? "call-bar__status call-bar__status--live" : "call-bar__status"}>{status}</span>
            {controls}
          </div>
        ) : open ? (
          <div className="call-bar">
            <span className="call-bar__status">В этом чате уже идёт звонок</span>
            <button type="button" className="call-btn call-btn--end" onClick={() => void finish("hangup")} title="Завершить">
              <PhoneIcon down />
            </button>
          </div>
        ) : (
          <div className="call-bar call-bar--idle">
            <button type="button" className="call-start" onClick={() => void startCall()} disabled={busy}>
              <PhoneIcon /> Позвонить
            </button>
            {requested && <span className="call-request">Клиент просит позвонить</span>}
            {ended && <span className="muted">{ended}</span>}
          </div>
        )}
        {error && <p className="form__error">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <audio ref={audio} autoPlay playsInline />
      <button
        type="button"
        className={requested ? "chat__icon-button chat__icon-button--done" : "chat__icon-button"}
        onClick={() => void requestCall()}
        disabled={busy || requested || open}
        aria-label={requested ? "Звонок заказан" : "Заказать звонок"}
        title={requested ? "Звонок заказан — эксперт позвонит вам здесь, в чате" : "Заказать звонок"}
      >
        <PhoneIcon />
      </button>

      {(incoming || (mine && call)) && (
        <div className="call-screen" role="dialog" aria-label="Звонок">
          <div className={incoming ? "call-screen__avatar call-screen__avatar--ringing" : "call-screen__avatar"}>
            <Avatar name={peer.name} photo={peer.photo} size={112} />
          </div>
          <b className="call-screen__name">{peer.name}</b>
          <span className="call-screen__status">{incoming ? "звонит вам…" : status}</span>
          {error && <p className="form__error">{error}</p>}
          <div className="call-screen__actions">
            {incoming ? (
              <>
                <button type="button" className="call-btn call-btn--big call-btn--end" onClick={() => void finish("decline")} disabled={busy}>
                  <PhoneIcon down />
                  <span>Отклонить</span>
                </button>
                <button type="button" className="call-btn call-btn--big call-btn--accept" onClick={() => void accept()} disabled={busy}>
                  <PhoneIcon />
                  <span>Принять</span>
                </button>
              </>
            ) : (
              controls
            )}
          </div>
        </div>
      )}

      {(ended || (error && !incoming && !mine)) && (
        <div className="call-toast" role="status">
          {ended ?? error}
        </div>
      )}
    </>
  );
}
