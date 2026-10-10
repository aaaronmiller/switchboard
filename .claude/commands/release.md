Perform a release for this project.

The command has two stops where you hand control back to the user: an uncommitted-changes check at the start, and release-note approval before publishing. Never publish without the second confirmation.

## Step 1 — Check for uncommitted changes (stop point)

Run `git status --porcelain` and `git diff --stat HEAD`.

- **If anything is uncommitted or untracked:** stop. Show the user the list of changed and untracked files with a one-line description of what each change is. Ask what they want to do with them (commit as part of the release, commit separately, stash, discard, leave alone). Do nothing else until they answer.
- **If the tree is clean:** continue straight to Step 2 without asking anything.

## Step 2 — Prepare the release (no stops)

1. Find the most recent version tag with `git describe --tags --abbrev=0` and collect all commits between it and HEAD using `git log {prev_tag}..HEAD --format="%B---"`
2. Bump the version with `npm version patch --no-git-tag-version`
3. Commit the version bump with message: `v{version}: {short summary of changes}`
4. Create a git tag `v{version}`
5. Push commits and tag: `git push && git push --tags`
6. Wait for the GitHub Actions build to complete using `gh run watch` on the latest run
7. Confirm the build produced a draft release (`gh release view v{version}`). **Do not publish it.**

## Step 3 — Show release notes for approval (stop point)

Write the release notes and print them in full in the chat. Then stop and wait.

End the turn with the notes and a single line asking the user to confirm before publishing. Do not run `gh release edit`, do not pass `--draft=false`, and do not take any further action in that turn.

## Step 4 — Publish (only after the user confirms)

When the user says to go ahead, publish with the approved notes:

```
gh release edit v{version} --draft=false --notes "..."
```

If the user asks for edits to the notes first, revise and show them again, then wait for confirmation again.

## Release notes format

```
## What's Changed

### {Category}
- {change description}

### {Category}
- {change description}
```

Group changes by category (e.g. "Features", "Bug Fixes", "Performance Improvements", etc.).

## Writing the release notes

Write them for the person using the app, not for someone reading the git log. Read every commit between the tags so nothing user-facing gets missed — but the notes describe what changed for the user, they are not a summary of each commit.

Each entry says what the user will notice: what the app did before, what it does now. Don't name internal symbols, columns, migrations, or files.

Leave out:

- **Fixes for bugs introduced after the previous tag.** The user never ran that code, so there's nothing to announce. Describe only the net change since the last release.
- Refactors, schema migrations, test-only changes, and dev tooling with no visible effect.
- Cosmetic tweaks too small to notice — padding, font sizes, color nudges.
- **Anything not confirmed to actually work.** If a change is unverified or known broken, raise it before publishing instead of listing it.

Collapse a feature and its follow-up fixes into a single entry describing where things landed. Several commits often add up to one user-facing change; one commit sometimes makes several.

A short release with three real entries beats a padded one with twelve. If nothing user-facing changed, say so plainly.
