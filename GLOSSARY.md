# stunt

A personal alternative to GitHub's pull request interfaces that tracks the review activity on PRs you are involved in, per repository, and turns new activity into tasks.

## Language

### Pull requests

**Assigned PR**:
An open PR that lists you among its assignees, whoever authored it.
_Avoid_: My PR, own PR, authored PR

**Review request**:
A direct request for you to review an open PR. Being requested again after you have already reviewed is a re-request, and counts as a new Review request.
_Avoid_: Review assignment

**Review inbox**:
The open PRs with a Review request you have not yet acted on by submitting a review.
_Avoid_: Review queue, to-review list

**Review status**:
A PR's overall review state: review required, approved, or changes requested.
_Avoid_: Review decision, approval state

### Features

**Issue tracker**:
Where a repository keeps its features and tickets, as declared by that repository's Matt Pocock skills setup. Each repository has its own.
_Avoid_: Backlog, project board

**Feature**:
A spec-sized unit of work in a repository's Issue tracker. Its tickets are shipped by PRs, and PRs are grouped under the Feature they ship.
_Avoid_: Epic, project, initiative

**Ticket**:
One implementation issue belonging to a Feature.
_Avoid_: Task, story, sub-issue

**Unfiled**:
The group for PRs that cannot be linked to any Feature.
_Avoid_: Ungrouped, other, misc

### Activity

**Task**:
One piece of activity on a PR that you acknowledge by marking it done: a Review request, a review, a thread reply, or a conversation comment. A Review request Task is done once you submit a review.
_Avoid_: Notification, alert, event, to-do

**Expired**:
A Task that ended without being done, because its PR was merged or closed or its Review request was withdrawn.
_Avoid_: Dismissed, cancelled

**Notification**:
The desktop alert announcing a repository's new Tasks of one kind, such as its new reviews or its new Review requests.
_Avoid_: Alert, ping

**Baseline**:
The moment tracking first started. Reviews and comments from before it never become Tasks; those posted after it always do, even while the app was stopped.
_Avoid_: Start time, cutoff
