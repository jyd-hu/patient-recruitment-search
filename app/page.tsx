"use client";

import {
  FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Download, Home as HomeIcon, X } from "lucide-react";
import * as XLSX from "xlsx";
import Onboarding from "@/components/Onboarding";

type SearchType = "neural" | "keyword";
type SearchMode = "patient" | "physician";
type CacheKey = `${SearchMode}:${SearchType}`;

type SearchResult = {
  id: string;
  title: string | null;
  url: string;
  highlights?: string[];
  channelType?: string;
  channelName?: string;
  /** Composite 0–10 score (neural mode only). */
  score?: number;
  relevanceScore?: number;
  reachScore?: number;
  contactabilityScore?: number;
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
          <mark key={index} className="bg-delfa-cream text-inherit">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function PhysicianContactLink({ contact }: { contact: string }) {
  const PROFILE_PREFIX = "View profile:";

  if (contact.includes("@")) {
    return (
      <a
        href={`mailto:${contact}`}
        className="text-exablue hover:underline"
      >
        {contact}
      </a>
    );
  }

  if (contact.startsWith(PROFILE_PREFIX)) {
    const url = contact.slice(PROFILE_PREFIX.length).trim();
    if (!url) return "—";
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-exablue hover:underline"
      >
        View profile
      </a>
    );
  }

  // Phone (or other non-email contact from summary)
  const digits = contact.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length >= 7) {
    return (
      <a href={`tel:${digits}`} className="text-exablue hover:underline">
        {contact}
      </a>
    );
  }

  return <>{contact}</>;
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
                    <dd className="inline">
                      <PhysicianContactLink contact={result.contact} />
                    </dd>
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
/** Fits "Rel: 10.0 · Contact: 10.0"; kept fixed so toggle doesn't shift layout. */
const scoreColClass = "w-[12.5rem] min-w-[12.5rem] max-w-[12.5rem]";
/** Narrower score col for physician table (name takes more room). */
const physicianScoreColClass = "w-[10rem] min-w-[10rem] max-w-[10rem]";
/** Approx. patient "Channel name" share — keeps physician name readable. */
const physicianNameColClass = "w-[20%]";
const physicianSpecialtyColClass = "w-[18%]";
const physicianAffiliationColClass = "w-[22%]";
const physicianContactColClass = "w-[20%]";

const TRUNCATE_LIMIT = 50;

function TruncatedCellText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return "—";
  if (text.length <= TRUNCATE_LIMIT) return <>{text}</>;

  if (expanded) {
    return (
      <>
        {text}{" "}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-exablue hover:underline"
          aria-label="Collapse text"
        >
          less
        </button>
      </>
    );
  }

  return (
    <>
      {text.slice(0, TRUNCATE_LIMIT)}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-exablue hover:underline"
        aria-label="Expand text"
      >
        ...
      </button>
    </>
  );
}

