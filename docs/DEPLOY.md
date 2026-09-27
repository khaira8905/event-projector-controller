# Put EventControl online (free): Render + Supabase

You end up with a permanent link like `https://eventcontrol-xxxx.onrender.com` that anyone can
open, from any device, whether or not your laptop is on. Takes about 20 minutes, once.
No credit card needed.

- **Supabase** keeps the events (database) and the uploaded files (storage).
- **Render** runs the website from this GitHub repository and gives you the link.

---

## Part A — Supabase

1. Go to **https://supabase.com** → *Start your project* → sign in with **GitHub**.
2. **New project**
   - Name: `eventcontrol`
   - Database password: **letters and numbers only** (no `@ # / ? :`). **Write it down.**
   - Region: the one nearest to you (e.g. *South Asia (Mumbai)* or *Southeast Asia (Singapore)*).
   - *Create new project*, wait ~2 minutes.
3. **Storage → New bucket** → name `eventcontrol` → **Public bucket: off** → *Create*.
4. **Connect** (button at the top) → choose **Session pooler** → copy the address:
   `postgresql://postgres.abcd…:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   Replace `[YOUR-PASSWORD]` **including the brackets** with your password from step 2.
   → this is your **DATABASE_URL**. (Not the "Direct connection" — Render can't reach that one.)
5. **Project Settings** (gear) → **Data API** → copy the **Project URL** (`https://abcd.supabase.co`)
   → this is your **SUPABASE_URL**.
6. **Project Settings → API Keys** → copy the **service_role** key (tab *Legacy API Keys*, click
   *Reveal*) — or, if you only see new keys, a **Secret key** (`sb_secret_…`). Both work.
   → this is your **SUPABASE_SERVICE_ROLE_KEY**. Keep it secret; it only ever goes into Render.

## Part B — Render

1. Go to **https://render.com** → *Get started* → sign up with **GitHub**. When GitHub asks which
   repositories Render may see, allow **event-projector-controller**.
2. **New +** → **Blueprint** → pick **event-projector-controller** (branch `main`).
   Render reads `render.yaml` and proposes a free web service called **eventcontrol**.
3. Fill in the three values from Part A:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | Session pooler address, with your password in it |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role (or secret) key |

   Leave `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` empty (Google Drive is optional, later).
4. **Apply**. The first build takes **~10 minutes** (it installs LibreOffice for PowerPoint files).
5. When the log shows **`EventControl is running`**, your link is at the top of the page:
   **`https://eventcontrol-xxxx.onrender.com`** — open it, and share it.

