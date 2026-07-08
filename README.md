# ⚔ LifeScrum — Personal Life Scrum Board

A Solo Leveling–themed personal scrum board. Organize your life into lanes, move quest cards across columns, earn XP, track burndown per lane, and roll over sprints monthly.

**Local-first with cloud sync**: the board always works offline from your browser's storage. Sign in (free, magic-link email — no password) and it syncs live to every device you use.

## Tech

Plain HTML/CSS/JS — no build step. [Supabase](https://supabase.com) (free tier) for auth + cloud storage. Deployable anywhere static files are served (Vercel).

## One-time setup

### 1. Cloud sync (Supabase — free)

1. Go to [supabase.com](https://supabase.com) → sign up → **New project** (any name, e.g. `lifescrum`).
2. In the project: **SQL Editor → New query** → paste the contents of [`supabase-setup.sql`](supabase-setup.sql) → **Run**.
3. Go to **Project Settings → API** and copy two values into [`config.js`](config.js):
   - **Project URL** → `SUPABASE_URL`
   - **anon / public key** → `SUPABASE_ANON_KEY` (this key is safe to commit — access is protected by row-level security)
4. After deploying (step 3 below), go to **Authentication → URL Configuration** in Supabase and set **Site URL** to your Vercel URL (e.g. `https://lifescrum.vercel.app`) so magic-link emails redirect to the right place.

### 2. Push to GitHub

```bash
# from the project folder (repo is already initialized and committed)
gh auth login                      # or create the repo on github.com manually
gh repo create lifescrum --public --source . --push
```

### 3. Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

Or zero-CLI: go to [vercel.com/new](https://vercel.com/new), import the GitHub repo, click **Deploy**. Every future `git push` then auto-deploys.

## Using sync

- Click **☁ Sign in to sync** in the header → enter your email → click the magic link in your inbox.
- The button shows **☁ Synced** when your board is safe in the cloud.
- Sign in with the same email on any other device (phone, laptop, work PC) and your board appears — changes update live across open tabs/devices.

Conflict rule: last write wins for the whole board; a brand-new empty device never overwrites your cloud board.

## Keyboard shortcuts

- `N` — new card in the first lane's Ice Box
- `Esc` — close any drawer/modal
