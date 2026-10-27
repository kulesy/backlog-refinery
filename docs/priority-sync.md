# Priority follows the score

When a card has a Priority Score, the board's Priority field follows the score's band:

| Level | Score |
|---|---|
| Urgent | 95 to 100 |
| High | 75 to 94 |
| Medium | 45 to 74 |
| Low | below 45 |

`levelForScore` and `SCORE_BANDS` in `public/assets/dor.js` hold the rule.

## Keeping the board in line

`node scripts/sync-priority.mjs [--dry-run]` reads the board and, for every card with a valid score whose Priority is not the level its
score gives, sets Priority. It touches no other field, skips cards without a score, writes nothing under `data/`, and stops after three
failures in a row. `--dry-run` lists the changes and makes none. It reads the columns in `statuses` in `config.json`.

Each run prints a summary line and one line per change, and exits non-zero if anything failed.

## Scheduling it

Run the script on a schedule you control: cron, launchd, or a GitHub Actions workflow with a token that can edit the project.
If you copy the band floors into any other script or workflow, change them together with `SCORE_BANDS`, or the two will flip a card's
Priority back and forth.

`node scripts/apply-scores.mjs [--dry-run]` is the other writer. It sets the Priority Score number field and the Priority for scores
you approved in the app, and marks each pick applied.
