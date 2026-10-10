# Rangrasiya Pass Control

## Deploy a shared instance on Cloudflare's free tier

This setup uses Cloudflare Pages for the app/API and Cloudflare D1 for shared storage. The app is intentionally public: anyone who obtains its URL can read and change all stored records, including student phone numbers and payment information. Share the URL only with trusted people.

Cloudflare's free tier has usage limits, including 100,000 Pages Function requests per day and D1 limits of 5 million rows read and 100,000 rows written per day, plus 5 GB of total D1 storage. Limits can change; check the [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) pages.

### Deploy with Wrangler

Install and authenticate Wrangler with a Cloudflare account that has permission to create Pages projects and D1 databases:

```sh
npx wrangler login
```

Create the D1 database and add its `PASSFLOW_DB` binding to `wrangler.toml`:

```sh
npx wrangler d1 create passflow-state --binding PASSFLOW_DB --update-config
```

Apply the checked-in schema migration to the remote database, create the Pages project, and deploy:

```sh
npx wrangler d1 migrations apply passflow-state --remote
npx wrangler pages project create rangrasiya-pass-control --production-branch main
npm run build
npm run deploy
```

The `*.pages.dev` URL printed by Wrangler is the shareable link; it works on phones, tablets, and computers, and records are stored in D1 for access across devices. If the Pages project already exists, skip the project-creation command.

For a Git-connected Cloudflare **Workers Builds** project, set the build command to `npm run build` and the deploy command to `npm run deploy`. Do not use `npx wrangler deploy`; that targets Workers and fails for this Pages project. If using the Cloudflare Pages Git integration instead, set the build command to `npm run build`, the build output directory to `dist`, and leave the deploy command to the Pages integration.

If you want direct WhatsApp Business PDF delivery, configure these Pages secrets/variables before deploying:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_VERSION` (optional; defaults to `v23.0`)

To move existing browser data into the shared app, open the current app on the device that has the records, choose **Export backup**, then open the deployed URL on that device and choose **Import backup**. Import replaces the current shared dataset; other devices can then open the same URL to use it.

Screenshot OCR currently requires a separate AI service and is not included in this free setup. Excel imports and manual student entry remain available.

Wrangler uses the `wrangler.toml` Pages configuration and the SQL files in `migrations/`. The Cloudflare account authorization step is required; deployment cannot be completed without access to an authorized Cloudflare account.

### Local development

Run `npm install` and `npm run dev`. Local development uses browser storage; shared D1 storage is used by the deployed app.
