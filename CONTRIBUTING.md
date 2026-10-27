# Contributing

Thanks for looking. Issues and pull requests are welcome.

## Set up

    git clone <this repo>
    cd backlog-refinery
    npm run demo        # no GitHub board needed
    npm test

Node 20 or later. There are no dependencies to install.

## Ground rules

- Keep it dependency-free and vanilla JS. The server is plain Node and the client is plain ES modules.
- The app never writes to GitHub. Decisions go to the data folder, and a separate agent or script applies them.
  A change that makes the server write to a board needs a strong reason and a discussion first.
- `public/assets/dor.js` is shared by the browser and the server, so it must not use DOM or Node APIs.
- Comments say why, in one or two lines. The code says what.
- Keep personal or team details out of the code. Board names, repos and private-repo rules come from `config.json`.

## Never commit

- `config.json` (it holds your board ids) or anything in `data/` (it holds real issue text).
- Tokens, `.env` files, or links to private repos.

`.gitignore` covers these. Run `git status` before you commit anyway.

## Pull requests

- One change per PR, with a sentence on why.
- Run `npm test` and `node --check` on any file you touched.
- If you change the Definition of Ready checks or the score bands, update the README and `docs/priority-sync.md` in the same PR.