function InfoTooltip({
  label,
  onLearnMore,
}: {
  label: string;
  onLearnMore?: () => void;
}) {
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
        className={`absolute top-full left-1/2 z-50 w-max max-w-[14rem] -translate-x-1/2 pt-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
          onLearnMore ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <span className="block rounded-md bg-gray-800 px-2 py-1.5 text-[11px] font-normal normal-case tracking-normal text-white shadow-sm">
          {label}
          {onLearnMore ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onLearnMore();
              }}
              className="mt-1.5 block text-left text-[11px] text-exablue/80 underline underline-offset-2 hover:text-exablue"
            >
              Learn more
            </button>
          ) : null}
        </span>
      </span>
    </span>
  );
}

function ScoringModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scoring-modal-title"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>

        <h2
          id="scoring-modal-title"
          className="pr-8 text-lg font-semibold text-gray-900"
        >
          How scoring works
        </h2>

        <div className="mt-5 space-y-5 text-sm leading-relaxed text-gray-700">
          <section>
            <h3 className="mb-2 font-medium text-gray-900">Patient channels</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                Relevance: Exa searches by meaning, not exact words - patients rarely
                use clinical terms. &quot;Sounds like the ocean&quot; and &quot;Coarse
                crackles in the lung&quot; mean the same thing to Exa
              </li>
              <li>
                Reach: channels are scored higher if they&apos;re active and widely
                used, so outreach is more likely to be seen
              </li>
            </ul>
            <p className="mt-2">
              Weighted 60:40, with relevance given greater importance than reach.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Physicians</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                Relevance: Exa matches by meaning here too - physicians describe
                things differently across papers and profiles. e.g. &quot;Declining
                lung function&quot; and &quot;reduced FVC&quot; are treated as the same
              </li>
              <li>
                Contactability: physicians are scored higher if they have a public
                email, then phone, then a profile link as a fallback
              </li>
            </ul>
            <p className="mt-2">
              Weighted 60:40, with relevance given greater importance than
              contactability.
            </p>
          </section>

          <p>
            Exa does two jobs here: finding what&apos;s relevant by meaning, and
            reading each page to pull out the details that make it usable.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-exablue px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-delfa-yellow-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ColumnHeader({
  children,
  tip,
  className = "",
  dataOnboarding,
}: {
  children: ReactNode;
  tip: string;
  className?: string;
  dataOnboarding?: string;
}) {
  return (
    <th
      className={`${thClass} ${className}`}
      {...(dataOnboarding ? { "data-onboarding": dataOnboarding } : {})}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        <InfoTooltip label={tip} />
      </span>
    </th>
  );
}

function ScoreColumnHeader({
  tip,
  showBreakdown,
  onToggle,
  colClass = scoreColClass,
}: {
  tip: string;
  showBreakdown: boolean;
  onToggle: () => void;
  colClass?: string;
}) {
  const [showScoringInfo, setShowScoringInfo] = useState(false);

  return (
    <>
      <th
        data-onboarding="score"
        className={`${thClass} ${colClass} cursor-pointer select-none transition-colors hover:text-exablue`}
        onClick={onToggle}
        aria-pressed={showBreakdown}
        title="Click to toggle score breakdown"
      >
        <span className="inline-flex items-center gap-0.5">
          Score
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <InfoTooltip
              label={tip}
              onLearnMore={() => setShowScoringInfo(true)}
            />
          </span>
        </span>
      </th>
      <ScoringModal
        open={showScoringInfo}
        onClose={() => setShowScoringInfo(false)}
      />
    </>
  );
}

/** Colour classes for composite score text: 7–10 green, 4–6.9 amber, 0–3.9 grey.
 *  Uses ! so it wins over `text-gray-800` on `tdClass`. */
function scoreTextClass(score: number | undefined): string {
  if (typeof score !== "number") return "!text-gray-400";
  if (score >= 7) return "!text-green-600";
  if (score >= 4) return "!text-amber-500";
  return "!text-gray-400";
}

function formatScoreCell(
  result: SearchResult,
  mode: "patient" | "physician",
  showBreakdown: boolean,
): string {
  if (typeof result.score !== "number") return "—";
  if (!showBreakdown) return String(result.score);

  const rel =
    typeof result.relevanceScore === "number"
      ? result.relevanceScore
      : "—";

  if (mode === "patient") {
    const reach =
      typeof result.reachScore === "number" ? result.reachScore : "—";
    return `Rel: ${rel} · Reach: ${reach}`;
  }

  const contact =
    typeof result.contactabilityScore === "number"
      ? result.contactabilityScore
      : "—";
  return `Rel: ${rel} · Contact: ${contact}`;
}

function downloadXlsx(
  rows: Record<string, string | number>[],
  filename: string,
) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, filename);
}

function exportPatientChannels(results: SearchResult[]) {
  const rows = results.map((result) => ({
    "Channel name":
      result.channelName ?? result.title ?? getDomain(result.url),
    "Channel type": result.channelType ?? "—",
    Score: typeof result.score === "number" ? result.score : "—",
    URL: result.url,
  }));
  downloadXlsx(rows, "patient-channels.xlsx");
}

function exportPhysicianContacts(results: SearchResult[]) {
  const rows = results.map((result) => ({
    "Physician name": result.name || result.title || "—",
    Specialty: result.specialty || "—",
    Affiliation: result.affiliation || "—",
    Score: typeof result.score === "number" ? result.score : "—",
    Contact: result.contact || "—",
  }));
  downloadXlsx(rows, "physician-contacts.xlsx");
}

function PatientResultsTable({ results }: { results: SearchResult[] }) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
      <table className="w-full min-w-[36rem] border-collapse table-fixed">
        <thead className="relative z-10">
          <tr className="border-b border-gray-100">
            <ColumnHeader tip="Name of the forum, group, or community">
              Channel name
            </ColumnHeader>
            <ColumnHeader tip="Category of platform (message board, support group, etc.)">
              Channel type
            </ColumnHeader>
            <ScoreColumnHeader
              tip="0–10. Higher = more relevant and active; lower = weaker fit for outreach."
              showBreakdown={showBreakdown}
              onToggle={() => setShowBreakdown((v) => !v)}
            />
            <th className={`${thClass} w-1/4`}>URL</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id} className="border-b border-gray-50 last:border-0">
              <td className={`${tdClass} font-medium`}>
                {result.channelName ?? result.title ?? getDomain(result.url)}
              </td>
              <td className={tdClass}>{result.channelType ?? "—"}</td>
              <td
                className={`${tdClass} ${scoreColClass} whitespace-nowrap tabular-nums font-medium ${scoreTextClass(result.score)}`}
              >
                {formatScoreCell(result, "patient", showBreakdown)}
              </td>
              <td className={`${tdClass} w-1/4`}>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-exablue hover:underline"
                  title={result.url}
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
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
      <table className="w-full min-w-[40rem] border-collapse table-fixed">
        <thead className="relative z-10">
          <tr className="border-b border-gray-100">
            <ColumnHeader
              tip="Name of the matched physician"
              className={physicianNameColClass}
            >
              Physician name
            </ColumnHeader>
            <ColumnHeader
              tip="Physician's medical specialty"
              className={physicianSpecialtyColClass}
            >
              Specialty
            </ColumnHeader>
            <ColumnHeader
              tip="Hospital or institution"
              className={physicianAffiliationColClass}
            >
              Affiliation
            </ColumnHeader>
            <ScoreColumnHeader
              tip="0–10. Higher = more relevant and contactable; lower = weaker fit for outreach."
              showBreakdown={showBreakdown}
              onToggle={() => setShowBreakdown((v) => !v)}
              colClass={physicianScoreColClass}
            />
            <ColumnHeader
              tip="Email, phone, or profile page link"
              className={physicianContactColClass}
              dataOnboarding="contact"
            >
              Contact
            </ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id} className="border-b border-gray-50 last:border-0">
              <td className={`${tdClass} ${physicianNameColClass} font-medium`}>
                {result.name || result.title || "—"}
              </td>
              <td className={`${tdClass} ${physicianSpecialtyColClass}`}>
                <TruncatedCellText text={result.specialty || ""} />
              </td>
              <td className={`${tdClass} ${physicianAffiliationColClass}`}>
                <TruncatedCellText text={result.affiliation || ""} />
              </td>
              <td
                className={`${tdClass} ${physicianScoreColClass} whitespace-nowrap tabular-nums font-medium ${scoreTextClass(result.score)}`}
              >
                {formatScoreCell(result, "physician", showBreakdown)}
              </td>
              <td className={`${tdClass} ${physicianContactColClass} break-all`}>
                {result.contact ? (
                  <PhysicianContactLink contact={result.contact} />
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

type OnboardingTarget =
  | "inputs"
  | "mode"
  | "type"
  | "score"
  | "contact"
  | "download";

const ONBOARDING_CALLOUTS: {
  target: OnboardingTarget;
  label: string;
}[] = [
  {
    target: "inputs",
    label: "Enter your trial's condition and criteria here",
  },
  {
    target: "mode",
    label: "Toggle between Patient channels and Physicians",
  },
  {
    target: "type",
    label:
      "Toggle Neural vs Keyword to compare neural search with standard keyword search",
  },
  {
    target: "score",
    label: "Results are ranked by score — click to see the breakdown",
  },
  {
    target: "contact",
    label: "Use contact details to reach physicians directly",
  },
  {
    target: "download",
    label: "Export either table to Excel for outreach planning",
  },
];

const ONBOARDING_DEMO_ROWS = [
  {
    name: "Dr. Sarah Chen",
    specialty: "Pulmonology",
    affiliation: "Stanford Medicine",
    score: 9.2,
    contact: "s.chen@stanford.edu",
  },
  {
    name: "Dr. James Okonkwo",
    specialty: "Rheumatology",
    affiliation: "Mayo Clinic",
    score: 8.7,
    contact: "j.okonkwo@mayo.edu",
  },
  {
    name: "Dr. Priya Nair",
    specialty: "Neurology",
    affiliation: "UCSF Medical Center",
    score: 8.1,
    contact: "View profile: https://profiles.ucsf.edu/priya.nair",
  },
] as const;

/** Callout steps that refer to results-table UI (after welcome + first 3 tips). */
function isTableOnboardingStep(step: number) {
  const callout = ONBOARDING_CALLOUTS[step - 1];
  return (
    callout?.target === "score" ||
    callout?.target === "contact" ||
    callout?.target === "download"
  );
}

function OnboardingDemoTable() {
  return (
    <div className="pointer-events-none mt-8 select-none" aria-hidden="true">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">3 results · 412ms</p>
        <button
          type="button"
          tabIndex={-1}
          className="rounded p-1 text-gray-500"
          title="Download Excel"
          aria-label="Download Excel"
          data-onboarding="download"
        >
          <Download className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[40rem] border-collapse table-fixed">
          <thead>
            <tr className="border-b border-gray-100">
              <th className={`${thClass} ${physicianNameColClass}`}>
                Physician name
              </th>
              <th className={`${thClass} ${physicianSpecialtyColClass}`}>
                Specialty
              </th>
              <th className={`${thClass} ${physicianAffiliationColClass}`}>
                Affiliation
              </th>
              <th
                data-onboarding="score"
                className={`${thClass} ${physicianScoreColClass}`}
              >
                Score
              </th>
              <th
                data-onboarding="contact"
                className={`${thClass} ${physicianContactColClass}`}
              >
                Contact
              </th>
            </tr>
          </thead>
          <tbody>
            {ONBOARDING_DEMO_ROWS.map((row) => (
              <tr
                key={row.name}
                className="border-b border-gray-50 last:border-0"
              >
                <td
                  className={`${tdClass} ${physicianNameColClass} font-medium`}
                >
                  {row.name}
                </td>
                <td className={`${tdClass} ${physicianSpecialtyColClass}`}>
                  {row.specialty}
                </td>
                <td className={`${tdClass} ${physicianAffiliationColClass}`}>
                  {row.affiliation}
                </td>
                <td
                  className={`${tdClass} ${physicianScoreColClass} whitespace-nowrap tabular-nums font-medium ${scoreTextClass(row.score)}`}
                >
                  {row.score}
                </td>
                <td
                  className={`${tdClass} ${physicianContactColClass} break-all text-exablue`}
                >
                  {row.contact.startsWith("View profile:")
                    ? "View profile"
                    : row.contact}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function resolveOnboardingTarget(
  target: OnboardingTarget,
): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-onboarding="${target}"]`);
}

