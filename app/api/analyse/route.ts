import { NextRequest, NextResponse } from "next/server";
import { fetchRepo, parseRepoUrl } from "@/lib/github";
import { AnalysisError, analyseRepo } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  const { url } = await request.json().catch(() => ({}));

  const repo = typeof url === "string" ? parseRepoUrl(url) : null;
  if (!repo) {
    return NextResponse.json(
      { error: "Enter a valid GitHub repo URL" },
      { status: 400 },
    );
  }

  try {
    const result = await analyseRepo(url);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof AnalysisError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Unexpected analysis error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