The site starts with a demo event; create your own events and upload your files there
(your laptop's events are not copied over).

---

## Part C — Accounts (logins)

EventControl signs people in with **Supabase Auth**. Each account has its own events, files,
Flow and settings; several people can run their own shows on the same server at the same time
without seeing or touching each other's. Only you (the administrator) create accounts.

1. **Stop strangers from signing up.** Supabase → **Authentication → Sign In / Providers** →
   **Email** → turn **off** *Allow new users to sign up* → *Save*. (Leave the Email provider itself on.)
2. **Create an account** for yourself and each person: **Authentication → Users → Add user →
   Create new user** → email + password → tick **Auto Confirm User** → *Create user*.
   Give each person their email and password.
3. **Copy the Publishable key:** **Project Settings → API Keys** → the **Publishable key**
   (`sb_publishable_…`) — or, on the *Legacy API Keys* tab, the **anon** key. (This key is meant
   to be public; it only allows signing in.)
4. **Render → eventcontrol → Environment → Add Environment Variable**:
   `SUPABASE_ANON_KEY` = that key → *Save changes*. Render restarts the service by itself.
5. Open your site: it now shows **Sign in**. Sign in with **your** account first — the first
   account to sign in takes over the events that already exist. (Or set `ADMIN_EMAIL` to your
   email in Render to pick that account explicitly.)

The projector link of each event (`…/display/<event id>`) still opens without signing in, so
it's easy to use on the venue computer; it only ever shows the audience picture.

**Signing in and out.** A sign-in lasts while the console is open: closing the tab (or the
browser) means signing in again next time; reloading the page doesn't. *Settings → Account &
sharing → Sign out* signs out every tab of that browser. However long the tab stays open, a
sign-in ends after 24 hours (change it with `SESSION_HOURS` in Render).

**Public demo.** The sign-in page also offers **Try the demo**, and
`https://<your-site>/demo` opens one straight away: the link to put on LinkedIn or GitHub.
Each visitor gets a temporary guest account with a private copy of the sample event for
**10 minutes** (`DEMO_MINUTES`). It can't see anyone else's events, has small limits (5 events,
25 files, 25 MB per upload, no Google Drive), and is deleted when time is up. When it ends, the
sign-in page offers **Request access**. Set `DEMO=off` in Render to turn the demo off.

**Request access.** People can ask for an account on the sign-in page: name, email and a
password they choose (it goes straight to Supabase, and nobody can see it, you included). With
email set up (Part D) they confirm the email with a 6-digit code. You get an email, and the
**People** button (Events page, or Settings → Account & sharing) lists the request:
**Approve** unlocks their login and emails them; **Decline** deletes it. At most 5 new
requests an hour (`ACCESS_REQUESTS_PER_HOUR`); `ACCESS_REQUESTS=off` hides the option. You're
the administrator because you signed in first (or set `ADMIN_EMAIL`).

**Forgot password.** With email set up (Part D), the sign-in page offers **Forgot your
password?**: a 6-digit code goes to the account's email, and they choose a new password
(it goes straight to Supabase). It works for anyone who has signed in at least once; for an
account that never has, reset the password in Supabase → Authentication → Users.

**Removing someone:** **People → Remove** (or delete their user in Supabase → Authentication → Users). They can't sign
in again, and if they're signed in right now they're signed out within about 2 minutes (the
server checks with Supabase using `SUPABASE_SERVICE_ROLE_KEY`). Their events stay in the
database; re-creating a user with the same email gives them back. To reset a password, open the
user there → *Send password recovery* or set a new password.

---

## Part D — Emails for Request access (optional, free)

Without this, Request access still works, but emails aren't checked and nobody gets notified:
open **People** now and then to see requests.

1. Create a free account at **https://www.brevo.com** (300 emails a day).
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: your email (e.g. your Gmail).
   Brevo emails you a link to confirm it.
3. **SMTP & API → API keys → Generate a new API key**. Copy it.
4. Render → eventcontrol → **Environment**: `BREVO_API_KEY` = that key, `EMAIL_FROM` = the
   sender email from step 2 → *Save changes*.

Emails sent from a Gmail address through Brevo can land in spam at first; the code screen
tells people to check there.

---

## Using it

- **Share the link.** Everyone signs in with their own account (Part C) and sees only their own events.
- **Projector:** on the projector computer, open the link → the event → **Open display** (or
  *Settings → Event & sharing → Projector link*). Press **F** in it for fullscreen.
- **Free plan sleeps** after ~15 minutes without visitors; the first visit then takes about a
  minute. **Open the link 5 minutes before the event.**
- **Supabase pauses** a free project after a week without use. The *Keep alive* workflow
  (GitHub → Actions) visits the site once a day so this doesn't happen. If it ever does,
  *Restore* the project in Supabase (nothing is lost).
- **Updates:** every push to GitHub `main` redeploys automatically.

## If something goes wrong

Open your service in Render → **Logs**. EventControl says what is wrong in plain words:

| Log says | Fix |
| --- | --- |
| `DATABASE_URL still contains [YOUR-PASSWORD]` | Render → *Environment* → edit `DATABASE_URL`, put your password in place of `[YOUR-PASSWORD]` (brackets too). |
| `DATABASE_URL is Supabase's "Direct connection"` | Use the **Session pooler** address instead (it contains `pooler.supabase.com`). |
| `DATABASE_URL is not a valid address` / `password authentication failed` | Reset the database password in Supabase (*Project Settings → Database*) to letters and numbers only, and update `DATABASE_URL`. |
| `Supabase upload failed (400/403)` | Check `SUPABASE_URL` and the key, and that the bucket is called `eventcontrol`. |
| Page shows *Service unavailable* for a minute | The free instance is waking up — wait and refresh. |

After changing an environment variable, Render restarts the service by itself.
