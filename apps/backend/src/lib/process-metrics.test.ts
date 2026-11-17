import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { directorySizeBytes } from './disk-usage.js';
import { readProcessMetrics } from './process-metrics.js';

describe('directorySizeBytes', () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'locternos-du-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sums nested files and tolerates a missing directory', async () => {
    await mkdir(path.join(dir, 'world', 'region'), { recursive: true });
    await writeFile(path.join(dir, 'server.jar'), Buffer.alloc(10));
    await writeFile(path.join(dir, 'world', 'level.dat'), Buffer.alloc(20));
    await writeFile(path.join(dir, 'world', 'region', 'r.0.0.mca'), Buffer.alloc(70));

    assert.equal(await directorySizeBytes(dir), 100);
    assert.equal(await directorySizeBytes(path.join(dir, 'missing')), 0);
  });
});

describe('readProcessMetrics', () => {
  it('reads its own RSS and computes CPU from two samples', async () => {
    if (process.platform !== 'linux') return;

    const first = await readProcessMetrics(process.pid, null, Date.now());
    assert.ok(first.sample.ramMb !== null && first.sample.ramMb > 0);
    assert.equal(first.sample.cpuPercent, null);
    assert.ok(first.state);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await readProcessMetrics(process.pid, first.state, Date.now());
    assert.ok(second.sample.cpuPercent !== null && second.sample.cpuPercent >= 0);
  });

  it('returns nulls for a missing process', async () => {
    if (process.platform !== 'linux') return;
    const result = await readProcessMetrics(999_999_999);
    assert.deepEqual(result, { sample: { ramMb: null, cpuPercent: null }, state: null });
  });
});
