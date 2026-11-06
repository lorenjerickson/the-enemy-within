# Deploying (Fly.io)

The app runs as one Docker container on Fly.io, with a volume at `/data` for the SQLite database and uploaded
media (`DATA_DIR`). Every push to `main` is checked and deployed by `.github/workflows/deploy.yml`.

## First time

1. Install `flyctl` and sign in: `fly auth login`.
2. Create the app without deploying (keep the `fly.toml` in the repo; change `app` if the name is taken):
   `fly launch --no-deploy --copy-config`
3. Create the volume (1 GB is plenty to start; media is ~200 MB): `fly volumes create tew_data --size 1 --region sea`
4. Optional settings: `fly secrets set APP_URL=https://<app>.fly.dev` (invite links), `SMTP_URL=…`, `MAIL_FROM=…`,
   `OPENAI_API_KEY=…` (image generation).
5. Make a deploy token and add it to GitHub (Settings › Secrets and variables › Actions) as `FLY_API_TOKEN`:
   `fly tokens create deploy`
6. Push to `main` (or run the Deploy workflow by hand).

## Moving the campaign over

1. Locally: Campaign › Overview › **Export campaign (.zip)**.
2. On the server: open the site, create the GM account (`/setup`), then Campaign › Overview › **Import** the zip
   (tick "Replace everything"). You're logged out; log in with your local GM account.

Session data (game nights and their log, pings, rolls, round plans, encounters) isn't exported.
