# CutQuest — deploy package

This is the static CutQuest frontend already connected to your existing Supabase project.

## Upload to GitHub

Repository: `lrussoeu-afk/cutquest`

1. Open the repo on GitHub.
2. Choose **Add file → Upload files**.
3. Drag **all files inside this package** into the root of the repo.
4. If GitHub says files such as README.md, index.html or styles.css already exist, replace them with these versions.
5. Commit directly to `main`.

Important: upload the files themselves, not the containing `cutquest-deploy` folder.

## Option A — Vercel

1. Open Vercel.
2. **Add New → Project**.
3. Import `lrussoeu-afk/cutquest`.
4. Framework preset: **Other**.
5. Build command: blank.
6. Output directory: blank.
7. Deploy.

Vercel should detect and serve `index.html`.

## Option B — GitHub Pages

1. GitHub repo → **Settings → Pages**.
2. Under Build and deployment, choose **Deploy from a branch**.
3. Branch: `main`.
4. Folder: `/ (root)`.
5. Save.

Your URL should be:
`https://lrussoeu-afk.github.io/cutquest/`

## First use

Open the deployed site.

If you have not created the CutQuest owner account yet:
1. Enter your email.
2. Choose a password of at least 8 characters.
3. Click **Create owner**.

After the first owner exists, just use **Sign in**.

## Security note

`config.js` contains a Supabase **publishable key**. It is intentionally safe to ship in browser code. Your nutrition data is protected by Supabase authentication and Row Level Security.

Never put a Supabase service-role or secret key into this frontend.

## Included

- Supabase email/password authentication
- single-owner bootstrap
- persistent daily logs
- persistent meals
- calories / protein / carbs / fat
- meal check-offs
- meal rerolls
- targets and meal times
- weigh-ins and body-fat entries
- recent history
- 7-day averages
- XP / streak persistence
- basic PWA support


## Latest update
- Adaptive portion scaling now outputs direct ingredient quantities
- Generated meals refit to remaining daily calories, protein and net carbs
- Manual logs support net carbs and optional total carbs
