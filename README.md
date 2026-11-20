# BuildLog

**Your development history, on autopilot.** BuildLog connects to your GitHub repositories, records pushes, pull requests and issues as they happen, summarises the activity with Gemini, and keeps a per-repository **Project Memory**: what the project is, what changed recently, open work, technical decisions and suggested next steps.

Live: https://buildlog-manage.vercel.app

---

## Features

- **GitHub App integration** – connect any repository you can install apps on; recent history is imported immediately.
- **Webhook ingestion** – push, pull request and issue events arrive in real time, verified with HMAC-SHA256 and de-duplicated with delivery leases.
- **AI summaries** – server-side Gemini summarisation of activity (optional; raw activity is still recorded without it).
- **Project Memory** – deterministic per-repo memory built from history, plus a Markdown "resume" export.
- **Dashboard & timeline** – activity metrics, clustered timeline, repository detail pages.
- **Privacy controls** – per-user data isolation enforced by Firestore security rules, JSON export and full account data deletion.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, React Router 7, Motion |
| Backend | Express (TypeScript), run as a Vercel Function |
| Auth & data | Firebase Authentication (email/password, Google), Cloud Firestore |
| Server state | Firestore via `firebase-admin` (webhook queue, delivery leases, GitHub sessions) – local JSON file in development |
| AI | Google Gemini via `@google/genai` |
| Hosting | Vercel |

## How it works

```
GitHub ──webhook──▶ /api/webhooks/github ──verify HMAC──▶ lease + queue (Firestore)
                                                               │
Browser (signed in) ◀── poll /api/ingestion/pending ◀─────────┘
   │  writes events to Firestore, acks queue
   └─▶ /api/summarize (Gemini) ──▶ activity summaries + Project Memory in Firestore
```

1. The user pastes a repository URL; the server checks authorisation and, if needed, sends them through the GitHub App install + OAuth flow.
2. Recent commits, PRs and issues are imported and saved to Firestore.
3. New GitHub webhooks are verified, de-duplicated and queued server-side.
4. While the app is open, the browser pulls queued events into Firestore and requests summaries.

> **Note:** step 4 runs in the browser, so new webhook events are only moved into your timeline while a BuildLog tab is open. They wait safely in the queue until then.

## Project structure

```
├── server.ts                    # Local dev/production server (Express + Vite middleware)
├── vercel.json                  # Vercel install/build commands
├── deploy/vercel/function.ts    # Vercel Function entry for /api/* (bundled at build time)
├── scripts/build-vercel.mjs     # Writes .vercel/output (static site + API function + routes)
├── firestore.rules              # Firestore security rules (deploy manually – see below)
├── security_spec.md             # Security invariants the rules enforce
├── firebase-applet-config.json  # Firebase web config (public by design)
└── src/
    ├── server/                  # Express app, GitHub App client, webhook store, Gemini, auth
    ├── pages/                   # Landing, Auth, Dashboard, Projects, Timeline, Integrations, …
    ├── components/              # UI, layout, integrations
    ├── contexts/                # Auth, workspace, toast state
    ├── services/                # Firestore, API client, auth helpers
    └── utils/                   # Normalisation, clustering, memory builder, validation, export
```

## Getting started (local development)

### Prerequisites

