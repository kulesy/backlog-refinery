# Configuration

`config.json` is yours and is git-ignored. [config.example.json](config.example.json) shows every key.

| Key | What it does |
|---|---|
| `owner`, `projectNumber`, `projectId` | Which board to read |
| `fields`, `statusOptions`, `priorityOptions` | Field and option ids, used when a script writes to the board |
| `statuses` | Columns to load, with the exact names including any emoji |
| `boardName` | The board name, shown as a tooltip on the "Board as of" line |
| `repos` | Repos to fetch created dates for. Defaults to the repos on the board |
| `privateRepos` | Repos whose issue links and ids are hidden in stage mode and marked private |
| `repoLabels` | Display names for the crest on cards with no type, for example `{"web": "Web app"}` |
| `dor` | `gitmoji` and `evidence` switch on two optional checks beyond the standard four |
| `autoApprove.titles` | Approve title-only drafts without a click |
| `stage` | Stage mode overrides: `repos`, `hideLabels`, `ids` |
| `port`, `boardCacheMinutes` | Server port, and how long a board fetch is reused |

Set `REFINERY_DATA` to keep the data folder somewhere else, for example outside the repo.
