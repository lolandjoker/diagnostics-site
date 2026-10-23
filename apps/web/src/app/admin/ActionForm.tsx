"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useKeptForm } from "../useKeptForm";

export type ActionResult = { ok: boolean; message: string } | null;
export type AdminAction = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/**
 * Форма админки: на время сохранения поля блокируются, результат показывается под формой.
 * resetOnSuccess — очистить поля после успеха (для форм «добавить ещё одно»).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: AdminAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const { state, onSubmit, pending } = useKeptForm<ActionResult>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className ?? "admin-form"}>
      <fieldset disabled={pending}>{children}</fieldset>
      {state && (
        <p className={state.ok ? "notice notice--ok" : "notice notice--error"} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
