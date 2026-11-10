import type { Context } from '@deepseek-ai/cordis';

/**
 * The host contract this plugin actually calls.
 *
 * `inject` only guarantees that a service exists; a compatible range still
 * admits host releases that rename or drop a method. This list is the probe for
 * that drift. Extend it whenever a new host call is added, or the new call
 * fails mid-compaction instead of at activation.
 */
interface Requirement {
  readonly service: string;
  readonly methods: readonly string[];
  readonly numbers?: readonly string[];
}

const REQUIREMENTS: readonly Requirement[] = [
  { service: 'llm', methods: ['stream', 'resolveModelInfo'] },
  { service: 'tokenMeter', methods: ['measure', 'estimateMessage'] },
  {
    service: 'attachments',
    methods: ['saveFile', 'readFileStream'],
    numbers: ['imageLimits.maxImagesPerMessage'],
  },
  { service: 'sessionProjections', methods: ['register'] },
  { service: 'tools', methods: ['register'] },
  { service: 'commands', methods: ['register'] },
];

function serviceOf(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(name: string): unknown }).get(name);
}

function memberOf(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function')) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Host service members that are missing in this build, in declaration order.
 *
 * A missing service is reported once by name; a missing method or numeric field
 * is reported by its dotted path so the activation diagnostic points at the
 * exact break instead of the whole service.
 */
export function missingHostCapabilities(ctx: Context): readonly string[] {
  const missing: string[] = [];
  for (const requirement of REQUIREMENTS) {
    const service = serviceOf(ctx, requirement.service);
    if (service === undefined || service === null) {
      missing.push(requirement.service);
      continue;
    }
    for (const method of requirement.methods) {
      if (typeof memberOf(service, method) !== 'function') {
        missing.push(`${requirement.service}.${method}`);
      }
    }
    for (const path of requirement.numbers ?? []) {
      if (typeof memberOf(service, path) !== 'number') {
        missing.push(`${requirement.service}.${path}`);
      }
    }
  }
  return missing;
}
