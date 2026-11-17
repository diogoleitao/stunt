# Contributing

## Commit messages

Every commit must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

## Linting

`npm run lint` checks the code against [neostandard](https://github.com/neostandard/neostandard) and needs Node `^22.13.0 || >=24`, newer than the `>=20` that running stunt needs. `npm run lint -- --fix` fixes most problems.

## Git hooks

`npm install` points git at `.githooks`, whose `pre-commit` hook runs `npm run lint`, `npm run typecheck` and `npm test` and aborts the commit on the first failure. It checks every file on disk, so what is staged makes no difference to the result, and it needs the same Node as lint. `git commit --no-verify` skips it.
