import { NextRequest, NextResponse } from "next/server";
import { parseGithubUrl } from "@/lib/github";
import { AnalysisError } from "@/lib/errors";
import { analyseProfile, analyseRepo } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  const { url } = await request.json().catch(() => ({}));

  const target = typeof url === "string" ? parseGithubUrl(url) : null;
  if (!target) {
    return NextResponse.json(
      { error: "Enter a valid GitHub repo or profile URL" },
      { status: 400 },
    );
  }

  try {
    const result =
      target.kind === "repo"
        ? await analyseRepo(target.repo)
        : await analyseProfile(target.user);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof AnalysisError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Unexpected analysis error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
