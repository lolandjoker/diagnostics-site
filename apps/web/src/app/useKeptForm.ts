"use client";

import { startTransition, useActionState } from "react";
import type { FormEvent } from "react";

/**
 * useActionState без сброса полей. Если передать действие в <form action>, React 19 после
 * отправки очищает форму — при ошибке человек потерял бы всё введённое.
 * Здесь форма отправляется из onSubmit, и поля остаются как есть.
 */
export function useKeptForm<S>(action: (prev: Awaited<S>, form: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, onSubmit, pending };
}
