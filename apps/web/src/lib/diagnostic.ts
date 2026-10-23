/**
 * Бесплатный разбор. Админ создаёт блоки: заголовок + способ расчёта + текст для каждого
 * возможного значения. Человеку показываются активные блоки, для значения которых есть текст.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  SIGNS,
  SIGN_NAMES_RU,
  archetypeNumber,
  birthdayNumber,
  bodyLongitude,
  destinyMatrix,
  expressionNumber,
  julianEphemerisDay,
  lifePathNumber,
  personalYearNumber,
  personalityNumber,
  soulNumber,
  zodiacPosition,
} from "@diag/engine";
import type { BirthDate, DestinyMatrix } from "@diag/engine";
import type { Db } from "@/db";
import { diagnosticBlocks, diagnosticTexts } from "@/db/schema";

export interface MethodInput {
  birth: BirthDate;
  name: string;
  /** Текущий год — для числа личного года. */
  year: number;
}

export interface DiagnosticMethod {
  id: string;
  label: string;
  /** Все значения, которые может дать расчёт, — для них админ пишет тексты. */
  values: readonly number[];
  valueLabel: (value: number) => string;
  /** null — значение не определено (например, в имени нет гласных). */
  compute: (input: MethodInput) => number | null;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const WITH_MASTER = [...range(1, 9), 11, 22, 33];
const plain = (v: number) => String(v);
const masterLabel = (v: number) => (v > 9 ? `${v} (управляющее)` : String(v));

/** Буквенные числа: имя без русских букв даёт null, а не ошибку. */
function byName(fn: (name: string) => number | null) {
  return ({ name }: MethodInput) => {
    try {
      return fn(name);
    } catch {
      return null;
    }
  };
}

function matrixPoint(key: keyof DestinyMatrix, label: string): DiagnosticMethod {
  return {
    id: `matrix_${key}`,
    label: `Матрица судьбы: ${label}`,
    values: range(1, 22),
    valueLabel: (v) => `аркан ${v}`,
    compute: ({ birth }) => destinyMatrix(birth)[key],
  };
}

/** Знак Солнца на полдень по Гринвичу. Для рождённых в день смены знака возможна ошибка на один знак. */
function sunSign({ birth }: MethodInput): number {
  const jde = julianEphemerisDay(Date.UTC(birth.year, birth.month - 1, birth.day, 12));
  return SIGNS.indexOf(zodiacPosition(bodyLongitude("sun", jde)).sign) + 1;
}

export const METHODS: readonly DiagnosticMethod[] = [
  {
    id: "life_path",
    label: "Число жизненного пути",
    values: WITH_MASTER,
    valueLabel: masterLabel,
    compute: ({ birth }) => lifePathNumber(birth),
  },
  {
    id: "birthday",
    label: "Число дня рождения",
    values: [...range(1, 9), 11, 22],
    valueLabel: masterLabel,
    compute: ({ birth }) => birthdayNumber(birth),
  },
  {
    id: "personal_year",
    label: "Число личного года (текущий год)",
    values: range(1, 9),
    valueLabel: plain,
    compute: ({ birth, year }) => personalYearNumber(birth, year),
  },
  {
    id: "expression",
    label: "Число судьбы (по имени)",
    values: WITH_MASTER,
    valueLabel: masterLabel,
    compute: byName((name) => expressionNumber(name)),
  },
  {
    id: "soul",
    label: "Число души (гласные имени)",
    values: WITH_MASTER,
    valueLabel: masterLabel,
    compute: byName((name) => soulNumber(name)),
  },
  {
    id: "personality",
    label: "Число личности (согласные имени)",
    values: WITH_MASTER,
    valueLabel: masterLabel,
    compute: byName((name) => personalityNumber(name)),
  },
  {
    id: "archetype",
    label: "Архетип (1–12)",
    values: range(1, 12),
    valueLabel: plain,
    compute: ({ birth }) => archetypeNumber(birth),
  },
  {
    id: "sun_sign",
    label: "Знак зодиака",
    values: range(1, 12),
    valueLabel: (v) => SIGN_NAMES_RU[SIGNS[v - 1] ?? "aries"],
    compute: sunSign,
  },
  matrixPoint("a", "личные качества (A)"),
  matrixPoint("b", "таланты (B)"),
  matrixPoint("c", "зона роста (C)"),
  matrixPoint("d", "кармическая задача (D)"),
  matrixPoint("e", "центр, зона комфорта (E)"),
  matrixPoint("personalPurpose", "личное предназначение"),
  matrixPoint("socialPurpose", "социальное предназначение"),
  matrixPoint("spiritualPurpose", "духовное предназначение"),
];

const METHODS_BY_ID = new Map(METHODS.map((m) => [m.id, m]));

export function getMethod(id: string): DiagnosticMethod | undefined {
  return METHODS_BY_ID.get(id);
}

/** Дата из базы ('1990-03-15') в BirthDate. */
export function parseIsoDate(iso: string): BirthDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? NaN, month: month ?? NaN, day: day ?? NaN };
}

