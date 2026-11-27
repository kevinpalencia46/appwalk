// Memory: one source of truth. SQLite `knowledge` table + FTS5 index. Markdown notes in
// knowledge/ are the human-editable copy; they're indexed into the DB on change (mtime
// poll). Kinds: fact, decision, preference, playbook, lesson.
import fs from 'node:fs';
import path from 'node:path';
import { DB } from '../db.js';
import { nowIso } from '../env.js';
import { emit } from '../log.js';

export const KINDS = ['fact', 'decision', 'preference', 'playbook', 'lesson'] as const;
export type Kind = (typeof KINDS)[number];

export interface Item {
  id: number;
  project: string;
  kind: string;
  title: string;
  body: string;
  source: string;
  path: string | null;
  created_at: string;
  updated_at: string;
  score?: number;
}

const STOP = new Set('a an and are as at be by for from has have in is it of on or that the this to was were what with about whats summarize summary me my tell show'.split(' '));

/** Turn free text into a safe FTS5 query: quoted terms OR'd together. */
export function ftsQuery(q: string): string {
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || []).filter((t) => t.length > 1 && !STOP.has(t));
  return [...new Set(terms)].slice(0, 12).map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
}

export function parseNote(text: string, rel: string): { project: string; kind: string; title: string; body: string } {
  let body = text;
  const meta: Record<string, string> = {};
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const l of fm[1].split('\n')) {
      const m = l.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = text.slice(fm[0].length);
  }
  const h = body.match(/^#\s+(.+)$/m);
  const parts = rel.split(/[\\/]/);
  return {
    project: meta.project || (parts.length > 1 ? parts[0] : 'general'),
    kind: KINDS.includes(meta.kind as Kind) ? meta.kind : 'fact',
    title: meta.title || h?.[1]?.trim() || path.basename(rel, path.extname(rel)),
    body: body.trim(),
  };
}

export class Memory {
  constructor(private db: DB, public dir: string) {}

  add(i: { project?: string; kind?: string; title: string; body: string; source?: string; path?: string | null }): number {
    const t = nowIso();
    const r = this.db
      .prepare('INSERT INTO knowledge (project, kind, title, body, source, path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(i.project || 'general', i.kind || 'fact', i.title.slice(0, 300), i.body, i.source || 'ren2', i.path ?? null, t, t);
    emit('memory', { id: Number(r.lastInsertRowid) });
    return Number(r.lastInsertRowid);
  }

  get(id: number): Item | undefined {
    return this.db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as Item | undefined;
  }

  /** Update an item. If it's backed by a markdown note, the file is rewritten too. */
  update(id: number, patch: { title?: string; body?: string; project?: string; kind?: string }): Item {
    const cur = this.get(id);
    if (!cur) throw new Error(`no memory item ${id}`);
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Item;
    if (cur.path) {
      const file = path.join(this.dir, cur.path);
      const fm = `---\nproject: ${next.project}\nkind: ${next.kind}\n---\n`;
      const text = next.body.startsWith('# ') ? next.body : `# ${next.title}\n\n${next.body}`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, fm + text + '\n');
      next.body = text;
    }
    this.db
      .prepare('UPDATE knowledge SET title=?, body=?, project=?, kind=?, updated_at=?, mtime=? WHERE id=?')
      .run(next.title, next.body, next.project, next.kind, nowIso(), cur.path ? fs.statSync(path.join(this.dir, cur.path)).mtimeMs : null, id);
    emit('memory', { id });
    return this.get(id)!;
  }

  /** Create a new editable note (file + index row). */
  createNote(i: { project: string; kind: string; title: string; body: string }): Item {
    const slug = i.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
    let rel = path.join(i.project, `${slug}.md`);
    for (let n = 2; fs.existsSync(path.join(this.dir, rel)); n++) rel = path.join(i.project, `${slug}-${n}.md`);
    const file = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nproject: ${i.project}\nkind: ${i.kind}\n---\n# ${i.title}\n\n${i.body}\n`);
    this.indexNotes();
    return this.db.prepare('SELECT * FROM knowledge WHERE path = ?').get(rel) as unknown as Item;
  }

