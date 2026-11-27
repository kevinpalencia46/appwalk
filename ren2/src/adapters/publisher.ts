// Social publishing: one `publisher` interface, one adapter per platform. Start is
// drafts-only (always works, posts nowhere). Real platforms show needs_credentials until
// Kevin picks one and provides access; their publish() is not written yet (VERIFY the
// platform API when chosen). Everything goes through the Publish gate unless the agent
// has "post:<platform>" on its auto list.
import { DB } from '../db.js';
import { nowIso } from '../env.js';
import { emit } from '../log.js';

export interface Publisher {
  platform: string;
  label: string;
  status(): { status: 'ok' | 'needs_credentials'; detail: string };
  publish(draft: DraftRow): Promise<{ text: string; externalId?: string; posted: boolean }>;
}

export interface DraftRow {
  id: number;
  platform: string;
  agent_id: string | null;
  task_id: number | null;
  project: string | null;
  text: string;
  status: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

const draftsOnly: Publisher = {
  platform: 'drafts',
  label: 'Drafts only',
  status: () => ({ status: 'ok', detail: 'keeps approved posts on the dashboard to copy by hand; posts nowhere' }),
  async publish(d) {
    return { text: `Approved draft #${d.id}. Drafts-only: nothing was posted — copy it from the dashboard (Memory → Drafts) or connect a platform.`, posted: false };
  },
};

function credentialed(platform: string, label: string, envKeys: string[]): Publisher {
  return {
    platform,
    label,
    status: () => {
      const missing = envKeys.filter((k) => !process.env[k]);
      return missing.length ? { status: 'needs_credentials', detail: `set ${missing.join(', ')}` } : { status: 'ok', detail: 'credentials set (publish call not wired yet — VERIFY platform API)' };
    },
    async publish() {
      throw new Error(`${label} publishing isn't wired yet: needs credentials and the platform's real API (VERIFY). Draft kept.`);
    },
  };
}

export function publishers(): Record<string, Publisher> {
  const list = [
    draftsOnly,
    credentialed('x', 'X / Twitter', ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']),
    credentialed('instagram', 'Instagram', ['META_ACCESS_TOKEN', 'INSTAGRAM_ACCOUNT_ID']),
    credentialed('facebook', 'Facebook Page', ['META_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID']),
    credentialed('linkedin', 'LinkedIn', ['LINKEDIN_ACCESS_TOKEN']),
    credentialed('tiktok', 'TikTok', ['TIKTOK_ACCESS_TOKEN']),
  ];
  return Object.fromEntries(list.map((p) => [p.platform, p]));
}

export class Drafts {
  constructor(private db: DB) {}
  add(i: { platform: string; agentId: string | null; taskId: number | null; project: string | null; text: string }): DraftRow {
    const t = nowIso();
    const r = this.db.prepare('INSERT INTO drafts (platform, agent_id, task_id, project, text, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(i.platform, i.agentId, i.taskId, i.project, i.text, 'draft', t, t);
    const d = this.get(Number(r.lastInsertRowid))!;
    emit('draft', d);
    return d;
  }
  get(id: number): DraftRow | undefined {
    return this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as DraftRow | undefined;
  }
  byTask(taskId: number): DraftRow | undefined {
    return this.db.prepare('SELECT * FROM drafts WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(taskId) as DraftRow | undefined;
  }
  set(id: number, patch: { status?: string; text?: string; external_id?: string }): void {
    const d = this.get(id);
    if (!d) return;
    this.db.prepare('UPDATE drafts SET status = ?, text = ?, external_id = ?, updated_at = ? WHERE id = ?').run(patch.status ?? d.status, patch.text ?? d.text, patch.external_id ?? d.external_id, nowIso(), id);
    emit('draft', this.get(id));
  }
  list(limit = 50): DraftRow[] {
    return this.db.prepare('SELECT * FROM drafts ORDER BY id DESC LIMIT ?').all(limit) as unknown as DraftRow[];
  }
}