export interface DiagnosticSection {
  blockId: number;
  title: string;
  value: number;
  valueLabel: string;
  body: string;
}

/** Разбор для человека: активные блоки по порядку; блоки без текста для его значения пропускаются. */
export async function buildDiagnostic(db: Db, input: MethodInput): Promise<DiagnosticSection[]> {
  const blocks = await db
    .select()
    .from(diagnosticBlocks)
    .where(eq(diagnosticBlocks.active, true))
    .orderBy(asc(diagnosticBlocks.sort), asc(diagnosticBlocks.id));
  if (blocks.length === 0) return [];

  const computed = blocks.flatMap((b) => {
    const method = getMethod(b.method);
    const value = method?.compute(input) ?? null;
    return method && value !== null ? [{ block: b, method, value }] : [];
  });
  if (computed.length === 0) return [];

  const rows = await db
    .select()
    .from(diagnosticTexts)
    .where(inArray(diagnosticTexts.blockId, computed.map((c) => c.block.id)));
  const bodies = new Map(rows.map((r) => [`${r.blockId}:${r.value}`, r.body]));

  return computed.flatMap(({ block, method, value }) => {
    const body = bodies.get(`${block.id}:${value}`);
    return body
      ? [{ blockId: block.id, title: block.title, value, valueLabel: method.valueLabel(value), body }]
      : [];
  });
}

// --- Для админки ---

export function listBlocks(db: Db) {
  return db.select().from(diagnosticBlocks).orderBy(asc(diagnosticBlocks.sort), asc(diagnosticBlocks.id));
}

export async function getBlock(db: Db, id: number) {
  const [block] = await db.select().from(diagnosticBlocks).where(eq(diagnosticBlocks.id, id));
  return block ?? null;
}

/** Тексты блока: значение → текст. */
export async function getBlockTexts(db: Db, blockId: number): Promise<Map<number, string>> {
  const rows = await db.select().from(diagnosticTexts).where(eq(diagnosticTexts.blockId, blockId));
  return new Map(rows.map((r) => [r.value, r.body]));
}

/** Сохраняет тексты блока. Пустой текст удаляет значение — блок для него не показывается. */
export async function saveBlockTexts(db: Db, blockId: number, bodies: Map<number, string>): Promise<void> {
  for (const [value, raw] of bodies) {
    const body = raw.trim();
    if (body === "") {
      await db
        .delete(diagnosticTexts)
        .where(and(eq(diagnosticTexts.blockId, blockId), eq(diagnosticTexts.value, value)));
    } else {
      await db
        .insert(diagnosticTexts)
        .values({ blockId, value, body })
        .onConflictDoUpdate({
          target: [diagnosticTexts.blockId, diagnosticTexts.value],
          set: { body, updatedAt: new Date() },
        });
    }
  }
}
