import AnalyserForm from "@/components/AnalyserForm";

const steps = [
  "You paste the URL of a public GitHub repo or a GitHub profile.",
  "An AI agent powered by Google Gemini decides which files to read, such as the README, package files and source code.",
  "It fetches those files from the GitHub API, reads them, and asks for more until it understands the project.",
  "For a repo, it writes a plain-text analysis of what the project does and how it's built. For a profile, it reads their bio, README, repos and contributions and describes what kind of developer they are.",
];

const socials = [
  { label: "GitHub", href: "https://github.com/yaisnw" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/yasinwafazada/" },
  { label: "Portfolio", href: "https://yasinwafazada.vercel.app/" },
];

// Server Component: prerendered as static HTML. Only AnalyserForm hydrates on the client.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">GitHub Analyser</h1>
        <p className="text-sm text-muted">
          Paste a GitHub repo or profile URL to get an analysis.
        </p>
      </header>

      <AnalyserForm />

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Good to know</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            An analysis can take a minute or two. The agent makes several
            requests to Gemini, spaced out to stay within the free tier&apos;s
            rate limits.
          </li>
          <li>Only public repositories can be analysed.</li>
          <li>
            Very large repos may only be partly explored, since the agent reads
            a limited number of files per analysis.
          </li>
        </ul>
      </section>

      <footer className="flex flex-col gap-4 border-t border-border pt-6">
        <p className="text-xs text-muted">
          Built with Next.js, Tailwind CSS, Google Gemini and the GitHub API.
        </p>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {socials.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline decoration-border underline-offset-4 transition-colors hover:decoration-primary"
            >
              {label}
            </a>
          ))}
        </nav>
      </footer>
    </main>
  );
}
