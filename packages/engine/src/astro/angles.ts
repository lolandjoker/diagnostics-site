export const DEG = Math.PI / 180;

/** Приводит угол в градусах к [0, 360). */
export function norm360(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

/** Разность углов b − a в градусах, приведённая к (−180, 180]. */
export function signedDiff(a: number, b: number): number {
  let d = norm360(b - a);
  if (d > 180) d -= 360;
  return d;
}

/** Кратчайшее расстояние между углами, 0–180°. */
export function separation(a: number, b: number): number {
  return Math.abs(signedDiff(a, b));
}

export function sinD(deg: number): number {
  return Math.sin(deg * DEG);
}

export function cosD(deg: number): number {
  return Math.cos(deg * DEG);
}

export function tanD(deg: number): number {
  return Math.tan(deg * DEG);
}

/** atan2 в градусах, результат в [0, 360). */
export function atan2D(y: number, x: number): number {
  return norm360(Math.atan2(y, x) / DEG);
}
