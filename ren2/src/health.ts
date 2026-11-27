// Machine health from /proc and /sys (Linux / Raspberry Pi OS). Missing sensors are
// reported as null, never guessed.
import fs from 'node:fs';
import os from 'node:os';

let lastCpu: { idle: number; total: number } | null = null;

function cpuSample(): { idle: number; total: number } | null {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = n[3] + (n[4] || 0);
    return { idle, total: n.reduce((a, b) => a + b, 0) };
  } catch {
    return null;
  }
}

export function cpuPct(): number | null {
  const s = cpuSample();
  if (!s) return null;
  const prev = lastCpu;
  lastCpu = s;
  if (!prev || s.total === prev.total) return Math.round((os.loadavg()[0] / os.cpus().length) * 100);
  return Math.round(100 * (1 - (s.idle - prev.idle) / (s.total - prev.total)));
}

function meminfo(): Record<string, number> {
  try {
    return Object.fromEntries(
      fs
        .readFileSync('/proc/meminfo', 'utf8')
        .split('\n')
        .map((l) => l.match(/^(\w+):\s+(\d+)/))
        .filter(Boolean)
        .map((m) => [m![1], Number(m![2]) * 1024]),
    );
  } catch {
    return {};
  }
}

function tempC(): number | null {
  for (const f of ['/sys/class/thermal/thermal_zone0/temp', '/sys/devices/virtual/thermal/thermal_zone0/temp']) {
    try {
      return Math.round(Number(fs.readFileSync(f, 'utf8').trim()) / 100) / 10;
    } catch {
      /* next */
    }
  }
  return null;
}

export interface Health {
  host: string;
  arch: string;
  node: string;
  uptime_s: number;
  cpu_pct: number | null;
  load1: number;
  cores: number;
  mem: { total: number; used: number; pct: number };
  swap: { total: number; used: number; pct: number } | null;
  temp_c: number | null;
  disk: { total: number; used: number; pct: number } | null;
  process_rss: number;
  warnings: string[];
}

export function health(dir = '/'): Health {
  const m = meminfo();
  const total = m.MemTotal || os.totalmem();
  const avail = m.MemAvailable ?? os.freemem();
  const used = total - avail;
  const swapTotal = m.SwapTotal ?? 0;
  const swapUsed = swapTotal - (m.SwapFree ?? 0);
  let disk: Health['disk'] = null;
  try {
    const s = fs.statfsSync(dir);
    const t = s.blocks * s.bsize;
    const u = t - s.bavail * s.bsize;
    disk = { total: t, used: u, pct: Math.round((u / t) * 100) };
  } catch {
    /* unknown */
  }
  const h: Health = {
    host: os.hostname(),
    arch: process.arch,
    node: process.version,
    uptime_s: Math.round(os.uptime()),
    cpu_pct: cpuPct(),
    load1: Math.round(os.loadavg()[0] * 100) / 100,
    cores: os.cpus().length,
    mem: { total, used, pct: Math.round((used / total) * 100) },
    swap: swapTotal ? { total: swapTotal, used: swapUsed, pct: Math.round((swapUsed / swapTotal) * 100) } : null,
    temp_c: tempC(),
    disk,
    process_rss: process.memoryUsage().rss,
    warnings: [],
  };
  if (h.mem.pct >= 90) h.warnings.push(`memory ${h.mem.pct}%`);
  if (h.swap && h.swap.pct >= 50) h.warnings.push(`swap ${h.swap.pct}%`);
  if (h.temp_c !== null && h.temp_c >= 75) h.warnings.push(`temperature ${h.temp_c}°C`);
  if (h.disk && h.disk.pct >= 90) h.warnings.push(`disk ${h.disk.pct}%`);
  if (h.process_rss > 800 * 1024 * 1024) h.warnings.push(`Ren 2 RSS ${Math.round(h.process_rss / 1048576)} MB (limit 1 GB)`);
  return h;
}

export const mb = (b: number) => `${Math.round(b / 1048576)} MB`;
export function healthText(h: Health): string {
  return [
    `${h.host} (${h.arch}, Node ${h.node}) up ${Math.round(h.uptime_s / 3600)}h`,
    `CPU ${h.cpu_pct ?? '?'}% · load ${h.load1}/${h.cores} · RAM ${h.mem.pct}% (${mb(h.mem.used)}/${mb(h.mem.total)})`,
    `swap ${h.swap ? h.swap.pct + '%' : 'none'} · temp ${h.temp_c ?? 'n/a'}${h.temp_c !== null ? '°C' : ''} · disk ${h.disk ? h.disk.pct + '%' : '?'} · Ren 2 RSS ${mb(h.process_rss)}`,
    h.warnings.length ? `⚠ ${h.warnings.join(', ')}` : 'no warnings',
  ].join('\n');
}
