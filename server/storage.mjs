import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export function openStorage(directory) {
  const storage = resolve(directory);
  const sqlite = new DatabaseSync(join(storage, 'site.sqlite'));
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
  const known = sqlite.prepare('SELECT 1 FROM migrations WHERE name = ?');
  const remember = sqlite.prepare('INSERT INTO migrations (name) VALUES (?)');
  const schema = new URL('../drizzle/', import.meta.url);
  function transaction(operation) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  for (const name of readdirSync(schema).filter(name => name.endsWith('.sql')).sort()) {
    transaction(() => {
      if (known.get(name)) return;
      sqlite.exec(readFileSync(new URL(name, schema), 'utf8'));
      remember.run(name);
    });
  }
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const numbered = [...new Set(sql.match(/\?\d+/g))];
      const bind = (...values) => {
        const args = numbered.length ? [Object.fromEntries(numbered.map(name => [name, values[Number(name.slice(1)) - 1]]))] : values;
        const first = () => statement.get(...args);
        const all = () => ({ results: statement.all(...args) });
        const run = () => ({ meta: statement.run(...args) });
        return { first, all, run, execute: () => statement.columns().length ? all() : run() };
      };
      return {
        bind, first: () => bind().first(), all: () => bind().all(), run: () => bind().run(),
        execute: () => bind().execute()
      };
    },
    async batch(statements) { return transaction(() => statements.map(statement => statement.execute())); }
  };
  const attachments = join(storage, 'attachments');
  function attachmentPath(key) {
    if (!/^reports\/[0-9a-f-]{36}\/[0-2]$/.test(key)) throw new Error('Invalid report file key');
    return join(attachments, key.split('/').slice(1).join('-'));
  }
  const bucket = {
    async put(key, data) {
      await mkdir(attachments, { mode: 0o700, recursive: true });
      await writeFile(attachmentPath(key), new Uint8Array(data), { mode: 0o600 });
    },
    async get(key, options) {
      let file;
      try {
        file = await open(attachmentPath(key));
        const range = options?.range;
        if (!range) return { body: await file.readFile() };
        const body = Buffer.alloc(range.length);
        const { bytesRead } = await file.read(body, 0, body.length, range.offset);
        return bytesRead === body.length ? { body } : null;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      } finally {
        await file?.close();
      }
    },
    async delete(keys) {
      await Promise.all(keys.map(key => rm(attachmentPath(key), { force: true })));
    }
  };
  return { db, bucket, close: () => sqlite.close() };
}
