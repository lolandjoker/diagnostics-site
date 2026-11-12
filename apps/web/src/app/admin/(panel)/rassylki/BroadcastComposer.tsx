"use client";

/**
 * Поля рассылки внутри формы, два режима:
 * - chat — от экспертов: кому, условия, «клиентам эксперта», серия сообщений с фото или видео (уходят в чаты);
 * - bot — системная: куда (Telegram, почта или оба), готовые рассылки (шаблон заполняет всё сразу), кому, условия,
 *   одно сообщение, тема письма, значок подарка и кнопка.
 * Условия — заявка старше N часов, молчит N часов; число получателей пересчитывается сразу.
 * Отправляет форма вокруг (broadcastAction / expertBroadcastAction): поля body_<i>, media_<i>, messages_count,
 * registered_on/registered_hours, silent_on/silent_hours, expert, channels, subject, email_skip_tg.
 */
import { useEffect, useRef, useState } from "react";
import {
  AUDIENCES,
  type Audience,
  BROADCAST_TEMPLATES,
  CHANNELS,
  type ChannelCount,
  type Channels,
  MAX_BROADCAST_MESSAGES,
  MAX_CAPTION,
  MAX_FILTER_HOURS,
  MAX_MEDIA_BYTES,
  MAX_PHOTO_BYTES,
  MAX_SUBJECT,
  MEDIA_ACCEPT,
  hasEmail,
  hasTelegram,
  mediaKind,
} from "@/lib/broadcast-pages";
import { type ButtonKind, ButtonPicker } from "./ButtonPicker";

type Attached = { name: string; size: number; kind: "photo" | "video" | null; url: string };
type Draft = { id: number; body: string; file: Attached | null };
type Filter = { on: boolean; hours: number };

const mb = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;

