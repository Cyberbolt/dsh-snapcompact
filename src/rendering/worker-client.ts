import { Worker } from 'node:worker_threads';
import { MAX_PENDING_REQUESTS, validateOptions, validateSource } from './options.js';
import type { RenderRequest, RenderResponse } from './protocol.js';
import { RenderError } from './types.js';
import type { RenderedArchive, RenderOptions } from './types.js';

export type { RenderedArchive, RenderedFrame, RenderOptions } from './types.js';
export { RenderError } from './types.js';

interface Job {
  readonly id: number;
  readonly text: string;
  readonly options: RenderOptions;
  readonly deadline: number;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly resolve: (archive: RenderedArchive) => void;
  readonly reject: (error: Error) => void;
  settled: boolean;
}

/** Own one instance per plugin/preset; no task state is shared between instances. */
export class Renderer {
  private nextId = 0;
  private worker: Worker | undefined;
  private active: Job | undefined;
  private readonly pending: Job[] = [];
  private retiring: Promise<void> | undefined;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  private finish(job: Job, result: RenderedArchive | RenderError): void {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.onAbort);
    if (result instanceof RenderError) job.reject(result);
    else job.resolve(result);
  }

  /** Do not start the next worker until termination of the old one completes. */
  private retireWorker(): Promise<void> {
    if (this.retiring !== undefined) return this.retiring;
    const previous = this.worker;
    this.worker = undefined;
    if (previous === undefined) return Promise.resolve();
    this.retiring = previous
      .terminate()
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        this.retiring = undefined;
        this.pump();
      });
    return this.retiring;
  }

  private cancel(job: Job, code: 'ABORTED' | 'TIMEOUT'): void {
    if (job.settled) return;
    const error = new RenderError(
      code,
      code === 'ABORTED'
        ? 'Rendering was aborted.'
        : 'Rendering deadline exceeded (including queue wait).',
    );
    if (this.active === job) {
      this.active = undefined;
      this.finish(job, error);
      void this.retireWorker();
    } else {
      const index = this.pending.indexOf(job);
      if (index !== -1) this.pending.splice(index, 1);
      this.finish(job, error);
      this.pump();
    }
  }

  private failWorker(instance: Worker, message: string): void {
    if (this.worker !== instance) return;
    const job = this.active;
    this.active = undefined;
    if (job !== undefined) this.finish(job, new RenderError('WORKER_FAILED', message));
    void this.retireWorker();
  }

  private createWorker(): Worker {
    const instance = new Worker(new URL('./worker.js', import.meta.url), {
      name: 'snapcompact-renderer',
      // Do not inherit test runners, TypeScript loaders, or --input-type flags.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
    });
    instance.on('message', (response: RenderResponse) => {
      const job = this.active;
      if (this.worker !== instance || job === undefined || job.id !== response.id) return;
      this.active = undefined;
      if (Date.now() >= job.deadline) {
        this.finish(job, new RenderError('TIMEOUT', 'Rendering deadline exceeded.'));
      } else if (response.ok) {
        this.finish(job, response.archive);
      } else {
        this.finish(job, new RenderError(response.code, response.message));
      }
      instance.unref();
      this.pump();
    });
    instance.on('error', (error) => this.failWorker(instance, error.message));
    instance.on('messageerror', () =>
      this.failWorker(instance, 'Cannot deserialize renderer response.'),
    );
    instance.on('exit', (code) => {
      if (this.worker === instance)
        this.failWorker(instance, `Renderer worker exited unexpectedly (${code}).`);
    });
    return instance;
  }

  private pump(): void {
    if (this.disposed || this.retiring !== undefined || this.active !== undefined) return;
    const job = this.pending.shift();
    if (job === undefined) return;
    if (job.signal?.aborted) {
      this.finish(job, new RenderError('ABORTED', 'Rendering was aborted.'));
      this.pump();
      return;
    }
    if (Date.now() >= job.deadline) {
      this.finish(job, new RenderError('TIMEOUT', 'Rendering expired in the queue.'));
      this.pump();
      return;
    }
    this.active = job;
    try {
      this.worker ??= this.createWorker();
      this.worker.ref();
      const request: RenderRequest = {
        id: job.id,
        text: job.text,
        options: job.options,
        deadline: job.deadline,
      };
      this.worker.postMessage(request);
    } catch (error) {
      this.active = undefined;
      this.finish(
        job,
        new RenderError(
          'WORKER_FAILED',
          error instanceof Error ? error.message : 'Cannot start renderer.',
        ),
      );
      if (this.worker === undefined) this.pump();
      else void this.retireWorker();
    }
  }

  /** One worker, at most four queued jobs. Deadline includes queueing/startup. */
  render(
    text: string,
    suppliedOptions: RenderOptions,
    signal?: AbortSignal,
  ): Promise<RenderedArchive> {
    try {
      if (this.disposed) throw new RenderError('DISPOSED', 'Renderer was permanently disposed.');
      if (signal?.aborted) throw new RenderError('ABORTED', 'Rendering was aborted.');
      const options = validateOptions(suppliedOptions);
      validateSource(text, options);
      if (this.pending.length >= MAX_PENDING_REQUESTS) {
        throw new RenderError('QUEUE_FULL', 'Renderer queue is full (one active, four waiting).');
      }
      return new Promise<RenderedArchive>((resolve, reject) => {
        const deadline = Date.now() + options.timeoutMs;
        const onAbort = (): void => this.cancel(job, 'ABORTED');
        const timer = setTimeout(() => this.cancel(job, 'TIMEOUT'), options.timeoutMs);
        const job: Job = {
          id: ++this.nextId,
          text,
          options,
          deadline,
          signal,
          onAbort,
          timer,
          resolve,
          reject,
          settled: false,
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.pending.push(job);
        this.pump();
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Permanently close this lifecycle, reject outstanding jobs and await worker
   * termination. Create a new Renderer for another plugin/preset lifecycle.
   */
  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise;
    this.disposed = true;
    const error = new RenderError('DISPOSED', 'Renderer was disposed.');
    for (const job of this.pending.splice(0)) this.finish(job, error);
    if (this.active !== undefined) {
      this.finish(this.active, error);
      this.active = undefined;
    }
    this.disposePromise = this.retireWorker();
    return this.disposePromise;
  }
}

export function createRenderer(): Renderer {
  return new Renderer();
}