  search(q: string, o: { project?: string; kind?: string; limit?: number } = {}): Item[] {
    const limit = o.limit ?? 20;
    const fq = ftsQuery(q);
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (o.project) (where.push('k.project = ?'), args.push(o.project));
    if (o.kind) (where.push('k.kind = ?'), args.push(o.kind));
    if (!fq) {
      return this.db
        .prepare(`SELECT k.* FROM knowledge k ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY k.updated_at DESC LIMIT ?`)
        .all(...args, limit) as unknown as Item[];
    }
    return this.db
      .prepare(
        `SELECT k.*, bm25(knowledge_fts, 4.0, 1.0, 2.0, 0.5) AS score FROM knowledge_fts f JOIN knowledge k ON k.id = f.rowid
         WHERE knowledge_fts MATCH ? ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY score LIMIT ?`,
      )
      .all(fq, ...args, limit) as unknown as Item[];
  }

  list(o: { project?: string; kind?: string; limit?: number } = {}): Item[] {
    return this.search('', o);
  }

  counts() {
    return {
      byProject: this.db.prepare('SELECT project, COUNT(*) n FROM knowledge GROUP BY project ORDER BY n DESC').all(),
      byKind: this.db.prepare('SELECT kind, COUNT(*) n FROM knowledge GROUP BY kind ORDER BY n DESC').all(),
      total: (this.db.prepare('SELECT COUNT(*) n FROM knowledge').get() as { n: number }).n,
    };
  }

  /** Small context block for the planner: top items for the objective + project. */
  contextFor(objective: string, project?: string | null, limit = 6, maxChars = 2400): { text: string; ids: number[] } {
    let items = this.search(objective, { project: project || undefined, limit });
    if (items.length < limit && project) items = [...items, ...this.search(objective, { limit: limit - items.length })];
    const seen = new Set<number>();
    const out: string[] = [];
    let used = 0;
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const chunk = `[#${it.id} ${it.project}/${it.kind}] ${it.title}\n${it.body.slice(0, 600)}`;
      if (used + chunk.length > maxChars) break;
      out.push(chunk);
      used += chunk.length;
    }
    return { text: out.join('\n\n'), ids: [...seen] };
  }

  /** Index markdown notes in knowledge/ (new or changed by mtime). Returns counts. */
  indexNotes(): { added: number; updated: number; removed: number } {
    const res = { added: 0, updated: 0, removed: 0 };
    if (!fs.existsSync(this.dir)) return res;
    const seen = new Set<string>();
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(md|markdown|txt)$/i.test(e.name)) {
          const rel = path.relative(this.dir, p);
          seen.add(rel);
          const mtime = fs.statSync(p).mtimeMs;
          const row = this.db.prepare('SELECT id, mtime FROM knowledge WHERE path = ?').get(rel) as { id: number; mtime: number } | undefined;
          if (row && row.mtime === mtime) continue;
          const n = parseNote(fs.readFileSync(p, 'utf8'), rel);
          const src = rel.startsWith('imported') ? 'old-ren' : 'note';
          if (row) {
            this.db.prepare('UPDATE knowledge SET project=?, kind=?, title=?, body=?, mtime=?, updated_at=? WHERE id=?').run(n.project, n.kind, n.title, n.body, mtime, nowIso(), row.id);
            res.updated++;
          } else {
            const t = nowIso();
            this.db
              .prepare('INSERT INTO knowledge (project, kind, title, body, source, path, mtime, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
              .run(n.project, n.kind, n.title, n.body, src, rel, mtime, t, t);
            res.added++;
          }
        }
      }
    };
    walk(this.dir);
    for (const r of this.db.prepare('SELECT id, path FROM knowledge WHERE path IS NOT NULL').all() as { id: number; path: string }[]) {
      if (!seen.has(r.path)) {
        this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(r.id);
        res.removed++;
      }
    }
    if (res.added || res.updated || res.removed) emit('memory', res);
    return res;
  }
}
