"use client";

/**
 * Поля рассылки внутри формы: готовые рассылки (шаблон заполняет всё сразу), кому — с числом получателей,
 * текст, значок подарка и кнопка. Отправляет форма вокруг (broadcastAction) — имена полей прежние.
 */
import { useState } from "react";
import { AUDIENCES, type Audience, BROADCAST_TEMPLATES } from "@/lib/broadcast-pages";
import { type ButtonKind, ButtonPicker } from "./ButtonPicker";

export function BroadcastComposer({ counts, maxLength }: { counts: Record<Audience, number>; maxLength: number }) {
  const [audience, setAudience] = useState<Audience>("all");
  const [body, setBody] = useState("");
  const [gift, setGift] = useState(false);
  const [kind, setKind] = useState<ButtonKind>("");
  const [label, setLabel] = useState("");
  const [template, setTemplate] = useState<string | null>(null);

  function apply(key: string) {
    const t = BROADCAST_TEMPLATES[key]!;
    setTemplate(key);
    setAudience(t.audience);
    setBody(t.body);
    setGift(t.gift);
    setKind(t.button);
    setLabel(t.label);
  }

  return (
    <>
      <div className="bc-templates" role="group" aria-label="Готовые рассылки">
        <span className="muted">Готовые рассылки:</span>
        {Object.entries(BROADCAST_TEMPLATES).map(([key, t]) => (
          <button key={key} type="button" className={template === key ? "bc-template is-current" : "bc-template"} onClick={() => apply(key)}>
            {t.title} <span className="muted">· {counts[t.audience]}</span>
          </button>
        ))}
      </div>
      <fieldset className="audience">
        <legend>Кому</legend>
        {(Object.keys(AUDIENCES) as Audience[]).map((a) => (
          <label key={a} className="check">
            <input type="radio" name="audience" value={a} checked={audience === a} onChange={() => setAudience(a)} />
            <span>
              {AUDIENCES[a]} — <b>{counts[a]}</b>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Текст (до {maxLength} символов)</span>
        <textarea name="body" rows={8} maxLength={maxLength} required value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="check">
        <input name="gift" type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
        <span>Значок подарка в начале</span>
      </label>
      <ButtonPicker kind={kind} label={label} onKind={setKind} onLabel={setLabel} />
    </>
  );
}
