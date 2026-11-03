"use client";

/**
 * Необязательный вопрос «Откуда вы о нас узнали?» внизу страницы разбора — для тех, кто пришёл
 * без короткого адреса (lib/sources.ts). Один ответ в одно касание; не отвлекает от главного.
 */
import { useState, useTransition } from "react";
import { saveHeardFrom } from "./actions";

export function HeardFromPoll({ leadId, options }: { leadId: string; options: readonly { key: string; label: string }[] }) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return <p className="poll poll__thanks">Спасибо, что ответили!</p>;

  return (
    <section className="poll" aria-label="Откуда вы о нас узнали?">
      <p className="poll__q">Откуда вы о нас узнали?</p>
      <div className="poll__options">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="poll__option"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await saveHeardFrom(leadId, o.key);
                setDone(true);
              })
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
