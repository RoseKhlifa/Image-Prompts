# Cloudflare R2 setup for Image-Prompts

Image-Prompts uses Cloudflare R2 to store uploaded prompt images. M4 expects
a single bucket and one row in the `r2_accounts` table.

## 1. Bucket

- Cloudflare dashboard → R2 → Create bucket.
- Name: `image-prompts-dev` (or whatever; remember it).
- Location: closest to you.
- Public access: **Enable** (we publish prompt images as public URLs).

## 2. API token

- R2 → Manage R2 API tokens → Create token.
- Permission: **Object Read & Write**, scoped to your bucket.
- Save the **Access Key ID** and **Secret Access Key** (you only see secret once).
- Endpoint URL is shown on the same page (looks like `https://<account-id>.r2.cloudflarestorage.com`).

## 3. Public URL

- Bucket → Settings → Public Development URL → enable.
- Copy the `https://pub-XXXXXXXX.r2.dev` URL.

## 4. CORS

Bucket → Settings → CORS Policy. Paste:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://YOUR-PROD-DOMAIN"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

## 5. Lifecycle rule

Bucket → Settings → Object lifecycle rules → Add rule.

- Name: `expire submissions`
- Prefix: `submissions/`
- Action: Delete after 7 days

This cleans up abandoned uploads (user closed the tab before submit) and
images from rejected submissions (best-effort delete may fail).

## 6. Encryption key

```bash
openssl rand -hex 32
```

Put the 64-char hex output in `.env` as `R2_ENCRYPTION_KEY`. Never commit it.

## 7. Bootstrap the database row

After filling all `R2_DEV_*` env vars and running migrations:

```bash
pnpm --filter @ip/api seed:r2
```

This inserts a single `r2_accounts` row with the encrypted secret.

## 8. Verify

Restart the API. Submit a test image at `/zh/submit`. The presign endpoint
should return a URL that the browser successfully `PUT`s to.
