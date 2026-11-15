# M365 Radar — InnovaticT

One live dashboard for Microsoft 365: service health, Message Center, Roadmap, official blogs, events, **plus freelance and job leads for M365 work**. It refreshes itself every 15 minutes, 24/7, and works on phone and laptop. It's free to run (GitHub Actions + GitHub Pages, no server).

## Setup (about 2 minutes, Mac Terminal)

```bash
brew install gh && gh auth login      # once, if you don't already have the GitHub CLI
cd m365-radar
chmod +x setup.sh && ./setup.sh       # creates the repo, enables Pages, runs the first pull
```

Open `https://<your-github-username>.github.io/m365-radar/`. On your phone: **Share → Add to Home Screen** and it opens like an app.

## What it pulls

| Area | Sources |
|---|---|
| Service health | Azure status feed (live incidents) · your tenant's health via Microsoft Graph (optional) · links to status.cloud.microsoft and @MSFT365Status |
| Message Center | mc.merill.net public mirror · your own tenant's Message Center via Graph (optional) |
| Roadmap | Microsoft 365 Roadmap RSS (items changed in the last 30 days, Dynamics filtered out) |
| Blogs / news | Microsoft 365 Blog, Tech Community (all, M365, SharePoint, Teams, Exchange, OneDrive, Intune, Entra), M365 Developer Blog, Power Platform Blog |
| Events | Event, webinar, AMA and conference posts found in those blogs, plus links to the event hubs |
| Leads | Freelancer.com projects · Reddit (r/forhire, r/freelance_forhire, r/sysadminjobs, r/Office365, r/sharepoint, r/PowerApps, r/msp…) · Hacker News hiring threads · Remotive · RemoteOK · We Work Remotely |

Leads are scored. A post has to be about Microsoft 365 (SharePoint, Intune, Power Platform, Exchange Online, migration…) **and** show buying intent (hiring, need, budget, contract, trainer). Posts from people offering their own services (`[For Hire]`) are dropped. Every lead has a **Copy pitch** button with your intro ready to paste.

## Optional add-ons (GitHub repo → Settings → Secrets → Actions)

**Reddit leads (recommended).** Reddit blocks anonymous requests from cloud servers, so it needs a free app key:
1. Go to https://www.reddit.com/prefs/apps → **create another app** → type **script**, redirect URI `http://localhost`.
2. Add the secrets `REDDIT_CLIENT_ID` (the string under the app name) and `REDDIT_CLIENT_SECRET`.

**Your tenant's live health + Message Center.**
1. Entra admin center → App registrations → New → add the Microsoft Graph *application* permissions `ServiceHealth.Read.All` and `ServiceMessage.Read.All` → Grant admin consent → create a client secret.
2. Add the secrets `M365_TENANT_ID`, `M365_CLIENT_ID` and `M365_CLIENT_SECRET`.

## What isn't automated, and why

- **X/Twitter.** The X API costs $200+/month, so the dashboard links to @MSFT365Status, @Microsoft365 and a live X search instead.
- **LinkedIn and Upwork.** They have no open feed (Upwork shut down its RSS in 2024), so there are one-tap saved searches in the Leads rail.
- **Product Hunt.** It lists product launches, not hiring posts, so it isn't a useful lead source.

## Customise

- To add or remove sources, edit the `SOURCES` list in `scripts/ingest.mjs`. Any RSS or Atom feed works as `type: 'rss'`.
- Lead keywords are in `SKILL`, `INTENT` and `OFFERING` in the same file.
- The pitch text is `PITCH` in `public/index.html`.
- To refresh instantly, go to the Actions tab → **M365 Radar** → **Run workflow**.
- To test locally: `node scripts/ingest.mjs && npx serve public`.
