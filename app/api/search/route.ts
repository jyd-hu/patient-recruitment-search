import Exa from "exa-js";
import { NextResponse } from "next/server";

const exa = new Exa(process.env.EXA_API_KEY);

type SearchMode = "patient" | "physician";

const PHYSICIAN_DOMAINS = [
  // Directories — real contact / booking data
  "healthgrades.com",
  "zocdoc.com",
  "vitals.com",
  // Profiles & research
  "pubmed.ncbi.nlm.nih.gov",
  "doximity.com",
  // Major hospital / academic systems (incl. common .edu bios)
  "mayoclinic.org",
  "clevelandclinic.org",
  "hopkinsmedicine.org",
  "massgeneral.org",
  "stanfordhealthcare.org",
  "mountsinai.org",
  "stanford.edu",
  "harvard.edu",
  "yale.edu",
  "ucla.edu",
  "ucsf.edu",
  "duke.edu",
  "upenn.edu",
  "columbia.edu",
];

/** Per-result structured fields via contents.summary.schema (SDK: SummaryContentsOptions.schema). */
const PHYSICIAN_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Physician's full name" },
    specialty: { type: "string", description: "Medical specialty" },
    affiliation: { type: "string", description: "Hospital or institution" },
    contact: {
      type: "string",
      description:
        "Best available way to reach this physician: email if present, otherwise phone number. Return empty string if neither is found.",
    },
  },
  required: ["name", "specialty", "affiliation", "contact"],
} as const;

type PhysicianSummary = {
  name: string;
  specialty: string;
  affiliation: string;
  contact: string;
};

const EMPTY_PHYSICIAN_SUMMARY: PhysicianSummary = {
  name: "",
  specialty: "",
  affiliation: "",
  contact: "",
};

/** Exa returns summary as a JSON string when schema is set; fall back to empty fields. */
function parsePhysicianSummary(summary: unknown): PhysicianSummary {
  if (summary == null || summary === "") return EMPTY_PHYSICIAN_SUMMARY;

  let parsed: unknown = summary;
  if (typeof summary === "string") {
    try {
      parsed = JSON.parse(summary);
    } catch {
      return EMPTY_PHYSICIAN_SUMMARY;
    }
  }

  if (!parsed || typeof parsed !== "object") return EMPTY_PHYSICIAN_SUMMARY;

  const obj = parsed as Record<string, unknown>;
  return {
    name: typeof obj.name === "string" ? obj.name : "",
    specialty: typeof obj.specialty === "string" ? obj.specialty : "",
    affiliation: typeof obj.affiliation === "string" ? obj.affiliation : "",
    contact: typeof obj.contact === "string" ? obj.contact : "",
  };
}

/** Drop rows with missing / placeholder names so they never reach the table. */
function hasResolvedPhysicianName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !(
    lower === "null" ||
    lower === "undefined" ||
    lower === "n/a" ||
    lower === "none" ||
    lower === "unknown" ||
    lower === "not available" ||
    lower === "not found"
  );
}

function physicianFieldCompleteness(result: PhysicianSummary): number {
  return [result.name, result.specialty, result.affiliation, result.contact]
    .filter((v) => typeof v === "string" && v.trim().length > 0).length;
}

/**
 * Keep one row per physician name (case-insensitive, trimmed).
 * Prefer higher composite score; on ties, prefer more complete fields.
 */
function dedupePhysiciansByName<
  T extends PhysicianSummary & { score?: number },
>(results: T[]): T[] {
  const bestByName = new Map<string, T>();

  for (const result of results) {
    const key = result.name.trim().toLowerCase();
    const existing = bestByName.get(key);
    if (!existing) {
      bestByName.set(key, result);
      continue;
    }

    const nextScore =
      typeof result.score === "number" ? result.score : Number.NEGATIVE_INFINITY;
    const prevScore =
      typeof existing.score === "number"
        ? existing.score
        : Number.NEGATIVE_INFINITY;

    if (nextScore > prevScore) {
      bestByName.set(key, result);
    } else if (
      nextScore === prevScore &&
      physicianFieldCompleteness(result) > physicianFieldCompleteness(existing)
    ) {
      bestByName.set(key, result);
    }
  }

  return Array.from(bestByName.values());
}

/**
 * Flag (don't rewrite) affiliations that look like specialty/title lists
 * rather than an institution — schema may be misreading the page.
 */
function warnIfAffiliationLooksLikeSpecialty(
  name: string,
  affiliation: string
): void {
  const trimmed = affiliation.trim();
  if (!trimmed.includes(",")) return;

  const specialtyLike =
    /\b(pulmonary|allergy|immunology|cardiology|oncology|neurology|dermatology|rheumatology|endocrinology|gastroenterology|nephrology|hematology|infectious disease|clinical professor|assistant professor|associate professor|faculty)\b/i.test(
      trimmed
    );
  if (!specialtyLike) return;

  console.warn(
    `[physician] affiliation may be mis-extracted (specialty/title-like) for "${name}": ${trimmed}`
  );
}

