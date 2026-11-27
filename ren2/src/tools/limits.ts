// Resource-aware concurrency: default 1 heavy + 3 light. When the machine is loaded
// (1-min loadavg above core count — common on a Pi), light slots drop to 1.
import os from 'node:os';

export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(public max: () => number) {}
  async acquire(signal?: AbortSignal): Promise<() => void> {
    while (this.active >= this.max()) {
      if (signal?.aborted) throw new Error('aborted');
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 500); // re-check max() periodically (load changes)
      });
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiters.shift()?.();
    };
  }
  get inUse() {
    return this.active;
  }
}

const envNum = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
const loaded = () => os.loadavg()[0] > os.cpus().length;

export const heavy = new Semaphore(() => envNum('REN2_HEAVY_SLOTS', 1));
export const light = new Semaphore(() => (loaded() ? 1 : envNum('REN2_LIGHT_SLOTS', 3)));
