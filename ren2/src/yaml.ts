import fs from 'node:fs';
import YAML from 'yaml';

export function readYaml<T = any>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  const v = YAML.parse(fs.readFileSync(file, 'utf8'));
  return (v ?? fallback) as T;
}

/** Set one top-level key while preserving the file's comments and layout. */
export function setYamlKey(file: string, key: string, value: unknown): void {
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  doc.set(key, value);
  fs.writeFileSync(file, doc.toString());
}

export { YAML };