function buildQuery(mode: SearchMode, indication: string, criteria: string) {
  if (mode === "physician") {
    return `physician or specialist treating ${indication} patients ${criteria}, clinical trial referral`;
  }
  return `forum, community, or social media posts from people describing symptoms of ${criteria}, without naming ${indication} directly, or a support group for ${indication}`;
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Friendly names for common patient-channel domains. */
const KNOWN_SITE_NAMES: Record<string, string> = {
  "pulmonaryfibrosisnews.com": "Pulmonary Fibrosis News",
  "connect.mayoclinic.org": "Mayo Clinic Connect",
  "reddit.com": "Reddit",
  "inspire.com": "Inspire",
  "patientslikeme.com": "PatientsLikeMe",
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Title-case a bare domain when no known-site entry exists. */
function fallbackSiteName(domain: string): string {
  const withoutTld = domain.replace(
    /\.(com|org|net|edu|gov|io|co\.uk|co|info|us|health|care)$/i,
    ""
  );
  return withoutTld
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSiteName(domain: string): string {
  if (KNOWN_SITE_NAMES[domain]) return KNOWN_SITE_NAMES[domain];
  for (const [known, name] of Object.entries(KNOWN_SITE_NAMES)) {
    if (domain.endsWith(`.${known}`)) return name;
  }
  return fallbackSiteName(domain) || domain;
}

/** Topic/thread from page title, without duplicated site boilerplate. */
function deriveTopicSnippet(title: string, siteName: string): string {
  let topic = title.trim();
  if (!topic) return "";

  const escapedSite = escapeRegExp(siteName);
  topic = topic.replace(
    new RegExp(`\\s*[-–—|:·]\\s*${escapedSite}\\b.*$`, "i"),
    ""
  );
  topic = topic.replace(
    new RegExp(`^${escapedSite}\\s*[-–—|:·]\\s*`, "i"),
    ""
  );
  topic = topic.replace(new RegExp(escapedSite, "ig"), " ");
  topic = topic
    .replace(/\s*\|\s*[^|]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[-–—|:·\s]+|[-–—|:·\s]+$/g, "")
    .trim();

  const words = topic.split(/\s+/).filter(Boolean);
  if (words.length > 8) {
    topic = words.slice(0, 8).join(" ");
  }
  return topic;
}

/** "{Site name}, {topic}" — never includes channelType. */
function buildChannelName(
  title: string | null | undefined,
  url: string
): string {
  const siteName = getSiteName(getDomain(url));
  const topic = deriveTopicSnippet(title ?? "", siteName);
  if (!topic) return siteName;
  return `${siteName}, ${topic}`;
}

/** Keep Exa order; skip once a domain hits maxPerDomain; return at most `limit`. */
function capResultsPerDomain<T extends { url: string }>(
  results: T[],
  maxPerDomain = 3,
  limit = 10
): T[] {
  const counts = new Map<string, number>();
  const capped: T[] = [];

  for (const result of results) {
    if (capped.length >= limit) break;

    const domain = getDomain(result.url);
    const count = counts.get(domain) ?? 0;
    if (count >= maxPerDomain) continue;

    counts.set(domain, count + 1);
    capped.push(result);
  }

  return capped;
}

function classifyChannelType(url: string, text: string): string {
  const domain = new URL(url).hostname;
  const lowerText = text.toLowerCase();

  if (domain.includes("reddit.com")) return "Message board";
  if (
    domain.includes("facebook.com") ||
    domain.includes("instagram.com") ||
    domain.includes("twitter.com") ||
    domain.includes("x.com")
  ) {
    return "Social media";
  }
  if (
    domain.includes("inspire.com") ||
    domain.includes("patientslikeme.com") ||
    domain.includes("smartpatients.com")
  ) {
    return "Advocacy group";
  }
  if (
    domain.includes("forum.") ||
    domain.includes("community.") ||
    url.includes("/forums/") ||
    url.includes("/community/")
  ) {
    return "Message board";
  }
  if (
    lowerText.includes("support group") ||
    lowerText.includes("finding support") ||
    lowerText.includes("connect with people") ||
    lowerText.includes("you're not alone")
  ) {
    return "Support group";
  }
  if (lowerText.includes("facebook group")) return "Social media";
  if (
    lowerText.includes("forum") ||
    lowerText.includes("discussion board") ||
    lowerText.includes("message board")
  ) {
    return "Message board";
  }
  if (lowerText.includes("community") || lowerText.includes("advocacy")) {
    return "Advocacy group";
  }

  return "Other";
}

/** Exa neural scores are typically 0–1; pass through if already on a 0–10 scale. */
function normalizeRelevanceScore(score: unknown): number {
  if (typeof score !== "number" || Number.isNaN(score)) return 0;
  if (score > 1) return Math.min(10, score);
  return score * 10;
}

function reachScore(channelType: string): number {
  switch (channelType) {
    case "Social media":
    case "Message board":
      return 8;
    case "Advocacy group":
      return 6;
    case "Support group":
      return 5;
    default:
      return 3;
  }
}

function contactabilityScore(contact: string): number {
  const trimmed = contact.trim();
  if (!trimmed) return 2;
  if (trimmed.includes("@")) return 9;
  if (looksLikePhone(trimmed)) return 7;
  // Profile URL fallback ("View profile: …") or any other URL-like contact
  return 5;
}

/** Digits-heavy string that isn't an email/URL — treat as phone. */
function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("@")) return false;
  if (/^https?:\/\//i.test(trimmed) || /^view profile:/i.test(trimmed)) {
    return false;
  }
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Prefer email, then phone from the summary; otherwise fall back to the page URL
 * as a labeled profile link (frontend renders the label as a clickable link).
 */
function resolvePhysicianContact(
  summaryContact: string,
  pageUrl: string
): string {
  const trimmed = summaryContact.trim();
  if (trimmed.includes("@")) return trimmed;
  if (looksLikePhone(trimmed)) return trimmed;
  const url = pageUrl.trim();
  if (url) return `View profile: ${url}`;
  return "";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function POST(request: Request) {
  try {
    const { indication, criteria, mode, type } = await request.json();

    if (!indication || typeof indication !== "string") {
      return NextResponse.json(
        { error: "Missing 'indication' in request body" },
        { status: 400 }
      );
    }

    const searchMode: SearchMode =
      mode === "physician" ? "physician" : "patient";
    const searchType = type === "keyword" ? "keyword" : "neural";
    const criteriaText =
      typeof criteria === "string" ? criteria.trim() : "";
    const query = buildQuery(
      searchMode,
      indication.trim(),
      criteriaText
    );

    const response = await exa.search(query, {
      type: searchType,
      numResults: 20,
      ...(searchMode === "physician"
        ? { includeDomains: PHYSICIAN_DOMAINS }
        : {}),
      contents:
        searchMode === "physician"
          ? {
              highlights: true,
              summary: { schema: PHYSICIAN_SUMMARY_SCHEMA },
            }
          : {
              text: { maxCharacters: 300 },
              highlights: true,
            },
    });

    // Patient: diversify first, then enrich. Physician: parse/filter/score/dedupe, then diversify.
    if (searchMode === "patient") {
      const capped = capResultsPerDomain(response.results);
      const enriched = capped.map((result) => {
        const channelType = classifyChannelType(
          result.url,
          "text" in result && typeof result.text === "string"
            ? result.text
            : ""
        );
        return {
          ...result,
          channelType,
          channelName: buildChannelName(result.title, result.url),
        };
      });

      const results =
        searchType === "neural"
          ? enriched
              .map((result) => {
                const relevanceScore = normalizeRelevanceScore(result.score);
                const reach = reachScore(result.channelType);
                return {
                  ...result,
                  score: round1(0.6 * relevanceScore + 0.4 * reach),
                  relevanceScore: round1(relevanceScore),
                  reachScore: reach,
                };
              })
              .sort((a, b) => b.score - a.score)
          : enriched.map(({ score: _score, ...rest }) => rest);

      return NextResponse.json({
        ...response,
        results,
      });
    }

    const physicians = response.results
      .map((result) => {
        const fields = parsePhysicianSummary(
          "summary" in result ? result.summary : undefined
        );
        return {
          ...result,
          ...fields,
          contact: resolvePhysicianContact(fields.contact, result.url),
        };
      })
      .filter((result) => hasResolvedPhysicianName(result.name));

    const scored =
      searchType === "neural"
        ? physicians
            .map((result) => {
              const relevanceScore = normalizeRelevanceScore(result.score);
              const contactability = contactabilityScore(result.contact);
              return {
                ...result,
                score: round1(0.6 * relevanceScore + 0.4 * contactability),
                relevanceScore: round1(relevanceScore),
                contactabilityScore: contactability,
              };
            })
            .sort((a, b) => b.score - a.score)
        : physicians.map(({ score: _score, ...rest }) => rest);

    const deduped = dedupePhysiciansByName(scored);
    for (const result of deduped) {
      warnIfAffiliationLooksLikeSpecialty(result.name, result.affiliation);
    }
    const ordered =
      searchType === "neural"
        ? [...deduped].sort((a, b) => {
            const scoreA = "score" in a && typeof a.score === "number" ? a.score : 0;
            const scoreB = "score" in b && typeof b.score === "number" ? b.score : 0;
            return scoreB - scoreA;
          })
        : deduped;
    const results = capResultsPerDomain(ordered);

    return NextResponse.json({
      ...response,
      results,
    });
  } catch (error) {
    console.error("Exa search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