- Node.js 20+ (22 recommended)
- A Firebase project with **Authentication** (Email/Password + Google) and **Firestore** enabled
- A GitHub App (see [GitHub App setup](#github-app-setup))
- Optional: a Gemini API key from [Google AI Studio](https://aistudio.google.com)

### Install and run

```bash
git clone https://github.com/snehashisroy-cognicorpus/BuildLog.git
cd BuildLog
npm install            # .npmrc enables legacy-peer-deps
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:3000
```

Check configuration at `http://localhost:3000/api/health`: `missingEnvVars` should be empty.

GitHub can't deliver webhooks to `localhost`. To test webhooks locally, expose the server with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) and use that URL as `APP_URL` and in the GitHub App settings.

### Using your own Firebase project

Replace the values in `firebase-applet-config.json` with your Firebase web app config (set `firestoreDatabaseId` to `(default)` or your database name), add your domains under **Authentication → Settings → Authorized domains**, and publish `firestore.rules`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | Yes | Public URL of the app, e.g. `https://buildlog-manage.vercel.app` (no trailing slash) |
| `GITHUB_APP_ID` | Yes | Numeric GitHub App ID |
| `GITHUB_APP_SLUG` | Yes | App slug from `github.com/apps/<slug>` |
| `GITHUB_APP_CLIENT_ID` | Yes | GitHub App Client ID |
| `GITHUB_APP_CLIENT_SECRET` | Yes (secret) | GitHub App client secret |
| `GITHUB_APP_PRIVATE_KEY` | Yes (secret) | Full contents of the App's `.pem` private key (multi-line, `\n`-escaped or base64 are all accepted) |
| `GITHUB_WEBHOOK_SECRET` | Yes (secret) | Webhook secret configured on the GitHub App |
| `GEMINI_API_KEY` | No (secret) | Enables AI summaries |
| `FIREBASE_SERVICE_ACCOUNT` | Vercel (secret) | Full contents of a Firebase service account key `.json` (raw or base64). Lets the server store its data in Firestore |
| `FIRESTORE_DATABASE_ID` | No | Override the Firestore database (defaults to `firestoreDatabaseId` in `firebase-applet-config.json`) |

Never commit real secrets. `.env*` files (except `.env.example`) are git-ignored.

## GitHub App setup

Create an app at **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**:

| Setting | Value |
|---|---|
| Homepage URL | `APP_URL` |
| Callback URL | `APP_URL/integrations` |
| Setup URL | `APP_URL/integrations` (tick *Redirect on update*) |
| Request user authorization during installation | **Off** (BuildLog runs OAuth itself) |
| Webhook URL | `APP_URL/api/webhooks/github` (active, with a secret) |
| Repository permissions | Read-only: **Contents, Metadata, Pull requests, Issues** |
| Subscribe to events | **Push, Pull request, Issues** |
| Where can it be installed | *Any account* if others will connect their own repos |

Then copy the App ID, slug, Client ID, a new client secret and a generated private key into your environment variables.

## Deploying to Vercel

1. **Import the repo** in Vercel (*Add New… → Project → Import* the GitHub repo). Build settings come from `vercel.json`, so leave the framework preset and output settings as they are:
   - Install command: `npm install` (`.npmrc` enables legacy peer deps)
   - Build command: `npm run build:vercel`
2. **Create a Firebase service account key** for server-side storage: Firebase console → ⚙️ *Project settings → Service accounts → Generate new private key*. This downloads a `.json` file.
3. **Add environment variables** (see table above) under *Project → Settings → Environment Variables*, including `FIREBASE_SERVICE_ACCOUNT` (paste the whole `.json` file contents). Tick at least **Production**.
4. **Redeploy.** New environment variables only take effect after a new deployment (*Deployments → ⋯ → Redeploy*).
5. **Firebase:** add your Vercel domain (e.g. `buildlog-manage.vercel.app`) to *Authentication → Settings → Authorized domains*.
6. **GitHub App:** point the Homepage, Callback, Setup and Webhook URLs at your Vercel domain (see [GitHub App setup](#github-app-setup)).
7. **Verify:** `https://<your-domain>/api/health` should report `configured: true` with no missing variables.

### How the Vercel build works

`npm run build:vercel` runs `vite build`, then `scripts/build-vercel.mjs`, which writes a [Build Output API](https://vercel.com/docs/build-output-api) directory:

| Path | Contents |
|---|---|
| `.vercel/output/static/` | The frontend (`dist/`) |
| `.vercel/output/functions/api.func/` | The Express API from `deploy/vercel/function.ts`, bundled with esbuild into a single file (Node.js 22, Vercel request helpers off so webhook signatures are checked on the raw body) |
| `.vercel/output/config.json` | Routing: `/api/*` → the API function, everything else → `index.html` |

### Server-side storage

The server keeps a little state of its own: GitHub sign-in sessions, one-time sign-in links, the queue of incoming GitHub updates and webhook delivery locks. On Vercel this lives in **Firestore**, in server-only collections that the client can't read (blocked by `firestore.rules`):

- `buildlog_server_state` for production deployments
- `buildlog_server_state_preview` for preview deployments, so previews can never touch production data

Writes that must not race (delivery locks, one-time links) use Firestore's atomic *create* and *update-if-unchanged* operations. In local development the same data is kept in `.data/server-state.json`. Set `BUILDLOG_STORAGE=firestore` to use Firestore elsewhere.

## Firestore security rules

Rules live in `firestore.rules` and are **not deployed by Vercel**. After changing them, publish them in the Firebase console (*Firestore → select the app's database → Rules → Publish*) or with the Firebase CLI. The rules enforce:

- authentication on every read/write, with strict per-user ownership (`ownerId == request.auth.uid`)
- immutable ownership fields, allow-listed fields and bounded sizes
- referential checks (repositories must belong to your integration, events to your repository)

See `security_spec.md` for the full list of invariants.

> The Firebase **web API key** in `firebase-applet-config.json` is public by design (it ships in the browser bundle). Protect it with Firestore rules and by restricting the key to your domains and Firebase APIs in Google Cloud Console.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Express + Vite dev server on port 3000 |
| `npm run build` | Build the frontend into `dist/` |
| `npm run build:vercel` | Build the frontend and the Vercel output (`.vercel/output/`) |
| `npm start` | Run the production server locally (after `npm run build`) |
| `npm run lint` | Type-check with `tsc --noEmit` |

### Tests

Tests use Node's built-in test runner:

```bash
npx tsx --test src/utils/logic.test.ts src/server/app.test.ts src/server/webhookStore.integration.test.ts
```

## Known limitations

- Ingestion of queued webhook events into Firestore happens in the browser, so a BuildLog tab must be open.
- The API function is limited to 30 seconds per request (`maxDuration`); very large summaries may not complete (raw activity is still saved).
- The Gemini rate limit is kept in memory per function instance.
- GitHub user access tokens are stored in the server-only Firestore collection without additional encryption.

## Contributing

Work happens on a feature branch and is merged into `main` through pull requests; Vercel deploys `main` automatically.
