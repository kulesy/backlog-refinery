# Agent workflows

These are the SSW TinaCloud team's own prompts for the Claude Code Workflow tool. They are kept here as worked examples of how the refinery's data files get drafted, checked and trimmed by agents.

They are hard-coded to the team's repos (`tinacms/tinacms` and `tinacms/tinacloud`), their house rules and their way of working. Adapt them to your own board and style guide rather than running them as they are.

Each script takes its inputs through `args`:

- `root`: the Backlog Refinery folder, default `.`. Staged input files are read from `<root>/data/`.
- `clones`: the folder holding your local checkouts of the repos, default `..`.
- `ids` or `batches`: the item ids or batches to work on.

Agents only draft. They post nothing to GitHub, and nothing here writes to your board.
