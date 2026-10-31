import { ApiError, Content, FunctionCall, GoogleGenAI, Part, Type } from "@google/genai";
import { AnalysisError } from "@/lib/errors";
import { fetchProfileData, githubHeaders } from "@/lib/github";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const MAX_STEPS = 10;
const STEP_TIMEOUT_MS = 30_000;
const MIN_REQUEST_INTERVAL_MS = 12_000;
const PLAIN_TEXT_RULES =
  "Write your final answer as plain text only. Do not use Markdown or any rich text formatting: " +
  "no headings (#), bold or italics (* or _), backticks, code blocks, tables or links. " +
  "Use short paragraphs, and plain hyphens at the start of a line for lists.";
const REPO_INSTRUCTION =
  `${PLAIN_TEXT_RULES} Start by calling list_repo_files to see the project layout instead of guessing file paths.`;
const PROFILE_INSTRUCTION =
  `${PLAIN_TEXT_RULES} You are analysing a GitHub user from public data. ` +
  "You are given their profile data up front. Use tools only to look closer at at most 3 of their most " +
  "telling repos (call list_repo_files, then fetch_file for a README or key source file), because each step is expensive. " +
  "Base every claim on evidence in the data, and judge their public work, not their personal traits. " +
  "Say clearly when data is missing or private contributions are hidden. " +
  "Cover, in short paragraphs: what kind of developer they are, main languages and stack, activity and consistency (from contribution totals and repo push dates), " +
  "solo vs collaborative work (pull requests and reviews show collaboration), quality signals such as tests, CI and documentation, " +
  "strengths, and what the public data cannot tell us.";
const MAX_FILE_CHARS = 20_000;
const MAX_LISTED_FILES = 300;
const IGNORED_PATH = /(^|\/)(node_modules|dist|build|\.next|vendor|\.git)\/|(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(png|jpe?g|gif|svg|ico|woff2?|ttf|mp4|pdf|zip|lock)$/i;

let client: GoogleGenAI | null = null;

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new AnalysisError("GEMINI_API_KEY is not set");
  }
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      timeout: STEP_TIMEOUT_MS,
      retryOptions: { attempts: 2, httpStatusCodes: [500, 502, 503, 504] },
    },
  });
  return client;
}

let nextRequestAt = 0;

async function waitForRequestSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + MIN_REQUEST_INTERVAL_MS
  if (slot > now) await new Promise(resolve => setTimeout(resolve, slot - now))
}

function retryDelaySeconds(err: ApiError): number | null {
  const retry = err.message.match(/retry in ([\d.]+)s/i)?.[1];
  return retry ? Math.ceil(Number(retry)) : null;
}

function toAnalysisError(err: unknown, step: number): AnalysisError {
  if (err instanceof AnalysisError) return err;
  const at = `(step ${step + 1})`;

  if (err instanceof ApiError) {
    console.error(`Gemini API error ${at}:`, err.status, err.message);
    switch (err.status) {
      case 429: {
        const retry = retryDelaySeconds(err);
        const wait = retry ? ` Try again in ${retry}s.` : "";
        return new AnalysisError(`Gemini rate limit or quota exceeded ${at}.${wait}`, 429);
      }
      case 400:
        return new AnalysisError(`Gemini rejected the request ${at}: ${extractApiMessage(err)}`, 400);
      case 401:
      case 403:
        return new AnalysisError("Gemini API key is invalid or lacks access", 401);
      case 404:
        return new AnalysisError(`Gemini model "${MODEL}" not found`, 500);
      default:
        return new AnalysisError(`Gemini API error ${err.status} ${at}`, 502);
    }
  }

  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new AnalysisError(`Gemini took too long to respond ${at}`, 504);
  }

  console.error(`Unexpected error ${at}:`, err);
  return new AnalysisError(
    `Analysis failed ${at}: ${err instanceof Error ? err.message : String(err)}`,
  );
}

function extractApiMessage(err: ApiError): string {
  try {
    return JSON.parse(err.message).error?.message ?? err.message;
  } catch {
    return err.message;
  }
}

