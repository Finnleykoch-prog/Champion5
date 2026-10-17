# Daily 5

A daily head-to-head naming game. Five categories, 15 seconds each, one ranked match a day.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The page layout |
| `styles.css` | Colors, fonts and layout |
| `app.js` | The game: rounds, screens, sharing, owner stats |
| `categories.js` | Every category and its accepted answers |
| `config.js` | Your Supabase connection (two values to paste in) |
| `supabase/setup.sql` | Creates the database, rules and server logic. Run once in Supabase |

## Setup (about 30 minutes)

### 1. Supabase: the database and sign-in
1. Go to supabase.com → **New project**. Name it `daily5`, set a database password (save it somewhere), pick the region closest to your players (e.g. East US), and click **Create**.
2. When it's ready, open **SQL Editor** → **New query**. Paste the whole of `supabase/setup.sql` and click **Run**. You should see "Success. No rows returned."
3. Open **Authentication** → **Sign In / Providers** → **Email** and turn **off** "Confirm email", then save. (Supabase's free email sender only sends a few emails per hour, so confirmation emails would block friends from signing up.)
4. Open **Project Settings** → **API** (or **API Keys**). Copy the **Project URL** and the **anon public** key. If you only see a "publishable" key, open the **Legacy API keys** tab and copy the `anon` key there.

### 2. Put your keys in `config.js`
Replace the two `PASTE_...` values with your Project URL and anon key. The anon key is meant to be public; the rules in `setup.sql` control what anyone can read or change.

### 3. GitHub: store the code
1. On github.com click **+** → **New repository**. Name it `daily5`, leave it **Public** or **Private**, and click **Create repository**.
2. On the next page click **uploading an existing file**. Drag in everything from this folder (including the `supabase` folder) and click **Commit changes**.

### 4. Vercel: put it online
1. On vercel.com click **Add New…** → **Project**, find `daily5` and click **Import**.
2. Leave every setting as it is and click **Deploy**. In under a minute you get a link like `daily5-xyz.vercel.app`.

### 5. Make yourself the owner
Sign up on your new site, then in Supabase → SQL Editor run (with your username):
```sql
update public.profiles set is_admin = true where username = 'your_username';
```
Reload the site and the **Owner stats** button appears on your home screen.

## Updating the site
Edit a file on GitHub (open it and click the pencil icon), or upload a new version of it. Vercel puts the change live within a minute.

## Adding categories or answers
Open `categories.js`. Answers are saved by their position in a list, so **only add new answers to the end of a list, and new categories to the end of the file.** Never reorder or delete, or the answer stats for past days get mixed up.

## Game rules, for reference
- **Daily reset:** midnight US Eastern. Change `America/New_York` in both `supabase/setup.sql` (`game_day`) and `app.js` (`GAME_TZ`) to move it.
- **Rating:** Elo with the point margin scaling the change (0.6× at 1 point, up to 1.4× at 12+). K is 60, 54, 48, 42, 36 for a player's first 5 days, then 30.
- **Matchmaking:** the most recent finished run today within 150 rating points, then 300, then anyone. The first player of the day faces a simulated opponent.
- **Forfeits:** reloading or closing mid-match, or taking more than 20 minutes, counts as a loss by 12.
- **Fairness:** the daily lock, matchmaking, scoring totals and ratings are all decided on the server. The browser still decides which typed words count as answers, so a technical player could cheat by editing the page. Moving answer checking to the server is the next step if that ever matters.
