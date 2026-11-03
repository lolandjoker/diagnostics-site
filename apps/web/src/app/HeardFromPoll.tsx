"use client";

/**
 * Необязательный вопрос «Откуда вы о нас узнали?» — карточкой в чате над подсказками, для тех, кто открыл
 * просто taromba.com (не по короткому адресу, lib/sources.ts). Ответ в одно касание; ответил — карточка
 * говорит «спасибо» и исчезает.
 */
import { useEffect, useState, useTransition } from "react";
import { saveHeardFrom } from "./actions";

export function HeardFromPoll({ leadId, options }: { leadId: string; options: readonly { key: string; label: string }[] }) {
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setHidden(true), 2500);
    return () => clearTimeout(t);
  }, [done]);

  if (hidden) return null;
  if (done) return <p className="poll poll__thanks" role="status">Спасибо, что ответили!</p>;

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
