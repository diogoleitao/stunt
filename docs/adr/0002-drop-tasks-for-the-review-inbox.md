# Drop Tasks for the Review inbox

stunt no longer turns activity into Tasks to mark done. The Review inbox already clears itself once you submit a review, so a Review request needs no local done or expired state, and reviews, thread replies, and conversation comments on Assigned PRs are announced by the `pr-monitor` skill instead. Assigned PRs show their review state rather than unacknowledged activity: Pending review when someone else's PR has a Review request pending for you or you have never reviewed it, otherwise each reviewer's standing review. Notifications announce only new Review requests, each once, and the stored Task history and the Baseline are dropped with no migration.

## Consequences

- A Review request cannot be dismissed without reviewing; it leaves the Review inbox only when you review, the request is withdrawn, or the PR is merged or closed.
- Activity on Assigned PRs leaves no trace in stunt, so bringing Tasks back means starting from a new Baseline.
