# Atlas in CI

Atlas treats your architecture as a reviewable artifact. Two headless tools let
you gate pull requests on it — no VS Code required.

## `atlas check` — health gate

```bash
node dist/atlas-check.mjs <dir> [--min-score=N] [--strict] [--json]
```

Reads `<dir>/atlas.yaml` (and optional `<dir>/atlas.rules.yaml`), then runs
structural validation, your rules, and the architecture-intelligence analysis
(cycles, layering, coupling). It prints a health grade and findings.

- `--min-score=N` — exit non-zero if the health score is below `N` (0–100).
- `--strict` — treat warnings as errors.
- `--json` — emit a machine-readable report.

Exit code is non-zero on any error, on `--strict` warnings, or when the score is
below `--min-score`, so it fails the job.

## `atlas diff` — PR architecture comment

```bash
node dist/atlas-diff.mjs <base.yaml> <head.yaml>
```

Compares two `atlas.yaml` versions and prints a Markdown summary — components and
connections added/removed/changed, the new health grade, and any critical
findings introduced. The output starts with a `<!-- atlas-pr-comment -->` marker
so CI can update one sticky comment instead of spamming new ones.

## Wiring it up

See [`.github/workflows/atlas-pr.yml`](../.github/workflows/atlas-pr.yml) for a
ready-to-use workflow that, on every PR:

1. builds the Atlas CLIs,
2. runs the health gate (`--min-score`),
3. diffs the architecture against the base branch, and
4. posts/updates a sticky PR comment with the changes.

Copy it into your repo and set `ATLAS_FILE` to your model's path (typically
`atlas.yaml` at the root). The job needs `pull-requests: write` permission to
comment.
