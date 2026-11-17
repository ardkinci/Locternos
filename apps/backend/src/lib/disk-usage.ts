import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';

/**
 * Recursively sums regular file sizes under `root`. Symlinks are skipped so a
 * server directory cannot pull the panel outside its own tree. Missing
 * directories simply report zero bytes.
 */
export async function directorySizeBytes(root: string): Promise<number> {
  let total = 0;
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += (await stat(full)).size;
      } catch {
        // A file can disappear while walking; ignore it.
      }
    }
  }

  return total;
}
