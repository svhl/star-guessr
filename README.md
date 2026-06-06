# StarGuessr

Guess the GitHub stars of 5 repositories

**Game modes:**
- **Daily** — same 5 repos for everyone each day, one attempt per day
- **Unlimited** — random repos, unlimited plays, global leaderboard  
- **Multiplayer** — real-time rooms, play with friends via a 6-character room code

**Scoring:** logarithmic proximity score = up to 1,000 per round, 5,000 total.

---

## Setup

### 1. Prerequisites

- Node.js ≥ 20
- A GitHub personal access token (for the fetch script)

### 2. Install dependencies

```bash
# Root (concurrently runner)
npm install

# Server
cd server && npm install && cd ..

# Client
cd client && npm install && cd ..

# Fetch script
cd scripts && npm install && cd ..
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
GITHUB_TOKEN=ghp_your_token_here    # Only needed for the fetch script
JWT_SECRET=some_long_random_secret  # REQUIRED — server won't start without this
PORT=3000
NODE_ENV=development
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Fetch the repo dataset

**Warning: this takes 30–60 minutes** due to GitHub API rate limits (5,000 req/hr).  
The script fetches ~3,000 most-starred non-fork repos with file trees and commit history.

```bash
cd scripts
GITHUB_TOKEN=ghp_... ts-node fetch-repos.ts
```

Or use your `.env`:
```bash
cd scripts
npm run fetch
```

The SQLite database is saved to `data/starguessr.db`. Re-run at any time to refresh star counts — existing rows are upserted, no duplicates.

### 5. Start the dev server

```bash
npm run dev
```

This starts:
- **Express + Socket.io** on `http://localhost:3000`
- **Vite dev server** on `http://localhost:5173` (proxies `/api` and `/socket.io` to Express)

Open `http://localhost:5173` in your browser.

---

## Production build

```bash
npm run build
```

This compiles the React frontend into `server/public/` and compiles the server TypeScript to `server/dist/`.

Start the production server (serves the frontend itself):

```bash
cd server
JWT_SECRET=... NODE_ENV=production node dist/index.js
```

---

## Project structure

```
star-guessr/
├── client/           React + TypeScript + Vite frontend
│   └── src/
│       ├── pages/    Home, Game, Leaderboard, Multiplayer
│       ├── components/  FileTree, ReadmeViewer, CommitsList, Timer, GuessInput, PostRound, Scoreboard
│       ├── hooks/    useSocket
│       └── utils/    scoring, storage
├── server/           Express + Socket.io backend
│   └── src/
│       ├── routes/   session, repos, leaderboard
│       ├── socket/   multiplayer room management
│       ├── db.ts     SQLite queries
│       └── scoring.ts  Server-side score computation
├── scripts/
│   └── fetch-repos.ts  Dataset fetch script
├── data/             SQLite database (git-ignored)
└── .env.example
```
