"use client";

import { useState, type SubmitEvent } from "react";
import { SAMPLE_ANALYSIS, SAMPLE_URL } from "@/components/sampleAnalysis";

export default function AnalyserForm() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!url.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo or https://github.com/username"
          required
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-primary"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Analysing..." : "Analyse"}
        </button>
      </form>

      {loading && (
        <p role="status" className="text-sm text-muted">
          The agent is gathering data and writing your analysis. This can take a
          minute or two, so please wait and keep this page open.
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {result && (
        <div className="whitespace-pre-wrap rounded-md border border-border bg-surface p-4 text-sm">
          {result}
        </div>
      )}

      {!result && !loading && !error && (
        <section className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            Sample analysis for{" "}
            <button
              type="button"
              onClick={() => setUrl(SAMPLE_URL)}
              className="cursor-pointer text-primary underline decoration-border underline-offset-4 hover:decoration-primary"
            >
              {SAMPLE_URL}
            </button>{" "}
            (click to try it yourself)
          </p>
          <div className="whitespace-pre-wrap rounded-md border border-border bg-surface p-4 text-sm text-muted">
            {SAMPLE_ANALYSIS}
          </div>
        </section>
      )}
    </div>
  );
}
