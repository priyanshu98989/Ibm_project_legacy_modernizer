# Legacy Code Modernizer

> AI-powered modernization plan generator for legacy codebases — built for a 48-hour hackathon.

![Dashboard](https://placehold.co/900x500/030712/94a3b8?text=Legacy+Code+Modernizer+Dashboard)

---

## What it does

1. **Try a demo instantly** — click "Try a Demo" on the landing screen — no upload needed.
2. **Upload a codebase** — zip file or public GitHub URL.
3. **Dependency map** — heuristic import/CALL/COPY graph, visualised with React Flow.
4. **Risk scoring** — static analysis flags: legacy collections (Vector/Hashtable), raw types, unchecked casts, missing try-with-resources, deprecated APIs, security anti-patterns, COBOL GO TO / ALTER / NEXT SENTENCE, display numerics without COMP, and more.
5. **AI suggestions** — Bob generates natural-language modernization advice and before/after code diffs.
6. **Report** — dashboard view + one-click Markdown or PDF export.

Supported languages: **Java** (`.java`), **COBOL** (`.cbl` / `.cob` / `.cobol`), **JavaScript** (`.js` / `.jsx`), **TypeScript** (`.ts` / `.tsx`), **Python** (`.py`).

---

## Quick start

### Prerequisites

- Node.js 18+
- A running IBM Bob instance (or any OpenAI-compatible API)
- `git` on your PATH (for GitHub URL cloning)

### 1 — Install

```bash
cd legacy-modernizer
npm run install:all
```

### 2 — Configure the server

```bash
cp server/.env.example server/.env
# Edit server/.env and set BOB_API_URL + BOB_API_KEY
```

Key env vars:

| Variable            | Default                              | Description                                              |
|---------------------|--------------------------------------|----------------------------------------------------------|
| `BOB_API_URL`       | `http://localhost:11434/api/chat`    | Bob (or Ollama) chat completions endpoint                |
| `BOB_API_KEY`       | _(blank)_                            | Bearer token if your Bob instance requires one           |
| `BOB_MODEL`         | `granite3.3`                         | Model name to request                                    |
| `MAX_BOB_SUGGESTIONS` | `5`                               | How many risky files get AI suggestions (keep low for speed) |
| `PORT`              | `3001`                               | Express server port                                      |
| `MAX_UPLOAD_BYTES`  | `52428800` (50 MB)                   | Max ZIP upload size                                      |

### 3 — Run in development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3001

---

## Project structure

```
legacy-modernizer/
├── client/                     # React + Vite + Tailwind frontend
│   └── src/
│       ├── App.jsx             # Root view-state router
│       ├── api.js              # Axios API helpers
│       ├── hooks/
│       │   └── useAnalysis.js  # Upload → analyze → poll state machine
│       └── components/
│           ├── UploadPanel.jsx        # Landing / upload screen
│           ├── AnalyzingScreen.jsx    # Progress screen
│           ├── ReportDashboard.jsx    # Main report view
│           ├── DependencyGraph.jsx    # React Flow graph
│           ├── HealthScoreGauge.jsx   # SVG arc gauge
│           └── RiskList.jsx           # Risky files list + AI suggestions
└── server/                     # Node.js / Express backend
    └── src/
        ├── index.js            # Entry point
        ├── store/
        │   └── jobs.js         # In-memory job store
        ├── parsers/
        │   ├── index.js        # Language registry (add new languages here)
        │   ├── java.js         # Heuristic Java parser
        │   └── cobol.js        # Heuristic COBOL parser
        ├── services/
        │   ├── fileScanner.js      # Recursive directory walker
        │   ├── dependencyMapper.js # Graph builder
        │   ├── riskScorer.js       # Static risk scoring
        │   ├── bobClient.js        # Bob AI API wrapper
        │   └── reportCompiler.js   # Report assembly + health score
        └── routes/
            ├── upload.js           # POST /api/upload
            ├── analyze.js          # POST /api/analyze/:jobId
            └── report.js           # GET  /api/report/:jobId[/markdown]
```

---

## API reference

| Method | Path                            | Description                                  |
|--------|---------------------------------|----------------------------------------------|
| POST   | `/api/upload`                   | Upload ZIP or submit `{ repoUrl }`           |
| POST   | `/api/analyze/:jobId`           | Start analysis pipeline                      |
| GET    | `/api/analyze/:jobId/status`    | Poll status: `pending\|analyzing\|done\|error` |
| GET    | `/api/report/:jobId`            | Fetch completed report JSON                  |
| GET    | `/api/report/:jobId/markdown`   | Download Markdown export                     |
| GET    | `/api/demo`                     | List available demo fixtures                 |
| GET    | `/api/demo/:name`               | Load a fixture instantly (returns `{ jobId }`) |
| GET    | `/api/health`                   | Server health check                          |

---

## Language support matrix

| Language   | Extensions              | Key risks detected |
|------------|-------------------------|--------------------|
| Java       | `.java`                 | Vector/Hashtable/Stack, raw types, unchecked casts, missing try-with-resources, @Deprecated, anti-patterns, nesting |
| COBOL      | `.cbl` `.cob` `.cobol`  | GO TO, ALTER, NEXT SENTENCE, EXEC SQL, hardcoded paths, PIC without COMP |
| JavaScript | `.js` `.jsx` `.mjs`     | eval(), secrets, callback hell, var usage, console.log, nesting |
| TypeScript | `.ts` `.tsx`            | `any` types, `as any`, @ts-ignore, non-null assertions, missing return types |
| Python     | `.py` `.pyw`            | bare `except:`, print(), eval/exec, mutable defaults, missing type hints |

---

## Adding a new language

1. Create `server/src/parsers/<lang>.js` — must export `extractDependencies(file)`.
2. Add the extension mapping in `server/src/parsers/index.js`.
3. Add scoring logic in `server/src/services/riskScorer.js`.

---

## Design decisions & trade-offs

- **Heuristic parsing** — regex-based, not a full AST. Fast and dependency-free; misses some edge cases.
- **In-memory job store** — no DB. Restart the server and jobs are gone. Fine for demo; replace with Redis for production.
- **Client-side PDF** — uses `jspdf` + `html2canvas`; avoids server-side headless browser. Quality is limited for very tall reports.
- **Top-5 Bob suggestions** — calling Bob for every file in a large repo would be very slow. Configurable via `MAX_BOB_SUGGESTIONS`.

---

## License

MIT — free to use, extend, and present at the hackathon.
