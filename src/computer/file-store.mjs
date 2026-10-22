import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
/**
 * Local per-objective checkpoint storage. Use a single writer per objective.
 * A supervisor must own leases before multi-process/cloud execution.
 * No browser cookies, passwords, screenshots or typed values are persisted.
 */
export function createFileComputerStore(directory) {
  if (typeof directory !== 'string' || !directory.trim())
    throw TypeError('A checkpoint directory is required');
  const root = resolve(directory);
  const locate = id => {
    if (!ID.test(id || '')) throw Error('Invalid objective identifier');
    const path = join(root, id + '.json');
    if (!path.startsWith(root + sep)) throw Error('Checkpoint escaped its root');
    return path;
  };
  return {
    async read(id) {
      const path = locate(id);
      try {
        const result = JSON.parse(await readFile(path, 'utf8'));
        if (result?.id !== id) throw Error('Checkpoint identity mismatch');
        return result;
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(id, state) {
      const target = locate(id);
      if (state?.id !== id) throw Error('Checkpoint identity mismatch');
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const canonical = await realpath(dirname(target));
      if (canonical !== await realpath(root))
        throw Error('Checkpoint directory changed');
      const temporary = target + '.' + randomUUID() + '.pending';
      await writeFile(temporary, JSON.stringify(state, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
      try { await rename(temporary, target); }
      catch (error) {
        // A pending file is intentionally retained as an uncertainty signal.
        // Caller must not dispatch an action if checkpointing failed.
        throw error;
      }
    },
  };
}