export function BroadcastComposer({
  counts,
  maxLength,
  mode,
  experts = [],
}: {
  counts: Record<Audience, ChannelCount>;
  maxLength: number;
  mode: "bot" | "chat";
  experts?: { id: number; name: string }[];
}) {
  const chat = mode === "chat";
  const [channels, setChannels] = useState<Channels>("telegram");
  const [skipTg, setSkipTg] = useState(false);
  const [subject, setSubject] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [expert, setExpert] = useState("");
  const [gift, setGift] = useState(false);
  const [kind, setKind] = useState<ButtonKind>("");
  const [label, setLabel] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Filter>({ on: false, hours: 24 });
  const [silent, setSilent] = useState<Filter>({ on: false, hours: 24 });
  const [drafts, setDrafts] = useState<Draft[]>([{ id: 0, body: "", file: null }]);
  const nextId = useRef(1);

  function apply(key: string) {
    const t = BROADCAST_TEMPLATES[key]!;
    setTemplate(key);
    setAudience(t.audience);
    setGift(t.gift);
    setKind(t.button);
    setLabel(t.label);
    setSubject(t.subject);
    setDrafts((list) => list.map((d, i) => (i === 0 ? { ...d, body: t.body } : d)));
  }

  const update = (id: number, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const add = () => setDrafts((list) => [...list, { id: nextId.current++, body: "", file: null }]);
  const remove = (id: number) =>
    setDrafts((list) => {
      const gone = list.find((d) => d.id === id);
      if (gone?.file) URL.revokeObjectURL(gone.file.url);
      return list.filter((d) => d.id !== id);
    });

  // От экспертов — только Telegram (чаты); системная — по выбору
  const tg = chat || hasTelegram(channels);
  const mail = !chat && hasEmail(channels);
  const skip = mail && tg && skipTg;
  const filtered = registered.on || silent.on || skip;
  // От экспертов считаем всегда: нужен подходящий чат, а не просто Telegram
  const live = useLiveCount({ audience, registered, silent, kind: mode, expert, skipTg: skip }, filtered || chat);
  const total = filtered || chat ? live : counts[audience];
  /** «1234» или «1234 в Telegram · 90 на почту» — по выбранным каналам. */
  const perChannel = (c: ChannelCount | null, bold = true) => {
    const n = (v: number | undefined) => (bold ? <b>{v ?? "…"}</b> : (v ?? "…"));
    if (chat || !mail) return n(c?.telegram);
    if (!tg) return n(c?.email);
    return (
      <>
        {n(c?.telegram)} в Telegram · {n(c?.email)} на почту
      </>
    );
  };

  const mediaBytes = drafts.reduce((sum, d) => sum + (d.file?.size ?? 0), 0);
  const problems = [
    ...drafts.flatMap((d, i) =>
      !d.file
        ? []
        : !d.file.kind
          ? [`Сообщение ${i + 1}: подойдут фото JPG, PNG, WebP или видео MP4, MOV`]
          : d.file.kind === "photo" && d.file.size > MAX_PHOTO_BYTES
            ? [`Сообщение ${i + 1}: фото больше 10 МБ`]
            : [],
    ),
    ...(mediaBytes > MAX_MEDIA_BYTES ? [`Фото и видео вместе — ${mb(mediaBytes)}, можно до 50 МБ`] : []),
  ];

  return (
    <>
      {!chat && (
        <fieldset className="audience bc-channels">
          <legend>Куда</legend>
          {(Object.keys(CHANNELS) as Channels[]).map((c) => (
            <label key={c} className="check">
              <input type="radio" name="channels" value={c} checked={channels === c} onChange={() => setChannels(c)} />
              <span>{CHANNELS[c]}</span>
            </label>
          ))}
          {mail && tg && (
            <label className="check bc-skip">
              <input name="email_skip_tg" type="checkbox" checked={skipTg} onChange={(e) => setSkipTg(e.target.checked)} />
              <span>На почту — только тем, кто не подключил Telegram (чтобы не писать человеку дважды)</span>
            </label>
          )}
          {mail && (
            <p className="muted bc-note">
              Письмо уйдёт каждому, кто указал почту и не отписался, — одно на адрес. Внизу письма — «Отписаться».
              Каждое письмо тратит лимит тарифа UniSender.
            </p>
          )}
        </fieldset>
      )}
      {!chat && (
        <div className="bc-templates" role="group" aria-label="Готовые рассылки">
          <span className="muted">Готовые рассылки:</span>
          {Object.entries(BROADCAST_TEMPLATES).map(([key, t]) => (
            <button key={key} type="button" className={template === key ? "bc-template is-current" : "bc-template"} onClick={() => apply(key)}>
              {t.title} <span className="muted">· {perChannel(counts[t.audience], false)}</span>
            </button>
          ))}
        </div>
      )}
      <fieldset className="audience">
        <legend>Кому</legend>
        {(Object.keys(AUDIENCES) as Audience[]).map((a) => (
          <label key={a} className="check">
            <input type="radio" name="audience" value={a} checked={audience === a} onChange={() => setAudience(a)} />
            <span>
              {AUDIENCES[a]} — {perChannel(counts[a])}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="audience bc-filters">
        <legend>Условия — необязательно, вместе с «Кому»</legend>
        <FilterRow name="registered" value={registered} onChange={setRegistered}>
          Заявка оставлена больше
        </FilterRow>
        <FilterRow name="silent" value={silent} onChange={setSilent} after="(и те, кто не писал вовсе)">
          Не писали нам в чат больше
        </FilterRow>
        {chat && (
          <label className="field bc-expert">
            <span>Клиентам эксперта</span>
            <select name="expert" value={expert} onChange={(e) => setExpert(e.target.value)}>
              <option value="">Всем — каждому от эксперта его чата</option>
              {experts.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="bc-total">
          Получат: {perChannel(total)}
          {(filtered || chat) && <span className="muted"> — из {perChannel(counts[audience], false)} по «Кому»</span>}
        </p>
        {chat && (
          <p className="muted bc-note">
            Сообщение встанет в чат клиента от имени эксперта и придёт ему в Telegram. Если чатов несколько — в самый
            свежий (с выбранным экспертом). Нет чата — не получит.
          </p>
        )}
      </fieldset>

      {mail && (
        <label className="field">
          <span>Тема письма</span>
          <input
            name="subject"
            value={subject}
            maxLength={MAX_SUBJECT}
            required
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Например: Ваш подарок от Таромбы ✨"
          />
        </label>
      )}
      <input type="hidden" name="messages_count" value={drafts.length} />
      <div className="bc-messages">
        {drafts.map((d, i) => (
          <MessageEditor
            key={d.id}
            index={i}
            total={drafts.length}
            draft={d}
            media={chat}
            maxLength={maxLength}
            onBody={(body) => update(d.id, { body })}
            onFile={(file) => {
              if (d.file) URL.revokeObjectURL(d.file.url);
              update(d.id, { file });
            }}
            onRemove={() => remove(d.id)}
          />
        ))}
        {chat && drafts.length < MAX_BROADCAST_MESSAGES && (
          <button type="button" className="bc-add" onClick={add}>
            + Ещё сообщение
          </button>
        )}
        <p className="muted bc-note">
          {chat
            ? "Сообщения уходят подряд, одно за другим. {имя} в тексте заменится на имя клиента. Фото — до 10 МБ, все файлы вместе — до 50 МБ."
            : [
                tg && "Внизу бот добавит «Отключить сообщения — /stop».",
                mail && "В письме текст встанет так же, жирный — тоже; кнопка — под текстом, личная ведёт на страницу человека на сайте.",
              ]
                .filter(Boolean)
                .join(" ")}
        </p>
        {problems.map((p) => (
          <p key={p} className="notice notice--error">
            {p}
          </p>
        ))}
      </div>

      {!chat && (
        <>
          <label className="check">
            <input name="gift" type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
            <span>Значок подарка в начале</span>
          </label>
          <ButtonPicker kind={kind} label={label} onKind={setKind} onLabel={setLabel} />
        </>
      )}
    </>
  );
}

/** Условие: галочка и число часов. */
function FilterRow({
  name,
  value,
  onChange,
  after,
  children,
}: {
  name: string;
  value: Filter;
  onChange: (f: Filter) => void;
  after?: string;
  children: string;
}) {
  return (
    <div className="check bc-filter">
      <input id={`${name}_on`} name={`${name}_on`} type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
      <label htmlFor={`${name}_on`}>{children}</label>
      <input
        className="bc-hours"
        name={`${name}_hours`}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_FILTER_HOURS}
        value={value.hours}
        aria-label="часов"
        onChange={(e) => onChange({ on: true, hours: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
      />
      <span>ч{after ? ` ${after}` : ""}</span>
    </div>
  );
}

/** Сколько получат при условиях — с сервера, с паузой после ввода; прошлый запрос отменяется. */
function useLiveCount(
  {
    audience,
    registered,
    silent,
    kind,
    expert,
    skipTg,
  }: { audience: Audience; registered: Filter; silent: Filter; kind: "bot" | "chat"; expert: string; skipTg: boolean },
  enabled: boolean,
): ChannelCount | null {
  const [count, setCount] = useState<ChannelCount | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    const q = new URLSearchParams({ audience, kind });
    if (expert) q.set("expert", expert);
    if (registered.on && registered.hours > 0) q.set("registered", String(registered.hours));
    if (silent.on && silent.hours > 0) q.set("silent", String(silent.hours));
    if (skipTg) q.set("skip_tg", "1");
    const timer = setTimeout(() => {
      setCount(null);
      fetch(`/admin/api/broadcast-count?${q}`, { signal: ctl.signal, cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ count: number; email?: number }>) : null))
        .then((r) => r && setCount({ telegram: r.count, email: r.email ?? 0 }))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [audience, registered.on, registered.hours, silent.on, silent.hours, kind, expert, skipTg, enabled]);
  return count;
}

/** Одно сообщение серии: текст и фото или видео. Файл — в обычном поле формы (media_<i>), здесь только превью. */
function MessageEditor({
  index,
  total,
  draft,
  media,
  maxLength,
  onBody,
  onFile,
  onRemove,
}: {
  index: number;
  total: number;
  draft: Draft;
  /** Можно приложить фото или видео. */
  media: boolean;
  maxLength: number;
  onBody: (body: string) => void;
  onFile: (file: Attached | null) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const f = draft.file;
  const longCaption = f !== null && draft.body.trim().length > MAX_CAPTION;
  return (
    <div className="bc-message">
      <div className="bc-message__head">
        <b>{total > 1 ? `Сообщение ${index + 1}` : "Сообщение"}</b>
        {total > 1 && (
          <button type="button" className="bc-link" onClick={onRemove}>
            Удалить
          </button>
        )}
      </div>
      <textarea
        name={`body_${index}`}
        rows={index === 0 ? 8 : 5}
        maxLength={maxLength}
        value={draft.body}
        onChange={(e) => onBody(e.target.value)}
        placeholder={f ? "Подпись к фото или видео — необязательно" : media ? "Текст сообщения. {имя} — имя клиента" : "Текст сообщения. Жирный — **так**"}
        aria-label={`Текст сообщения ${index + 1}`}
      />
      {media && (
      <div className="bc-media">
        <label className="bc-file">
          <input
            ref={fileRef}
            type="file"
            name={`media_${index}`}
            accept={MEDIA_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0];
              onFile(file ? { name: file.name, size: file.size, kind: mediaKind(file.type), url: URL.createObjectURL(file) } : null);
            }}
          />
          <span>{f ? "Заменить файл" : "Фото или видео"}</span>
        </label>
        {f && (
          <>
            {f.kind === "photo" && <img className="bc-thumb" src={f.url} alt="" />}
            {f.kind === "video" && <video className="bc-thumb" src={f.url} muted playsInline preload="metadata" />}
            <span className="muted bc-file-name">
              {f.name} · {mb(f.size)}
            </span>
            <button
              type="button"
              className="bc-link"
              onClick={() => {
                if (fileRef.current) fileRef.current.value = "";
                onFile(null);
              }}
            >
              Убрать
            </button>
          </>
        )}
      </div>
      )}
      {longCaption && (
        <p className="muted bc-note">Текст длиннее {MAX_CAPTION} символов — в подпись не влезет: сначала уйдёт файл, следом текст.</p>
      )}
    </div>
  );
}
