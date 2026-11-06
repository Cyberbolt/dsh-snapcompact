import { parentPort } from 'node:worker_threads';
import { loadFont } from './font.js';
import type { RenderRequest, RenderResponse } from './protocol.js';
import { renderArchive } from './renderer.js';
import { RenderError } from './types.js';

const port = parentPort;
if (port === null) throw new Error('Renderer must run in a worker thread.');

let busy = false;
port.on('message', (request: RenderRequest) => {
  if (busy) {
    const response: RenderResponse = {
      id: request.id,
      ok: false,
      code: 'WORKER_FAILED',
      message: 'Worker received concurrent render requests.',
    };
    port.postMessage(response);
    return;
  }
  busy = true;
  void (async (): Promise<void> => {
    try {
      const font = await loadFont();
      const archive = renderArchive(request.text, request.options, font, request.deadline);
      const response: RenderResponse = { id: request.id, ok: true, archive };
      port.postMessage(
        response,
        archive.frames.map((frame) => frame.data.buffer as ArrayBuffer),
      );
    } catch (error) {
      const response: RenderResponse = {
        id: request.id,
        ok: false,
        code: error instanceof RenderError ? error.code : 'WORKER_FAILED',
        message: error instanceof Error ? error.message : 'Unknown worker render failure.',
      };
      port.postMessage(response);
    } finally {
      busy = false;
    }
  })();
});
