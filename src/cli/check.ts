/**
 * `atlas check` — a headless architecture linter and health report for CI.
 *
 * Loads `atlas.yaml` (and optional `atlas.rules.yaml`) from a directory, runs
 * structural validation plus the built-in and user-authored rules, computes an
 * architecture health score and insights (cycles, layering, coupling), prints
 * everything, and exits non-zero on errors. This lets a team gate pull requests
 * on their architecture — not just their code.
 *
 *   node dist/atlas-check.mjs [directory] [--min-score=N] [--strict] [--json]
 *
 *   --min-score=N  Fail (exit 1) if the health score is below N (0–100).
 *   --strict       Treat warnings as errors.
 *   --json         Emit a machine-readable report instead of text.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { analyzeArchitecture, sortInsights } from '../shared/model/insights';
import { compileRules } from '../shared/rules/custom';
import { BUILT_IN_RULES, evaluateRules } from '../shared/rules/rules';
import { validateModel } from '../shared/serialization/validation';
import { deserializeModel } from '../shared/serialization/yaml';

interface Args {
  dir: string;
  minScore: number | null;
  strict: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: process.cwd(), minScore: null, strict: false, json: false };
  for (const arg of argv) {
    if (arg === '--strict') args.strict = true;
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('--min-score=')) {
      const n = Number(arg.slice('--min-score='.length));
      args.minScore = Number.isFinite(n) ? n : null;
    } else if (!arg.startsWith('--')) {
      args.dir = arg;
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const file = join(args.dir, 'atlas.yaml');
  if (!existsSync(file)) {
    console.error(`atlas check: no atlas.yaml found in ${args.dir}`);
    process.exit(2);
  }

  let model;
  try {
    model = deserializeModel(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`atlas check: invalid atlas.yaml — ${(error as Error).message}`);
    process.exit(2);
  }

  const validation = validateModel(model);
  const rulesFile = join(args.dir, 'atlas.rules.yaml');
  const customRules = existsSync(rulesFile) ? compileRules(readFileSync(rulesFile, 'utf8')) : [];
  const violations = evaluateRules(model, [...BUILT_IN_RULES, ...customRules]);
  const report = analyzeArchitecture(model);
  const insights = sortInsights(report.insights);

  const warnings =
    validation.issues.filter((i) => i.severity === 'warning').length +
    violations.filter((v) => v.severity === 'warning').length +
    insights.filter((i) => i.severity === 'warning').length;
  let errors =
    validation.issues.filter((i) => i.severity === 'error').length +
    violations.filter((v) => v.severity === 'error').length +
    insights.filter((i) => i.severity === 'critical').length;

  const belowMin = args.minScore !== null && report.score < args.minScore;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          score: report.score,
          grade: report.grade,
          metrics: {
            nodeCount: report.metrics.nodeCount,
            edgeCount: report.metrics.edgeCount,
            isolatedCount: report.metrics.isolatedCount,
            mappingCoverage: report.metrics.mappingCoverage,
          },
          validation: validation.issues,
          rules: violations,
          insights,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Architecture health: ${report.grade}  (${report.score}/100)`);
    console.log(
      `  ${report.metrics.nodeCount} components · ${report.metrics.edgeCount} connections · ${Math.round(
        report.metrics.mappingCoverage * 100,
      )}% mapped`,
    );
    console.log('');
    const print = (sev: string, message: string) =>
      console.log(`  ${glyph(sev)} [${sev}] ${message}`);
    for (const issue of validation.issues) print(issue.severity, issue.message);
    for (const v of violations) print(v.severity, v.message);
    for (const i of insights) print(i.severity === 'critical' ? 'critical' : i.severity, `${i.title}: ${i.detail}`);

    const total = validation.issues.length + violations.length + insights.length;
    console.log('');
    console.log(total === 0 ? 'atlas check: no findings.' : `atlas check: ${total} finding(s), ${errors} error(s), ${warnings} warning(s).`);
    if (belowMin) {
      console.log(`atlas check: health ${report.score} is below --min-score=${args.minScore}.`);
    }
  }

  if (args.strict) {
    errors += warnings;
  }
  process.exit(errors > 0 || belowMin ? 1 : 0);
}

function glyph(severity: string): string {
  if (severity === 'error' || severity === 'critical') return '✖';
  if (severity === 'warning') return '▲';
  return '•';
}

main();
