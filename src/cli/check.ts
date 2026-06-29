/**
 * `atlas check` — a headless architecture linter for CI.
 *
 * Loads `atlas.yaml` (and optional `atlas.rules.yaml`) from a directory, runs
 * structural validation plus the built-in and user-authored rules, prints the
 * findings, and exits non-zero on any error. This lets a team gate pull
 * requests on their architecture rules, not just their code.
 *
 *   node dist/atlas-check.mjs [directory]
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { compileRules } from '../shared/rules/custom';
import { BUILT_IN_RULES, evaluateRules } from '../shared/rules/rules';
import { validateModel } from '../shared/serialization/validation';
import { deserializeModel } from '../shared/serialization/yaml';

function main(): void {
  const dir = process.argv[2] || process.cwd();
  const file = join(dir, 'atlas.yaml');
  if (!existsSync(file)) {
    console.error(`atlas check: no atlas.yaml found in ${dir}`);
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
  const rulesFile = join(dir, 'atlas.rules.yaml');
  const customRules = existsSync(rulesFile)
    ? compileRules(readFileSync(rulesFile, 'utf8'))
    : [];
  const violations = evaluateRules(model, [...BUILT_IN_RULES, ...customRules]);

  let errors = 0;
  const print = (severity: string, message: string) => {
    console.log(`  ${severity === 'error' ? '✖' : severity === 'warning' ? '▲' : '•'} [${severity}] ${message}`);
    if (severity === 'error') errors += 1;
  };
  for (const issue of validation.issues) print(issue.severity, issue.message);
  for (const v of violations) print(v.severity, v.message);

  const total = validation.issues.length + violations.length;
  console.log(
    total === 0
      ? 'atlas check: no issues.'
      : `atlas check: ${total} finding(s), ${errors} error(s).`,
  );
  process.exit(errors > 0 ? 1 : 0);
}

main();
