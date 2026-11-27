// Skills: reusable, project-specific know-how as markdown files in skills/<id>.md.
// Front matter: name, projects, description. Agents list the skills they have; the text
// goes into their planning/work prompts. Kevin edits them like any note.
import fs from 'node:fs';
import path from 'node:path';

export interface Skill {
  id: string;
  name: string;
  description: string;
  projects: string[];
  body: string;
  file: string;
}

export function parseSkill(text: string, id: string, file: string): Skill {
  const meta: Record<string, string> = {};
  let body = text;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const l of fm[1].split('\n')) {
      const m = l.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = text.slice(fm[0].length);
  }
  const projects = (meta.projects || '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  return { id, name: meta.name || id, description: meta.description || '', projects, body: body.trim(), file };
}

export class Skills {
  private map = new Map<string, Skill>();
  constructor(public dir: string) {
    this.load();
  }
  load(): void {
    this.map.clear();
    if (!fs.existsSync(this.dir)) return;
    for (const f of fs.readdirSync(this.dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
      const file = path.join(this.dir, f);
      const id = f.replace(/\.md$/, '');
      this.map.set(id, parseSkill(fs.readFileSync(file, 'utf8'), id, file));
    }
  }
  get(id: string) {
    return this.map.get(id);
  }
  list() {
    return [...this.map.values()];
  }
  /** Prompt block for an agent's skills (bounded). */
  text(ids: string[], maxChars = 3000): string {
    let used = 0;
    const out: string[] = [];
    for (const id of ids) {
      const s = this.map.get(id);
      if (!s) continue;
      const chunk = `### Skill: ${s.name}\n${s.body}`;
      if (used + chunk.length > maxChars) break;
      out.push(chunk);
      used += chunk.length;
    }
    return out.join('\n\n');
  }
  save(id: string, body: string): Skill {
    const s = this.map.get(id);
    if (!s) throw new Error(`no skill ${id}`);
    const raw = fs.readFileSync(s.file, 'utf8');
    const fm = raw.match(/^---\n[\s\S]*?\n---\n?/)?.[0] ?? '';
    fs.writeFileSync(s.file, fm + body.trim() + '\n');
    this.load();
    return this.map.get(id)!;
  }
}
