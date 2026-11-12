import type { V5ArmReport, V5Report } from './types.js';

function fixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function table(rows: readonly (readonly string[])[], headers: readonly string[]): string {
  const lines = [
    '| ' + headers.join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
  ];
  for (const row of rows) lines.push('| ' + row.join(' | ') + ' |');
  return lines.join('\n');
}

function armRow(arm: V5ArmReport): string[] {
  const first = arm.runs.find((run) => run.status === 'measured');
  return [
    '`' + arm.arm + '`',
    String(arm.measuredRuns) + '/' + String(arm.runs.length),
    fixed(arm.accepted.mean) + ' (' + arm.accepted.min + '-' + arm.accepted.max + ')',
    fixed(arm.exact.mean),
    first?.frames === undefined ? '—' : String(first.frames),
    first?.checkpointTokens === undefined ? '—' : String(first.checkpointTokens),
    first === undefined ? '—' : String(first.peakPromptTokens),
    first === undefined ? '—' : fixed(first.weightedCost, 0),
    first === undefined ? '—' : String(first.recallCalls),
  ];
}

/** Human-readable v5 report; the JSON beside it is the machine record. */
export function renderV5Report(report: V5Report): string {
  const lines: string[] = [
    '# Snapcompact evaluation v5',
    '',
    'Fixture: ' + '`' + report.fixture.id + '`' + ' (seed ' + report.fixture.seed + ')  ',
    'SHA-256: ' + '`' + report.fixture.hash + '`' + '  ',
    'Route: ' + '`' + report.provider + '/' + report.model + '`' + '  ',
    'Runs per arm: ' + report.runs + '  ',
    'Source: ' +
      report.fixture.sourceChars +
      ' chars, ' +
      report.fixture.estimatedSourceTokens +
      ' estimated tokens, ' +
      report.fixture.messages +
      ' messages.',
    '',
    '> Weighted cost is a relative unit, not a bill. v5 is a generated task-level suite; the test split is generated outside the repository.',
    '',
    '## Arms',
    '',
    table(report.arms.map(armRow), [
      'Arm',
      'Measured',
      'Accepted mean (min-max)',
      'Exact mean',
      'Frames',
      'Checkpoint tokens',
      'Peak prompt',
      'Weighted',
      'Recall calls',
    ]),
    '',
    '## Pure-visual by class',
    '',
    (() => {
      const arm = report.arms.find((entry) => entry.arm === 'pure-visual');
      if (arm === undefined) return 'Pure-visual arm not run.';
      return table(
        Object.entries(arm.byKind).map(([kind, tally]) => [
          kind,
          String(tally.correct) + '/' + String(tally.total),
        ]),
        ['Class', 'Correct'],
      );
    })(),
    '',
    '## Pure-visual by rendering region',
    '',
    (() => {
      const arm = report.arms.find((entry) => entry.arm === 'pure-visual');
      if (arm === undefined) return 'Pure-visual arm not run.';
      return table(
        Object.entries(arm.byRegion).map(([region, tally]) => [
          region,
          String(tally.correct) + '/' + String(tally.total),
        ]),
        ['Region', 'Correct'],
      );
    })(),
    '',
    '## Pure-visual by character class',
    '',
    (() => {
      const arm = report.arms.find((entry) => entry.arm === 'pure-visual');
      if (arm === undefined) return 'Pure-visual arm not run.';
      return table(
        Object.entries(arm.byCharacterClass).map(([cls, tally]) => [
          cls,
          String(tally.errors) + ' errors / ' + String(tally.total) + ' chars',
        ]),
        ['Class', 'Errors'],
      );
    })(),
    '',
    '## Per-turn (pure visual, first measured run)',
    '',
    (() => {
      const arm = report.arms.find((entry) => entry.arm === 'pure-visual');
      const run = arm?.runs.find((entry) => entry.status === 'measured');
      if (run === undefined) return 'Pure-visual arm not run.';
      return table(
        run.turns.map((turn) => [
          String(turn.index),
          String(turn.correct) + '/' + String(turn.total),
          String(turn.peakPromptTokens),
          fixed(turn.weightedCost, 0),
          String(turn.rounds),
          turn.parseMode,
          turn.reason ?? '',
        ]),
        ['Turn', 'Correct', 'Peak prompt', 'Weighted', 'Requests', 'Parse', 'Reason'],
      );
    })(),
    '',
    '## Measurement instrument',
    '',
    table(
      report.instrument.map((item) => [
        item.check,
        item.expected,
        item.actual,
        item.pass ? 'PASS' : 'FAIL',
      ]),
      ['Check', 'Expected', 'Actual', 'Result'],
    ),
    '',
    '## Product gates',
    '',
    table(
      report.gates.map((item) => [
        item.check,
        item.expected,
        item.actual,
        item.pass ? 'PASS' : 'FAIL',
      ]),
      ['Gate', 'Expected', 'Actual', 'Result'],
    ),
    '',
    '## Preparation',
    '',
    table(
      [
        [
          'native-text',
          String(report.nativePreparation.elapsedMs.toFixed(0)) + ' ms',
          report.nativePreparation.reason ?? '',
        ],
        [
          'pure-visual',
          String(report.visualPreparation.elapsedMs.toFixed(0)) + ' ms',
          report.visualPreparation.reason ?? '',
        ],
        [
          'degraded-visual',
          String(report.degradedPreparation.elapsedMs.toFixed(0)) + ' ms',
          report.degradedPreparation.reason ?? '',
        ],
      ],
      ['Arm', 'Elapsed', 'Reason'],
    ),
    '',
    '## Usage audit',
    '',
    'Requests: ' +
      report.usageAudit.requests +
      '; reported total: ' +
      report.usageAudit.reportedTotalTokens +
      '; computed: ' +
      report.usageAudit.computedTotalTokens +
      '; unreported prompt: ' +
      report.usageAudit.unreportedPromptTokens +
      '; complete: ' +
      (report.usageAudit.complete ? 'yes' : 'no') +
      '.',
    '',
    report.warning,
    '',
  ];
  return lines.join('\n');
}
