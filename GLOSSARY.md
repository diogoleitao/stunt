# stunt

A personal alternative to GitHub's pull request interfaces that shows the review state of PRs you are involved in, per repository, and announces new Review requests.

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

**Pending review**:
An Assigned PR someone else authored on which a Review request for you is pending, or which you have never reviewed. An Assigned PR you authored is never Pending review.
_Avoid_: Needs review, awaiting review, unreviewed

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

### Notifications

**Notification**:
The desktop alert announcing a repository's new Review requests. Each Review request is announced once.
_Avoid_: Alert, ping

### Checks

**Check**:
One look at GitHub and the local clones for your Assigned PRs, your Review inbox, each repository's Issue tracker, and the Features its PRs ship, across every repository. stunt runs one every `checkIntervalSeconds`, timed from the end of the last, and at once when you ask for one.
_Avoid_: Sync, refresh, poll, full check

**Repository check**:
A Check of a single repository, run when you ask for it from that repository's page. It leaves every other repository as the last Check saw it.
_Avoid_: Repo sync, sync per repo, partial check
