"use client";

import { FormEvent, useState } from "react";

type SearchType = "neural" | "keyword";

type SearchResult = {
  id: string;
  title: string | null;
  url: string;
  highlights?: string[];
};

const EXAMPLES = [
  {
    indication: "IPF",
    criteria: "adults 50-75, non-smokers",
    label: "IPF · adults 50-75, non-smokers",
  },
  {
    indication: "Long COVID",
    criteria: "adults 18-65",
    label: "Long COVID · adults 18-65",
  },
  {
    indication: "Parkinson's",
    criteria: "adults 40-80, early stage",
    label: "Parkinson's · adults 40-80, early stage",
  },
] as const;

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedSnippet({
  text,
  phrase,
}: {
  text: string;
  phrase: string;
}) {
  const trimmed = phrase.trim();
  if (!trimmed) return <>{text}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(trimmed)})`, "gi"));

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === trimmed.toLowerCase() ? (
          <mark key={index} className="bg-blue-100 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

type ResultsCache = Partial<
  Record<SearchType, { results: SearchResult[]; responseTimeMs: number }>
>;

export default function Home() {
  const [indication, setIndication] = useState("");
  const [criteria, setCriteria] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activePhrase, setActivePhrase] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("neural");
  const [lastQuery, setLastQuery] = useState("");
  const [resultsCache, setResultsCache] = useState<ResultsCache>({});
  const [responseTimeMs, setResponseTimeMs] = useState<number | null>(null);

  async function handleSearch(
    query: string,
    type: SearchType,
    phrase = indication.trim(),
    cache: ResultsCache = {},
  ) {
    const cached = cache[type];
    if (cached) {
      setResults(cached.results);
      setResponseTimeMs(cached.responseTimeMs);
      setError(null);
      setActivePhrase(phrase);
      setLastQuery(query);
      setSearchType(type);
      setResultsCache(cache);
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setResponseTimeMs(null);

    const started = performance.now();

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition: query, type }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Search failed");
      }

      const data = await res.json();
      const elapsed = Math.round(performance.now() - started);
      const nextResults = Array.isArray(data.results) ? data.results : [];
      setResults(nextResults);
      setResponseTimeMs(elapsed);
      setActivePhrase(phrase);
      setLastQuery(query);
      setSearchType(type);
      setResultsCache({
        ...cache,
        [type]: { results: nextResults, responseTimeMs: elapsed },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function buildQuery(ind: string, crit: string) {
    return `${ind.trim()} patients with the following criteria: ${crit.trim()}`;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSearch(buildQuery(indication, criteria), searchType);
  }

  function onExampleClick(example: (typeof EXAMPLES)[number]) {
    setIndication(example.indication);
    setCriteria(example.criteria);
    void handleSearch(
      buildQuery(example.indication, example.criteria),
      searchType,
      example.indication,
    );
  }

  function onSearchTypeChange(type: SearchType) {
    if (type === searchType || loading || !lastQuery) return;
    void handleSearch(lastQuery, type, activePhrase, resultsCache);
  }

  return (
    <div className="min-h-screen bg-marble text-gray-900">
      <main className="mx-auto max-w-2xl px-6 pt-24 pb-24">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Channel Finder
          </h1>
          <p className="mt-2 text-base italic text-zinc-600">
            Find patients for your clinical trial — in minutes, not months
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex w-full flex-col gap-1.5 sm:w-36">
              <span className="text-sm font-medium">Indication</span>
              <input
                type="text"
                name="indication"
                value={indication}
                onChange={(e) => setIndication(e.target.value)}
                placeholder="e.g. IPF"
                required
                disabled={loading}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-exablue disabled:opacity-60"
              />
            </label>

            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">
                Trial criteria (age, location, other filters)
              </span>
              <input
                type="text"
                name="criteria"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="e.g. adults 50–75, non-smokers"
                required
                disabled={loading}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-exablue disabled:opacity-60"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="flex h-10 items-center justify-center rounded-lg bg-exablue px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {loading ? (
              <span className="pulse-dot" aria-hidden="true" />
            ) : (
              "Search"
            )}
          </button>
        </form>

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {!lastQuery && !loading ? (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-gray-600">Try an example:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => onExampleClick(example)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:border-exablue hover:text-exablue"
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {lastQuery ? (
          <div className="mt-8">
            <div className="flex items-center justify-between gap-4">
              {results.length > 0 && responseTimeMs !== null ? (
                <p className="text-sm text-gray-500">
                  {results.length} results · {responseTimeMs}ms
                </p>
              ) : (
                <span />
              )}
              <div
                className="inline-flex rounded-full bg-gray-100 p-1"
                role="group"
                aria-label="Search type"
              >
                {(["neural", "keyword"] as const).map((type) => {
                  const active = searchType === type;

                  return (
                    <button
                      key={type}
                      type="button"
                      disabled={loading}
                      onClick={() => onSearchTypeChange(type)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-60 ${
                        active
                          ? "bg-exablue text-white"
                          : "bg-transparent text-gray-600"
                      }`}
                    >
                      {type === "neural" ? "Neural" : "Keyword"}
                    </button>
                  );
                })}
              </div>
            </div>

            {results.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-4">
                {results.map((result) => {
                  const snippet = result.highlights?.[0] ?? "";

                  return (
                    <li
                      key={result.id}
                      className="rounded-xl bg-white p-4 shadow-sm"
                    >
                      <p className="text-xs text-gray-500">
                        {getDomain(result.url)}
                      </p>
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block font-medium text-exablue"
                      >
                        {result.title ?? result.url}
                      </a>
                      {snippet ? (
                        <p className="mt-2 text-sm text-gray-600">
                          <HighlightedSnippet
                            text={snippet}
                            phrase={activePhrase}
                          />
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : !loading ? (
              <p className="mt-4 text-sm text-gray-600">No results found.</p>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
