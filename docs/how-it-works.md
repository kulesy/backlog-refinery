# How it works

- `server.mjs` reads the board live with `gh project item-list`, cached for `boardCacheMinutes`, and merges in
  `suggestions.json`, `dupes.json`, `deep.json` and your `decisions.json` from the data folder.
- `public/assets/dor.js` decides each card's four checks and its pile: Your turn, With Claude (approved, not yet on the board),
  Needs a draft, and Ready, plus In progress and Skipped in the Collection. `node scripts/check-dor.mjs [dataDir]` prints the
  piles from the data on disk.
- **End turn** writes the accepted, not-yet-applied decisions to `plan.json` and `PLAN.md` for an agent to action.

| Accepted action | Board steps in the plan | Text in the plan |
|---|---|---|
| Set estimate | estimate, status ready | none |
| Rewrite and estimate | estimate | body |
| Rewrite body | none | body |
| Close, superseded or not planned | close as not planned | closing comment, supersede target |
| Split, Needs a decision | status not ready | none |
| Verify first, Leave as is | none | none |

## Stage mode

Open `http://localhost:4380/?stage` for a talk or a demo. It deals only cards from your public repos with no security label,
hides private issue refs and local paths, and sets larger type for a projector.

## Testing against a copy of the data

    REFINERY_DATA=/path/to/copy PORT=4381 node server.mjs

runs a second instance that reads and writes the copy, so you can try changes without touching real decisions. `npm test` runs the unit tests.
