# Read tracker files from local clones

A repository's Issue tracker declaration (`docs/agents/issue-tracker.md`) and its Local Markdown Features (`.scratch/`) are read from the local clone's working tree, falling back to the GitHub default branch only when there is no local clone. Work repositories such as `IndieCampers/indiecampers` list both paths in `.git/info/exclude`, so they never reach GitHub and an API-only reader would see every PR there as Unfiled. Local clones are found by scanning `~/repos` and matching each clone's `origin` URL, with explicit paths in the app's own config taking precedence. Per-repository configuration lives in the app's config directory for the same reason: work repositories should not have to carry an app file.

## Considered Options

- **GitHub API only**: no filesystem access needed, but blind to locally excluded tracker files.
- **Config file inside each repository**: keeps configuration next to the code, but in work repositories it would be one more locally excluded file the app could not read through GitHub anyway.
