"use client";

import { FormEvent, type ReactNode, useState } from "react";

type SearchType = "neural" | "keyword";
type SearchMode = "patient" | "physician";
type CacheKey = `${SearchMode}:${SearchType}`;

type SearchResult = {
  id: string;
  title: string | null;
  url: string;
  highlights?: string[];
  channelType?: string;
  /** Composite 0–10 score (neural mode only). */
  score?: number;
  /** Structured fields from Exa summary schema (physician mode only). */
  name?: string;
  specialty?: string;
  affiliation?: string;
  contact?: string;
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

/** Prefer a readable forum/group name over a raw post title. */
function formatChannelName(
  title: string | null | undefined,
  channelType: string | undefined,
  url: string,
): string {
  const raw = (title ?? "").trim();
  if (!raw) return getDomain(url);

  let candidate = raw;

  // "Post title - Pulmonary Fibrosis News Forums" → trailing community name
  const dashParts = raw.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    const trailing = dashParts[dashParts.length - 1].trim();
    if (
      trailing.length > 0 &&
      (/forum|group|community|board|network|news|support|reddit|facebook/i.test(
        trailing,
      ) ||
        trailing.length <= 48)
    ) {
      candidate = trailing;
    }
  }

  candidate =
    candidate.replace(/\s*\|\s*[^|]+$/, "").trim() || candidate;
  candidate = candidate.replace(/\s+Forums$/i, " Forum").trim();

  const type = channelType?.trim();
  if (!type) return candidate;

  const alreadyLabeled =
    candidate.toLowerCase().includes(type.toLowerCase()) ||
    /facebook|reddit|instagram|twitter|\bx\b|forum|group|community/i.test(
      candidate,
    );

  if (alreadyLabeled) return candidate;

  const typeLabel =
    type === "Social media" && /facebook\.com/i.test(url)
      ? "Facebook group"
      : type;

  return `${candidate}, ${typeLabel}`;
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

function ResultCards({
  results,
  searchMode,
  activePhrase,
}: {
  results: SearchResult[];
  searchMode: SearchMode;
  activePhrase: string;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {results.map((result) => {
        const snippet = result.highlights?.[0] ?? "";
        const isPhysician = searchMode === "physician";
        const displayTitle = isPhysician
          ? result.name || result.title || result.url
          : (result.title ?? result.url);

        return (
          <li key={result.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-gray-500">{getDomain(result.url)}</p>
              {result.channelType ? (
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {result.channelType}
                </span>
              ) : null}
              {typeof result.score === "number" ? (
                <span className="rounded-md bg-exablue/10 px-1.5 py-0.5 text-xs font-medium text-exablue">
                  Score: {result.score}/10
                </span>
              ) : null}
            </div>
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block font-medium text-exablue"
            >
              {displayTitle}
            </a>
            {isPhysician ? (
              <dl className="mt-2 space-y-1 text-sm text-gray-600">
                {result.specialty ? (
                  <div>
                    <dt className="inline font-medium text-gray-700">
                      Specialty:{" "}
                    </dt>
                    <dd className="inline">{result.specialty}</dd>
                  </div>
                ) : null}
                {result.affiliation ? (
                  <div>
                    <dt className="inline font-medium text-gray-700">
                      Affiliation:{" "}
                    </dt>
                    <dd className="inline">{result.affiliation}</dd>
                  </div>
                ) : null}
                {result.contact ? (
                  <div>
                    <dt className="inline font-medium text-gray-700">
                      Contact:{" "}
                    </dt>
                    <dd className="inline">{result.contact}</dd>
                  </div>
                ) : null}
              </dl>
            ) : snippet ? (
              <p className="mt-2 text-sm text-gray-600">
                <HighlightedSnippet text={snippet} phrase={activePhrase} />
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const thClass =
  "px-3 py-2 text-left text-xs font-medium tracking-wide text-gray-500 uppercase";
const tdClass = "px-3 py-2.5 text-sm text-gray-800 align-top";

function InfoTooltip({ label }: { label: string }) {
  return (
    <span className="group relative ml-1 inline-flex shrink-0 align-middle">
      <span
        tabIndex={0}
        aria-label={label}
        className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-current text-[9px] font-normal normal-case leading-none opacity-30 transition-opacity group-hover:opacity-70 group-focus-within:opacity-70"
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 w-max max-w-[14rem] -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1.5 text-[11px] font-normal normal-case tracking-normal text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function ColumnHeader({
  children,
  tip,
}: {
  children: ReactNode;
  tip: string;
}) {
  return (
    <th className={thClass}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        <InfoTooltip label={tip} />
      </span>
    </th>
  );
}

function PatientResultsTable({ results }: { results: SearchResult[] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
      <table className="w-full min-w-[36rem] border-collapse">
        <thead className="relative z-10">
          <tr className="border-b border-gray-100">
            <ColumnHeader tip="Name of the forum, group, or community">
              Channel name
            </ColumnHeader>
            <ColumnHeader tip="Category of platform (message board, support group, etc.)">
              Channel type
            </ColumnHeader>
            <ColumnHeader tip="Composite scoring of the channel, weighted 60:40 relevance:reach">
              Score
            </ColumnHeader>
            <th className={thClass}>URL</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id} className="border-b border-gray-50 last:border-0">
              <td className={`${tdClass} font-medium`}>
                {formatChannelName(
                  result.title,
                  result.channelType,
                  result.url,
                )}
              </td>
              <td className={tdClass}>{result.channelType ?? "—"}</td>
              <td className={`${tdClass} tabular-nums text-exablue font-medium`}>
                {typeof result.score === "number" ? result.score : "—"}
              </td>
              <td className={tdClass}>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-exablue hover:underline"
                >
                  {result.url}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhysicianResultsTable({ results }: { results: SearchResult[] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
      <table className="w-full min-w-[40rem] border-collapse">
        <thead className="relative z-10">
          <tr className="border-b border-gray-100">
            <ColumnHeader tip="Name of the matched physician">
              Physician name
            </ColumnHeader>
            <ColumnHeader tip="Physician's medical specialty">
              Specialty
            </ColumnHeader>
            <ColumnHeader tip="Hospital or institution">
              Affiliation
            </ColumnHeader>
            <ColumnHeader tip="Composite scoring of the physician, weighted 60:40 relevance:contactability">
              Score
            </ColumnHeader>
            <ColumnHeader tip="Email or contact link, if found">
              Contact
            </ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id} className="border-b border-gray-50 last:border-0">
              <td className={`${tdClass} font-medium`}>
                {result.name || result.title || "—"}
              </td>
              <td className={tdClass}>{result.specialty || "—"}</td>
              <td className={tdClass}>{result.affiliation || "—"}</td>
              <td className={`${tdClass} tabular-nums text-exablue font-medium`}>
                {typeof result.score === "number" ? result.score : "—"}
              </td>
              <td className={`${tdClass} break-all`}>
                {result.contact ? (
                  result.contact.includes("@") ? (
                    <a
                      href={`mailto:${result.contact}`}
                      className="text-exablue hover:underline"
                    >
                      {result.contact}
                    </a>
                  ) : (
                    result.contact
                  )
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ResultsCache = Partial<
  Record<CacheKey, { results: SearchResult[]; responseTimeMs: number }>
>;

function cacheKey(mode: SearchMode, type: SearchType): CacheKey {
  return `${mode}:${type}`;
}

export default function Home() {
  const [indication, setIndication] = useState("");
  const [criteria, setCriteria] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activePhrase, setActivePhrase] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("patient");
  const [searchType, setSearchType] = useState<SearchType>("neural");
  const [lastInputs, setLastInputs] = useState<{
    indication: string;
    criteria: string;
  } | null>(null);
  const [resultsCache, setResultsCache] = useState<ResultsCache>({});
  const [responseTimeMs, setResponseTimeMs] = useState<number | null>(null);
  const [showFullResults, setShowFullResults] = useState(false);

  async function handleSearch(
    ind: string,
    crit: string,
    mode: SearchMode,
    type: SearchType,
    phrase = ind.trim(),
    cache: ResultsCache = {},
  ) {
    const key = cacheKey(mode, type);
    const cached = cache[key];
    if (cached) {
      setResults(cached.results);
      setResponseTimeMs(cached.responseTimeMs);
      setError(null);
      setActivePhrase(phrase);
      setLastInputs({ indication: ind, criteria: crit });
      setSearchMode(mode);
      setSearchType(type);
      setResultsCache(cache);
      setShowFullResults(false);
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setResponseTimeMs(null);
    setSearchMode(mode);
    setSearchType(type);
    setShowFullResults(false);

    const started = performance.now();

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indication: ind,
          criteria: crit,
          mode,
          type,
        }),
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
      setLastInputs({ indication: ind, criteria: crit });
      setResultsCache({
        ...cache,
        [key]: { results: nextResults, responseTimeMs: elapsed },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSearch(indication, criteria, searchMode, searchType);
  }

  function onExampleClick(example: (typeof EXAMPLES)[number]) {
    setIndication(example.indication);
    setCriteria(example.criteria);
    void handleSearch(
      example.indication,
      example.criteria,
      searchMode,
      searchType,
      example.indication,
    );
  }

  function onSearchModeChange(mode: SearchMode) {
    if (mode === searchMode || loading || !lastInputs) {
      setSearchMode(mode);
      return;
    }
    void handleSearch(
      lastInputs.indication,
      lastInputs.criteria,
      mode,
      searchType,
      activePhrase,
      resultsCache,
    );
  }

  function onSearchTypeChange(type: SearchType) {
    if (type === searchType || loading || !lastInputs) {
      setSearchType(type);
      return;
    }
    void handleSearch(
      lastInputs.indication,
      lastInputs.criteria,
      searchMode,
      type,
      activePhrase,
      resultsCache,
    );
  }

  return (
    <div className="min-h-screen bg-marble text-gray-900">
      <main className="mx-auto max-w-4xl px-6 pt-24 pb-24">
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

        <div className="mt-4 flex items-center justify-between gap-4">
          <div
            className="inline-flex rounded-full bg-gray-100 p-1"
            role="group"
            aria-label="Discovery mode"
          >
            {(["patient", "physician"] as const).map((mode) => {
              const active = searchMode === mode;

              return (
                <button
                  key={mode}
                  type="button"
                  disabled={loading}
                  onClick={() => onSearchModeChange(mode)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-60 ${
                    active
                      ? "bg-exablue text-white"
                      : "bg-transparent text-gray-600"
                  }`}
                >
                  {mode === "patient" ? "Patient" : "Physician"}
                </button>
              );
            })}
          </div>

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

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {!lastInputs && !loading ? (
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

        {lastInputs ? (
          <div className="mt-8">
            {results.length > 0 && responseTimeMs !== null ? (
              <p className="text-sm text-gray-500">
                {results.length} results · {responseTimeMs}ms
              </p>
            ) : null}

            {results.length > 0 ? (
              searchType === "neural" ? (
                <div className="mt-4">
                  {searchMode === "patient" ? (
                    <PatientResultsTable results={results} />
                  ) : (
                    <PhysicianResultsTable results={results} />
                  )}

                  <div className="mt-4">
                    <button
                      type="button"
                      aria-expanded={showFullResults}
                      onClick={() => setShowFullResults((open) => !open)}
                      className="text-sm font-medium text-gray-600 transition-colors hover:text-exablue"
                    >
                      {showFullResults
                        ? "Hide full results ▴"
                        : "Show full results ▾"}
                    </button>
                    {showFullResults ? (
                      <div className="mt-4">
                        <ResultCards
                          results={results}
                          searchMode={searchMode}
                          activePhrase={activePhrase}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <ResultCards
                    results={results}
                    searchMode={searchMode}
                    activePhrase={activePhrase}
                  />
                </div>
              )
            ) : !loading ? (
              <p className="mt-4 text-sm text-gray-600">No results found.</p>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
