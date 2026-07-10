# UAEICP Employee Intelligence Workspace

Internal AI-powered document analysis platform for employees of the UAE Federal Authority for Identity, Citizenship, Customs & Port Security. Login-first, workspace-based: upload documents (or start from a typed brief), run structured evidence-first analysis, ask questions in a ChatGPT-style Q&A, and generate memos, checklists, case summaries, policy comparisons, legal/compliance review memos, revised drafts and PowerPoint briefing decks — in English or Arabic (full RTL).

> Internal productivity tool. AI output requires human verification and does not replace legal advice or supervisor approval.

## Quick start

```bash
npm install
cp .env.example .env    # edit values
npm start               # http://localhost:3000
```

First boot seeds an admin account from `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, defaults `admin` / `Admin@1234`). Change the password after first login. Admins create employee accounts from the Admin panel.

Works out of the box with **no AI keys** — a clearly-labeled offline demo provider responds so the full flow can be tested. Configure a real provider for production use.

## AI providers

Set any of these in `.env`; users pick the model per question/task from the top bar:

| Provider | Config | Notes |
|---|---|---|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | default `gpt-4o-mini` |
| Anthropic / Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | recommended for PPTX structure |
| Ollama (Qwen etc.) | `OLLAMA_URL`, `OLLAMA_MODEL` | local models, default `qwen2.5:7b` |

If a provider call fails, the system falls back to the demo responder and tells the user.

AI images in slide decks use the same `OPENAI_API_KEY`. Set optional `IMAGE_MODEL=gpt-image-1` to choose the image model; if omitted, the app defaults to `gpt-image-1` and falls back to `dall-e-3`.

For highest-caliber PowerPoint generation, configure all three: `ANTHROPIC_API_KEY` for deck narrative/content strategy, `OPENAI_API_KEY` for visual and image direction, and `MANUS_API_KEY` for final agentic research, design composition, visuals, and PPTX export. If one is missing, the app falls back to the configured providers.

Manus PowerPoint tasks attach the style reference PDF from `server/reference/deck-reference.pdf` when present, falling back to `server/assets/premium-deck-style-reference.pdf`. Rendered pages in `server/reference/pages/` are also shown to Claude for art direction. These references are used for design caliber only, not as source facts.

## AI modes

- **Guarded** — evidence-first: claims only from uploaded material, heavy citations `[doc: filename, near: "…"]`, HIGH/MEDIUM/LOW confidence labels, gaps stated explicitly.
- **Unguarded** — exploratory: may propose patterns/hypotheses/next steps, each labeled `[SPECULATIVE]`.

Both modes always include human-verification notes.

## Storage

- **Best for deployment:** set `DATABASE_URL` for PostgreSQL. Tables are auto-created from `server/db/schema.sql` on boot. PostgreSQL stores users, workspaces, uploaded files, extracted text, analyses, chat history, generated outputs, notes, and activity logs.
- **Local fallback:** if `DATABASE_URL` is empty, the app uses JSON persistence. By default this is `data/db.json`.
- **Important:** many hosts delete the app folder during redeploy. If you are not using PostgreSQL, set `PERSISTENT_DIR` to a mounted/persistent folder outside the app release directory, for example `/var/data/uaeicp`. The default JSON DB, uploads, and generated files will then live under that folder.
- Optional path overrides: `DATA_FILE`, `UPLOAD_DIR`, `GENERATED_DIR`.
- Uploaded files default to `PERSISTENT_DIR/uploads`; generated PPTX files default to `PERSISTENT_DIR/generated` when `PERSISTENT_DIR` is set. With PostgreSQL enabled, uploaded files and generated PPTX files are also saved in the database so downloads survive redeploys even if the app folder is replaced.

## File support

Text extraction: PDF (`pdf-parse`), DOCX (`mammoth`), XLSX/XLS (`xlsx`), TXT/MD/CSV/JSON. Images are accepted and stored; OCR is not configured (noted in analysis context).

## API overview

```
POST /api/auth/login                     → { token, user }
GET  /api/auth/me
POST /api/auth/change-password
GET  /api/providers
GET|POST /api/users                      (admin)
PATCH|DELETE /api/users/:id              (admin)
GET|POST /api/workspaces
GET|PATCH|DELETE /api/workspaces/:id
GET  /api/workspaces/:id/export          → markdown report
POST /api/workspaces/:id/notes
POST /api/workspaces/:wsId/files         (multipart "files", up to 20)
GET  /api/workspaces/:wsId/files/:id/download
POST /api/workspaces/:wsId/analysis      { provider?, model?, mode?, language? }
POST /api/workspaces/:wsId/chat          { question, provider? }   (Arabic question → Arabic answer)
POST /api/workspaces/:wsId/studio        { type, format?, instructions?, provider? }
GET  /api/workspaces/:wsId/studio/:id/download
```

Studio types: `pptx`, `memo`, `checklist`, `case_summary`, `policy_comparison`, `legal_review`, `revised_draft`, `report`. Formats: `md`, `txt`, `json`, `pptx`.

## Keeping data across redeploys (IMPORTANT)

All application data — users, chats, workspaces, messages, analyses, generated files, uploaded file contents, review notes and activity logs — persists in **PostgreSQL** when `DATABASE_URL` is set. Uploaded and generated files are stored **inside the database** (BYTEA), so redeploying the app folder never loses anyone's work.

1. Create a PostgreSQL database in the Hostinger panel (or any provider, e.g. Neon/Supabase free tier).
2. Set `DATABASE_URL=postgres://user:password@host:5432/dbname` (and `PGSSL=true` if the host requires SSL) in the server's environment.
3. Restart the app — tables are created/migrated automatically on boot (idempotent).
4. Redeploy freely: replace the entire app folder whenever you want; the database keeps everything.

Without `DATABASE_URL`, data lives in `data/db.json` + `data/uploads/` + `generated/` — fine locally, but on a host you must preserve those folders between deploys. Use PostgreSQL in production.

**Backup:** Admin → Users → "Download backup" exports a full JSON snapshot (all tables; binary file bytes excluded). You can also point pgAdmin/TablePlus/DBeaver at the same DATABASE_URL, or schedule `pg_dump`.

## Deployment (Hostinger / any Node host)

1. Node 18+ required (uses built-in `fetch`).
2. Upload the project, run `npm install --production`.
3. Set environment variables (`.env` or the panel's env settings): `PORT`, strong `JWT_SECRET`, `DATABASE_URL` for the host's PostgreSQL, admin credentials, provider keys.
4. To keep work after redeploy, use PostgreSQL with `DATABASE_URL`. If PostgreSQL is not available, set `PERSISTENT_DIR` to a persistent mounted folder outside the app directory and ensure it is writable.
5. Run `npm start` under a process manager (PM2: `pm2 start server/index.js --name uaeicp`).
6. Put HTTPS in front (host's proxy or nginx). The app is a single Express server serving both API and frontend on one port.

## Project structure

```
server/
  index.js            Express app, seeding, SPA fallback
  config.js           env config
  db/schema.sql       PostgreSQL schema
  storage/            json-store.js | pg-store.js (same interface)
  middleware/auth.js  JWT + role + workspace ownership guards
  routes/             auth, users, workspaces, files, analysis, chat, studio
  services/           prompts.js, ai/ (provider router), extract.js, pptx.js
public/               SPA (index.html, styles.css, app.js, i18n.js)
```
