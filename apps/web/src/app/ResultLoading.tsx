"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const STEPS = [
  "Считываем дату рождения",
  "Рассчитываем число судьбы",
  "Сверяем положение планет",
  "Читаем энергетику имени",
  "Составляем ваш разбор",
];

/**
 * Разбор «считается»: круг с рунами и звёздами, шаги расчёта и полоса прогресса. leftMs — сколько
 * ещё ждать (страница могла открыться не сразу после заявки); по окончании страница обновляется
 * и сервер отдаёт готовый разбор.
 */
export function ResultLoading({ leftMs, totalMs }: { leftMs: number; totalMs: number }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(totalMs - leftMs);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => setElapsed(Math.min(totalMs, totalMs - leftMs + Date.now() - start)), 250);
    const done = setTimeout(() => router.refresh(), leftMs);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [leftMs, totalMs, router]);

  const progress = elapsed / totalMs;
  const step = Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length));

  return (
    <main className="page page--narrow loading">
      <svg className="loading__orb" viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id="loading-core">
            <stop offset="0" stopColor="#fff3d6" />
            <stop offset="0.45" stopColor="#d9b66f" />
            <stop offset="1" stopColor="#d9b66f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="loading__ring loading__ring--outer">
          <circle cx="100" cy="100" r="92" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
          <circle cx="100" cy="100" r="82" stroke="currentColor" strokeWidth="0.6" opacity="0.35" />
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i} transform={`rotate(${i * 30} 100 100)`}>
              <path d="M100 8v10" stroke="currentColor" strokeWidth="1.2" />
              <path d={RUNES[i % RUNES.length]} stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </g>
        <g className="loading__ring loading__ring--middle">
          <circle cx="100" cy="100" r="64" stroke="currentColor" strokeWidth="1" strokeDasharray="2 7" opacity="0.7" />
          <path d="M100 36 155.4 132H44.6Z" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
          <path d="M100 164 44.6 68h110.8Z" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
        </g>
        <g className="loading__ring loading__ring--orbit">
          <circle cx="100" cy="18" r="3" fill="currentColor" />
          <circle cx="171" cy="141" r="2" fill="currentColor" opacity="0.7" />
          <circle cx="29" cy="141" r="1.5" fill="currentColor" opacity="0.5" />
        </g>
        <circle className="loading__core" cx="100" cy="100" r="30" fill="url(#loading-core)" />
        <path
          className="loading__star"
          d="M100 84 103.5 96.5 116 100 103.5 103.5 100 116 96.5 103.5 84 100 96.5 96.5Z"
          fill="#fff8e6"
        />
      </svg>

      <h1>Готовим ваш разбор</h1>
      <ol className="loading__steps" role="status" aria-live="polite">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "is-done" : i === step ? "is-active" : undefined}>
            {s}
            {i === step && "…"}
          </li>
        ))}
      </ol>
      <div className="loading__bar" aria-hidden="true">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </main>
  );
}

/** Знаки по кругу — простые руны линиями, чтобы не зависеть от шрифтов. */
const RUNES = [
  "M97 26v12M97 28l6 3M97 32l6 3", // феху
  "M100 26v12M100 26l4 6-4 6", // турисаз
  "M97 38V26l6 6v6", // уруз
  "M100 26v12M96 30l8 4", // науд
  "M96 26l8 12M104 26l-8 12", // гебо
  "M97 26v12M103 26v12M97 32h6", // хагалаз
];
