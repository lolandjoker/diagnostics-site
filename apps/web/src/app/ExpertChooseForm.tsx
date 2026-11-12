"use client";

/**
 * «Написать эксперту» / «Выбрать эксперта». Почты в заявке ещё нет — кнопка открывает окно «Куда прислать разбор?»
 * без кнопки закрытия: чат начинается только после того, как человек укажет почту (её же проверяет сервер,
 * chooseExpert). Почта уже есть — сразу в чат. Окно — поверх всей страницы (портал в body: у карточки эксперта
 * свой слой, внутри него fixed не растягивается на экран), поле и кнопка привязаны к форме атрибутом form —
 * почта уходит вместе с выбором эксперта.
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { chooseExpert } from "./razbor/[id]/eksperty/actions";

export function ExpertChooseForm({
  leadId,
  expertId,
  returnTo,
  label,
  buttonClassName = "button",
  needEmail,
  className,
  children,
}: {
  leadId: string;
  expertId: number;
  /** Куда вернуть при ошибке (профиль эксперта); без него — список экспертов. */
  returnTo?: string;
  label: string;
  buttonClassName?: string;
  needEmail: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();

  return (
    <form id={formId} action={chooseExpert} className={className} onSubmit={() => setPending(true)}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="expertId" value={expertId} />
      {returnTo && <input type="hidden" name="return" value={returnTo} />}
      {needEmail ? (
        <button type="button" className={buttonClassName} onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <SubmitButton className={buttonClassName}>{label}</SubmitButton>
      )}
      {children}
      {open && createPortal(<EmailGate formId={formId} pending={pending} />, document.body)}
    </form>
  );
}

/** Окно «Куда прислать ваш разбор?»: закрыть нельзя, только указать почту. */
function EmailGate({ formId, pending }: { formId: string; pending: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="tg-invite email-gate" role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`}>
      <div className="tg-invite__card">
        <span className="tg-invite__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="m4 7 8 6 8-6" strokeLinecap="round" />
          </svg>
        </span>
        <h2 id={`${formId}-title`} className="tg-invite__title">
          Куда прислать ваш разбор?
        </h2>
        <p className="tg-invite__text">Укажите почту — пришлём на неё подробный разбор, как только он будет готов, чтобы он у вас сохранился.</p>
        <div className="email-gate__field">
          <input
            ref={input}
            form={formId}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="ваша@почта.ru"
            aria-label="Ваша почта"
          />
        </div>
        <button type="submit" form={formId} className="tg-invite__go email-gate__go" disabled={pending}>
          {pending ? "Открываем чат…" : "Перейти в чат с экспертом"}
        </button>
        <p className="email-gate__note">Без спама и рекламы — только письмо с вашим разбором. Отписаться можно в любой момент.</p>
      </div>
    </div>
  );
}

function SubmitButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Открываем чат…" : children}
    </button>
  );
}
