import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadToFile } from '../lib/download.js';

/** Every JAR is a ZIP archive and therefore starts with these bytes. */
const JAR_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export class JarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JarValidationError';
  }
}

/** True when the file starts with the ZIP/JAR magic bytes `PK\x03\x04`. */
export async function hasJarMagic(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(JAR_MAGIC.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(JAR_MAGIC);
  } finally {
    await handle.close();
  }
}

export function hasJarMagicBytes(bytes: Uint8Array): boolean {
  return bytes.length >= JAR_MAGIC.length && Buffer.from(bytes.subarray(0, 4)).equals(JAR_MAGIC);
}

/** Streams a file through SHA-256 without loading it into memory. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Derives a safe on-disk filename from a download URL. Path separators and
 * other risky characters are stripped, and a `.jar` suffix is enforced.
 */
export function safeFilenameFromUrl(rawUrl: string, fallback = 'artifact.jar'): string {
  let candidate: string;
  try {
    const pathname = new URL(rawUrl).pathname;
    candidate = decodeURIComponent(pathname.split('/').pop() ?? '');
  } catch {
    candidate = '';
  }

  candidate = path.basename(candidate).replace(/[^A-Za-z0-9._+-]/g, '_');
  if (!candidate || candidate === '.' || candidate === '..') candidate = fallback;
  if (!candidate.toLowerCase().endsWith('.jar')) candidate = `${candidate}.jar`;
  return candidate.slice(0, 128);
}

export interface ValidatedJar {
  sha256: string;
  sizeBytes: number;
}

/** Validates magic bytes and returns the artifact digest for the registry. */
export async function validateJarFile(filePath: string): Promise<ValidatedJar> {
  if (!(await hasJarMagic(filePath))) {
    throw new JarValidationError('File is not a valid JAR archive (missing PK\\x03\\x04 header)');
  }
  const sha256 = await sha256File(filePath);
  const { size } = await stat(filePath);
  return { sha256, sizeBytes: size };
}

export interface DownloadJarOptions {
  url: string;
  destinationDir: string;
  filename?: string;
  fetchImpl?: typeof fetch;
}

export interface InstalledJar {
  path: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Downloads a JAR from a direct URL, rejects non-JAR payloads and moves the
 * verified file into the destination under a safe filename.
 */
export async function downloadJarFromUrl(options: DownloadJarOptions): Promise<InstalledJar> {
  const filename = options.filename ?? safeFilenameFromUrl(options.url);
  await mkdir(options.destinationDir, { recursive: true });

  const tempPath = path.join(options.destinationDir, `.download-${randomUUID()}`);
  try {
    await downloadToFile({
      url: options.url,
      destination: tempPath,
      algorithm: 'sha256',
      fetchImpl: options.fetchImpl,
    });

    const { sha256, sizeBytes } = await validateJarFile(tempPath);
    const finalPath = path.join(options.destinationDir, filename);
    await rm(finalPath, { force: true });
    await rename(tempPath, finalPath);
    return { path: finalPath, filename, sha256, sizeBytes };
  } finally {
    await rm(tempPath, { force: true });
  }
}

export interface SaveJarBufferOptions {
  data: Uint8Array;
  filename: string;
  destinationDir: string;
}

/** Validates and stores an uploaded JAR buffer. */
export async function saveJarBuffer(options: SaveJarBufferOptions): Promise<InstalledJar> {
  if (!hasJarMagicBytes(options.data)) {
    throw new JarValidationError('Uploaded file is not a valid JAR archive');
  }

  const filename = path
    .basename(options.filename)
    .replace(/[^A-Za-z0-9._+-]/g, '_')
    .slice(0, 128);
  if (!filename.toLowerCase().endsWith('.jar')) {
    throw new JarValidationError('Uploaded file must have a .jar extension');
  }

  await mkdir(options.destinationDir, { recursive: true });
  const tempPath = path.join(options.destinationDir, `.upload-${randomUUID()}`);
  try {
    await writeFile(tempPath, options.data);
    const { sha256, sizeBytes } = await validateJarFile(tempPath);
    const finalPath = path.join(options.destinationDir, filename);
    await rm(finalPath, { force: true });
    await rename(tempPath, finalPath);
    return { path: finalPath, filename, sha256, sizeBytes };
  } finally {
    await rm(tempPath, { force: true });
  }
}