async function runTool(call: FunctionCall): Promise<Part> {
  const { name, args } = call;
  let response: Record<string, unknown>;

  try {
    if (name === "fetch_file") {
      const res = await fetch(
        `https://api.github.com/repos/${args?.owner}/${args?.repo}/contents/${args?.path}`,
        { headers: githubHeaders("application/vnd.github.v3.raw"), signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) {
        response = { error: `GitHub returned ${res.status} for ${args?.path}` };
      } else {
        const text = await res.text();
        response = text.length > MAX_FILE_CHARS
          ? { content: text.slice(0, MAX_FILE_CHARS), truncated: true }
          : { content: text };
      }
    } else if (name === "list_repo_files") {
      const res = await fetch(
        `https://api.github.com/repos/${args?.owner}/${args?.repo}/git/trees/HEAD?recursive=1`,
        { headers: githubHeaders(), signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) {
        response = { error: `GitHub returned ${res.status} listing ${args?.owner}/${args?.repo}` };
      } else {
        const tree: { path: string; type: string }[] = (await res.json()).tree ?? [];
        const files = tree
          .filter(f => f.type === "blob" && !IGNORED_PATH.test(f.path))
          .map(f => f.path);
        response = files.length > MAX_LISTED_FILES
          ? { files: files.slice(0, MAX_LISTED_FILES), truncated: true, total: files.length }
          : { files };
      }
    } else {
      response = { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    response = { error: `${name} failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { functionResponse: { id: call.id, name, response } };
}

const repoParams = {
  type: Type.OBJECT,
  properties: {
    owner: { type: Type.STRING },
    repo: { type: Type.STRING },
  },
  required: ["owner", "repo"],
};

const tools = [{
  functionDeclarations: [
    {
      name: "list_repo_files",
      description: "List the file paths in a GitHub repository (lockfiles, binaries and build folders are left out)",
      parameters: repoParams,
    },
    {
      name: "fetch_file",
      description: "Fetch a file from a GitHub repository",
      parameters: {
        ...repoParams,
        properties: { ...repoParams.properties, path: { type: Type.STRING } },
        required: ["owner", "repo", "path"],
      },
    },
  ],
}];

export function analyseRepo(repo: string): Promise<string> {
  return runAgent(`Analyse this repo: ${repo}`, REPO_INSTRUCTION);
}

export async function analyseProfile(user: string): Promise<string> {
  const data = await fetchProfileData(user);
  return runAgent(
    `Analyse the GitHub user "${user}" using this data:\n\n${data}`,
    PROFILE_INSTRUCTION,
  );
}

async function runAgent(prompt: string, systemInstruction: string): Promise<string> {
  const messages: Content[] = [{
    role: "user",
    parts: [{ text: prompt }]
  }]

  for (let step = 0; step < MAX_STEPS; step++) {
    let response;
    for (let attempt = 0; ; attempt++) {
      await waitForRequestSlot();
      try {
        response = await getClient().models.generateContent({
          model: MODEL,
          contents: messages,
          config: { tools, systemInstruction },
          
        });
        break;
      } catch (err) {
        const retry = err instanceof ApiError && err.status === 429 ? retryDelaySeconds(err) : null;
        if (attempt === 0 && retry !== null && retry <= 60) {
          nextRequestAt = Math.max(nextRequestAt, Date.now() + retry * 1000);
          continue;
        }
        throw toAnalysisError(err, step);
      }
    }

    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      const reason = response.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no response";
      throw new AnalysisError(`Gemini returned no content (${reason}) at step ${step + 1}`, 502);
    } 
    messages.push(candidate.content);

    const calls = candidate.content.parts?.flatMap(p => p.functionCall ? [p.functionCall] : []) ?? [];

    if (calls.length > 0) {
      const results = await Promise.all(calls.map(runTool));
      messages.push({ role: "user", parts: results });
    }
    else {
      const finalAnswer = response.text;
      if (!finalAnswer) {
        throw new AnalysisError(`Gemini finished without an answer (${candidate.finishReason ?? "unknown reason"})`, 502);
      }
      return finalAnswer;
    }
  }

  throw new AnalysisError(`Analysis didn't finish within ${MAX_STEPS} steps`, 504);
}