function OnboardingOverlay({
  step,
  onNext,
  onSkip,
}: {
  step: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [calloutPos, setCalloutPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const isWelcome = step === 0;
  const calloutIndex = step - 1;
  const callout = !isWelcome ? ONBOARDING_CALLOUTS[calloutIndex] : null;
  const totalSteps = ONBOARDING_CALLOUTS.length;
  const isLast = calloutIndex === totalSteps - 1;

  useLayoutEffect(() => {
    if (isWelcome || !callout) {
      setSpotlight(null);
      setCalloutPos(null);
      return;
    }

    const targetKey = callout.target;

    function measure() {
      const el = resolveOnboardingTarget(targetKey);
      if (!el) {
        setSpotlight(null);
        setCalloutPos({
          top: window.innerHeight * 0.45,
          left: window.innerWidth / 2 - 140,
        });
        return;
      }

      el.scrollIntoView({ block: "nearest", inline: "nearest" });

      const rect = el.getBoundingClientRect();
      const pad = 8;
      setSpotlight({
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      });

      const calloutWidth = 280;
      const preferredTop = rect.bottom + 16;
      const preferredLeft = Math.min(
        Math.max(16, rect.left + rect.width / 2 - calloutWidth / 2),
        window.innerWidth - calloutWidth - 16,
      );
      const top =
        preferredTop + 140 > window.innerHeight
          ? Math.max(16, rect.top - 148)
          : preferredTop;

      setCalloutPos({ top, left: preferredLeft });
    }

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [isWelcome, callout]);

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding"
    >
      {spotlight ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-white/80"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
          }}
          aria-hidden="true"
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      )}

      {/* Blocks interaction with the app underneath (spotlight box-shadow is not hit-tested) */}
      <div className="absolute inset-0" aria-hidden="true" />

      {isWelcome ? (
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Trial-Scout
          </h2>
          <p className="mt-3 max-w-md text-base italic text-white/80 sm:text-lg">
            Find patients for your clinical trial - in minutes, not months
          </p>
          <div className="mt-10 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={onNext}
              className="rounded-lg bg-exablue px-6 py-2.5 text-sm font-medium text-gray-900 transition-colors hover:bg-delfa-yellow-hover"
            >
              Get started
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-sm text-white/70 transition-colors hover:text-white"
            >
              Skip
            </button>
          </div>
        </div>
      ) : callout && calloutPos ? (
        <div
          className="absolute z-10 w-[280px] rounded-xl bg-white p-4 shadow-lg"
          style={{ top: calloutPos.top, left: calloutPos.left }}
        >
          <p className="text-sm text-gray-800">{callout.label}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-gray-400">
              {calloutIndex + 1} of {totalSteps}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSkip}
                className="text-sm text-gray-500 transition-colors hover:text-gray-800"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={onNext}
                className="rounded-lg bg-exablue px-3.5 py-1.5 text-sm font-medium text-gray-900 transition-colors hover:bg-delfa-yellow-hover"
              >
                {isLast ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [enteredDemo, setEnteredDemo] = useState(false);
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
  const [showOnboarding, setShowOnboarding] = useState(true);
  // Start at first product-tour callout — narrative landing lives in Onboarding.
  const [onboardingStep, setOnboardingStep] = useState(1);
  const searchGeneration = useRef(0);

  function dismissOnboarding() {
    setShowOnboarding(false);
  }

  function advanceOnboarding() {
    if (onboardingStep >= ONBOARDING_CALLOUTS.length) {
      dismissOnboarding();
      return;
    }
    setOnboardingStep((s) => s + 1);
  }

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

    const generation = ++searchGeneration.current;
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

      if (generation !== searchGeneration.current) return;

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Search failed");
      }

      const data = await res.json();
      if (generation !== searchGeneration.current) return;

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
      if (generation !== searchGeneration.current) return;
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (generation === searchGeneration.current) {
        setLoading(false);
      }
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

  function onReset() {
    searchGeneration.current += 1;
    setIndication("");
    setCriteria("");
    setLoading(false);
    setError(null);
    setResults([]);
    setActivePhrase("");
    setSearchMode("patient");
    setSearchType("neural");
    setLastInputs(null);
    setResultsCache({});
    setResponseTimeMs(null);
    setShowFullResults(false);
  }

  if (!enteredDemo) {
    return <Onboarding onComplete={() => setEnteredDemo(true)} />;
  }

  return (
    <div className="relative min-h-screen bg-marble text-gray-900">
      {showOnboarding ? (
        <OnboardingOverlay
          step={onboardingStep}
          onNext={advanceOnboarding}
          onSkip={dismissOnboarding}
        />
      ) : null}

      <button
        type="button"
        onClick={onReset}
        className="absolute top-6 left-6 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-exablue"
        title="Reset"
        aria-label="Reset page"
      >
        <HomeIcon className="h-5 w-5" strokeWidth={1.75} />
      </button>

      <main className="mx-auto max-w-4xl px-6 pt-24 pb-24">
        <header className="mb-10 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Trial-Scout
          </h1>
          <p className="mt-2 text-base italic text-zinc-600">
            Find patients for your clinical trial - in minutes, not months
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div
            data-onboarding="inputs"
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
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
            className="flex h-10 items-center justify-center rounded-lg bg-exablue px-4 text-sm font-medium text-gray-900 disabled:opacity-60"
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
            data-onboarding="mode"
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
                      ? "bg-exablue text-gray-900"
                      : "bg-transparent text-gray-600"
                  }`}
                >
                  {mode === "patient" ? "Patient" : "Physician"}
                </button>
              );
            })}
          </div>

          <div
            data-onboarding="type"
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
                      ? "bg-exablue text-gray-900"
                      : "bg-transparent text-gray-600"
                  }`}
                >
                  {type === "neural" ? "Neural" : "Keyword"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Demo results table for table-related onboarding callouts */}
        {showOnboarding &&
        !lastInputs &&
        isTableOnboardingStep(onboardingStep) ? (
          <OnboardingDemoTable />
        ) : null}

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {!lastInputs &&
        !loading &&
        !(showOnboarding && isTableOnboardingStep(onboardingStep)) ? (
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                  {results.length} results · {responseTimeMs}ms
                </p>
                {searchType === "neural" ? (
                  <button
                    type="button"
                    onClick={() =>
                      searchMode === "patient"
                        ? exportPatientChannels(results)
                        : exportPhysicianContacts(results)
                    }
                    className="rounded p-1 text-gray-500 transition-colors hover:text-exablue"
                    title="Download Excel"
                    aria-label="Download Excel"
                    data-onboarding="download"
                  >
                    <Download className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
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
