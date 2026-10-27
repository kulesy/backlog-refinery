# The agent hand-off

The app records your decisions and stops there. Something else, usually a Claude Code session, applies them to GitHub. This page is
the contract, so you can use any agent or a script of your own.

## 1. Produce the plan

Click **End turn** in the app, or `POST /api/plan`. The server writes two files in the data folder:

- `plan.json`, for programs.
- `PLAN.md`, the same content for a person or an agent to read.

`plan.json` looks like this:

    {
      "generatedAt": "2026-10-01T09:30:00.000Z",
      "items": [
        {
          "id": "web#42",
          "url": "https://github.com/your-org/web/issues/42",
          "itemId": "PVTI_...",
          "repo": "web", "num": 42, "title": "Fix the login redirect",
          "action": "rewrite-and-estimate",
          "steps": [ { "kind": "estimate", "value": 4 }, { "kind": "status", "value": "ready" } ],
          "text": { "body": "...", "title": "..." },
          "note": "",
          "edited": false,
          "decidedAt": "2026-10-01T09:12:00.000Z"
        }
      ]
    }

- `steps` are board changes you already approved by clicking Accept. `kind` is `estimate`, `status` or `close`. A status `value` is a key
  of `statusOptions` in `config.json` (`ready`, `notReady`, and so on), and `itemId` is the project item id to edit.
- `text` holds drafts: `body`, `title`, `comment`, `decision`, `split`. Show these to a human before posting anything. The app does not
  treat a click on Accept as sign-off on the wording.

## 2. Apply it

With the GitHub CLI, an estimate is:

    gh project item-edit --id <itemId> --project-id <projectId> --field-id <fields.estimate> --number <value>

and a status is the same command with `--single-select-option-id <statusOptions[value]>` and `--field-id <fields.status>`. Every id is in
your `config.json`. Body and title edits use `gh issue edit`, and a close uses `gh issue close --reason "not planned"`.

With Claude Code, open a session in this folder and say "read data/PLAN.md and action it". Ask it to show you each piece of text first.

## 3. Mark items applied

Tell the app, so they drop out of the next plan:

    curl -X POST localhost:4380/api/applied -H 'content-type: application/json' -d '{"ids":["web#42"]}'

The app then refuses to undo or skip those decisions, because the change is already on the board.

## Other things the app records

- `priority-decisions.json` and `score-decisions.json`: Priority and Priority Score picks. `node scripts/apply-scores.mjs` applies them.
- `carry-decisions.json`: approved drafts of issue text. The agent that posts them is yours to write.
- `suggestions.json`: the agent's recommended update for each card. The app only reads it. Any agent can write it. A card with no entry
  shows "verify first, no suggestion yet". Look at `examples/demo/data/suggestions.json` for the shape.
