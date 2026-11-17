import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  entrypointExists,
  eulaPath,
  initializeWorkspace,
  isEulaAccepted,
  isEulaAcceptedContent,
  writeEulaAccepted,
} from './workspace.js';

describe('server workspace', () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'locternos-workspace-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes default server.properties with the assigned port', async () => {
    const workspace = path.join(dir, 'alpha');
    await initializeWorkspace(workspace, { port: 25577, motd: 'Hello' });
    const properties = await readFile(path.join(workspace, 'server.properties'), 'utf8');
    assert.match(properties, /server-port=25577/);
    assert.match(properties, /motd=Hello/);
    assert.match(properties, /max-players=20/);
  });

  it('does not overwrite existing properties or create eula.txt', async () => {
    const workspace = path.join(dir, 'beta');
    await initializeWorkspace(workspace, { port: 25565, motd: 'First' });
    await writeFile(path.join(workspace, 'server.properties'), 'server-port=30000\n', 'utf8');

    await initializeWorkspace(workspace, { port: 25565, motd: 'Second' });
    assert.equal(
      await readFile(path.join(workspace, 'server.properties'), 'utf8'),
      'server-port=30000\n',
    );
    assert.equal(await isEulaAccepted(workspace), false);
  });

  it('accepts only an explicit eula=true line', async () => {
    assert.equal(isEulaAcceptedContent('eula=true'), true);
    assert.equal(isEulaAcceptedContent('eula = TRUE\n'), true);
    assert.equal(isEulaAcceptedContent('eula=false'), false);
    assert.equal(isEulaAcceptedContent('# eula=true'), false);
    assert.equal(isEulaAcceptedContent('motd=eula=true'), false);
  });

  it('writes eula.txt only when asked', async () => {
    const workspace = path.join(dir, 'gamma');
    await writeEulaAccepted(workspace);
    assert.equal(await isEulaAccepted(workspace), true);
    assert.match(await readFile(eulaPath(workspace), 'utf8'), /eula=true/);
  });

  it('reports whether the entrypoint jar exists', async () => {
    const workspace = path.join(dir, 'delta');
    await initializeWorkspace(workspace, { port: 25565, motd: 'Delta' });
    assert.equal(await entrypointExists(workspace, 'server.jar'), false);
    await writeFile(path.join(workspace, 'server.jar'), '');
    assert.equal(await entrypointExists(workspace, 'server.jar'), true);
  });
});
