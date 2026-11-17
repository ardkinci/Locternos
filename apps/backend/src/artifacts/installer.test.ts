import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadJarFromUrl,
  hasJarMagic,
  hasJarMagicBytes,
  JarValidationError,
  safeFilenameFromUrl,
  saveJarBuffer,
  sha256File,
  validateJarFile,
} from './installer.js';

const MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const JAR = Buffer.concat([MAGIC, Buffer.from('jar-body')]);
const JAR_SHA = createHash('sha256').update(JAR).digest('hex');

function jarFetch(bytes: Buffer = JAR): typeof fetch {
  return (async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch;
}

describe('jar installer helpers', () => {
  const tempDirs: string[] = [];

  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'locternos-jar-'));
    tempDirs.push(dir);
    return dir;
  }

  it('detects the ZIP/JAR magic header', async () => {
    assert.equal(hasJarMagicBytes(JAR), true);
    assert.equal(hasJarMagicBytes(Buffer.from('PK')), false);

    const dir = await tempDir();
    const file = path.join(dir, 'valid.jar');
    await writeFile(file, JAR);
    assert.equal(await hasJarMagic(file), true);

    const broken = path.join(dir, 'broken.jar');
    await writeFile(broken, 'not-a-jar');
    assert.equal(await hasJarMagic(broken), false);
    await assert.rejects(validateJarFile(broken), JarValidationError);
  });

  it('hashes and validates a jar file', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'valid.jar');
    await writeFile(file, JAR);

    assert.equal(await sha256File(file), JAR_SHA);
    assert.deepEqual(await validateJarFile(file), { sha256: JAR_SHA, sizeBytes: JAR.length });
  });

  it('derives safe filenames from URLs', () => {
    assert.equal(safeFilenameFromUrl('https://cdn.example.com/plugins/Foo.jar?x=1'), 'Foo.jar');
    assert.equal(safeFilenameFromUrl('https://example.com/download'), 'download.jar');
    assert.equal(
      safeFilenameFromUrl('https://example.com/..%2F..%2Fetc%2Fpasswd.jar'),
      'passwd.jar',
    );
    assert.equal(safeFilenameFromUrl('not a url', 'plugin'), 'plugin.jar');
  });

  it('downloads, validates and stores a direct URL jar', async () => {
    const dir = await tempDir();
    const result = await downloadJarFromUrl({
      url: 'https://cdn.example.com/Foo.jar',
      destinationDir: dir,
      fetchImpl: jarFetch(),
    });

    assert.equal(result.filename, 'Foo.jar');
    assert.equal(result.sha256, JAR_SHA);
    assert.deepEqual(await readFile(result.path), JAR);
    assert.deepEqual(await readdir(dir), ['Foo.jar']);
  });

  it('rejects downloads that are not jars and leaves no files behind', async () => {
    const dir = await tempDir();
    await assert.rejects(
      downloadJarFromUrl({
        url: 'https://cdn.example.com/Foo.jar',
        destinationDir: dir,
        fetchImpl: jarFetch(Buffer.from('plain text')),
      }),
      JarValidationError,
    );
    assert.deepEqual(await readdir(dir), []);
  });

  it('validates and stores uploaded jar buffers', async () => {
    const dir = await tempDir();
    const result = await saveJarBuffer({
      data: JAR,
      filename: '../Unsafe Name.jar',
      destinationDir: dir,
    });

    assert.equal(result.filename, 'Unsafe_Name.jar');
    assert.equal(result.sha256, JAR_SHA);
    assert.deepEqual(await readdir(dir), ['Unsafe_Name.jar']);
  });

  it('rejects uploads without the jar magic or extension', async () => {
    const dir = await tempDir();
    await assert.rejects(
      saveJarBuffer({ data: Buffer.from('nope'), filename: 'x.jar', destinationDir: dir }),
      JarValidationError,
    );
    await assert.rejects(
      saveJarBuffer({ data: JAR, filename: 'x.txt', destinationDir: dir }),
      JarValidationError,
    );
  });
});
