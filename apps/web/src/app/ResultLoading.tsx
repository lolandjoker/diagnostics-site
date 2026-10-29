"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Шаги — то, что потом действительно показано в шапке разбора (lib/portrait.ts). */
const STEPS = [
  "Считываем дату рождения",
  "Находим Солнце и Луну в день рождения",
  "Определяем знак и стихию",
  "Рассчитываем число жизненного пути",
  "Составляем ваш разбор",
];

/** Знаки зодиака по кругу — текстом, не эмодзи (U+FE0E). */
const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"].map((g) => `${g}\uFE0E`);
/** После 100 % — короткая пауза, чтобы человек увидел все шаги выполненными. */
const DONE_PAUSE_MS = 600;

/**
 * Разбор «считается»: круг со знаками зодиака, шаги расчёта и полоса прогресса. leftMs — сколько
 * ещё ждать (страница могла открыться не сразу после заявки); по окончании страница обновляется
 * и сервер отдаёт готовый разбор.
 */
export function ResultLoading({ leftMs, totalMs }: { leftMs: number; totalMs: number }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(totalMs - leftMs);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => setElapsed(Math.min(totalMs, totalMs - leftMs + Date.now() - start)), 250);
    let refresh: ReturnType<typeof setTimeout> | undefined;
    // Полоса доходит до 100 %, все шаги отмечены — и только потом готовый разбор
    const done = setTimeout(() => {
      setElapsed(totalMs);
      refresh = setTimeout(() => router.refresh(), DONE_PAUSE_MS);
    }, leftMs);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
      clearTimeout(refresh);
    };
  }, [leftMs, totalMs, router]);

  const progress = elapsed / totalMs;
  // Шаги равной длины; на 100 % выполнены все
  const step = progress >= 1 ? STEPS.length : Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length));

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
              <text x="100" y="31" className="loading__glyph" textAnchor="middle" fill="currentColor">
                {ZODIAC[i]}
              </text>
            </g>
          ))}
        </g>
        <g className="loading__ring loading__ring--middle">
          <circle cx="100" cy="100" r="64" stroke="currentColor" strokeWidth="1" strokeDasharray="2 7" opacity="0.7" />
          {/* Как в натальной карте: внутренний круг и деление на 12 домов */}
          <circle cx="100" cy="100" r="40" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
          {Array.from({ length: 12 }, (_, i) => (
            <path
              key={i}
              d="M100 36v24"
              transform={`rotate(${i * 30 + 15} 100 100)`}
              stroke="currentColor"
              strokeWidth="0.6"
              opacity="0.4"
            />
          ))}
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
