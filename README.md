# GitHub Analyser
[Live Demo](https://github-analyser-vert.vercel.app/)
An AI agent that reads a GitHub repository and writes a plain-text analysis of it. Paste a repo URL and the agent, powered by Google Gemini, decides which files to read, fetches them from the GitHub API, and keeps going until it has enough context to explain what the project is, how it's built, and anything notable about it.

## How it works

1. You submit a repo URL, e.g. `https://github.com/vercel/next.js`.
2. The `/api/analyse` route validates the URL and starts the agent.
3. The agent runs a tool-calling loop with Gemini:
   - Gemini is given a `fetch_file` tool that reads any file from a public GitHub repo.
   - Each step, Gemini either asks for more files or writes its final answer.
   - Requested files are fetched in parallel and sent back to Gemini.
4. The loop ends when Gemini answers, or after 10 steps.
5. The analysis is returned as plain text and shown on the page.

### Built to run on the free tier

- **Request spacing:** Gemini calls are spaced at least 12 seconds apart to stay under the free tier's 5 requests per minute. An analysis can take a minute or two as a result.
- **Clear errors:** rate limits, invalid keys, missing models, timeouts and blocked responses each return a specific message saying which step failed.
- **Tool failures don't stop the analysis:** a missing file or GitHub error goes back to the model as an error it can work around.
- **Large files are trimmed** to 20,000 characters so they don't slow down every later step.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) with TypeScript
- [Tailwind CSS v4](https://tailwindcss.com), with colours defined as theme tokens in `app/globals.css`
- [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai) for Gemini
- GitHub REST API

## Getting started

### Requirements

- Node.js 20 or later
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) (free)
- Optional: a GitHub personal access token (free)

### Setup

```bash
git clone https://github.com/yaisnw/github-analyser.git
cd github-analyser
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Your Gemini API key. |
| `GEMINI_MODEL` | No | The Gemini model to use. Defaults to `gemini-flash-lite-latest`. |
| `GITHUB_TOKEN` | No | Raises GitHub's API limit from 60 to 5,000 requests per hour. A fine-grained token with read-only access to public repositories is enough. |

Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
app/
  page.tsx              Static landing page
  layout.tsx            Root layout
  globals.css           Tailwind setup and colour tokens
  api/analyse/route.ts  POST endpoint that runs an analysis
components/
  AnalyserForm.tsx      URL input, loading state and result (client component)
lib/
  gemini.ts             Gemini client, agent loop, tools and error handling
  github.ts             Repo URL parsing and GitHub request headers
```

## Limitations

- On the free tier, Gemini also has a daily request limit per model. Each analysis uses up to 10 requests, so you may only get a few analyses a day. Enabling billing on your key removes this.
- Only public repositories can be analysed.
- Very large repos may not be fully explored within 10 steps.

## Connect with me

- GitHub: [@yaisnw](https://github.com/yaisnw)
- LinkedIn: [linkedin.com/in/yasinwafazada](https://www.linkedin.com/in/yasinwafazada/)
- Portfolio: [yasinwafazada.vercel.app](https://yasinwafazada.vercel.app/)
