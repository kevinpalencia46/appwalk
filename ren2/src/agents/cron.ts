// Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
// Supports *, numbers, lists (1,2), ranges (1-5), steps (*/15, 0-30/5). Local time.

function field(spec: string, value: number, min: number, max: number): boolean {
  return spec.split(',').some((part) => {
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-').map(Number);
      lo = a;
      hi = b === undefined || Number.isNaN(b) ? (stepS ? max : a) : b;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || step <= 0) throw new Error(`bad cron field "${spec}"`);
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

export function validCron(expr: string): boolean {
  try {
    cronMatches(expr, new Date());
    return true;
  } catch {
    return false;
  }
}

export function cronMatches(expr: string, d: Date): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron needs 5 fields: "${expr}"`);
  const [mi, h, dom, mo, dow] = f;
  const dowV = d.getDay();
  const domOk = field(dom, d.getDate(), 1, 31);
  const dowOk = field(dow, dowV, 0, 7) || (dowV === 0 && field(dow, 7, 0, 7));
  // Standard cron: if both dom and dow are restricted, either may match.
  const dayOk = dom !== '*' && dow !== '*' ? domOk || dowOk : domOk && dowOk;
  return field(mi, d.getMinutes(), 0, 59) && field(h, d.getHours(), 0, 23) && field(mo, d.getMonth() + 1, 1, 12) && dayOk;
}

/** "2026-11-27T06:00" — one slot per matching minute so a schedule fires once. */
export function slotKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
