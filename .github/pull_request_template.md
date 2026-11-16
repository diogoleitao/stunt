## Summary

Closes #[issue]. [One sentence: what exists now that did not before, in GLOSSARY.md terms.]

<!-- Use "Part of #[issue]." instead when the PR does not meet every acceptance criterion. -->
<!-- The smallest view that makes the point: diff of the model, routes, CLI or file tree; pseudocode for rules. One block per concern. -->

<!-- Optional, move the ones that apply out of this comment:
- **Dependencies:** [added or removed packages, and why]
- **Config or state file:** [changed keys or `state.json` shape, and the migration]
- **Glossary:** [terms added or changed]
-->

## Evidence

- **Before:** [failing test, command output, or what the page showed on `main`]
- **After:** [the same thing now]
- **Tests:** `npm test`: [n] passed. `npm run typecheck`: [clean, or the errors]. New cases: [one line per test name]
- **Manual:** [commands and output from a run against a scratch `config.json` and `state.json`, or "none"]
- **Not tested:** [parts the new tests leave untested, and parts not run in a browser or through the CLI, or "none"]

## Merge Danger

**Door:** [one-way or two-way]

[What reverting means: data to migrate, and whether `main` still reads `config.json` and `state.json`.]

**Blast Radius:** [area: the page, command or module affected]

- [user-facing change outside the area]
- [changed contract other code relies on, such as the `Schedule` that `start()` returns]

**Known gaps:** [what still fails, each linked to the issue that tracks it, or "none"]

**Related:** [open PRs or issues this interacts with, and how, or "none"]
