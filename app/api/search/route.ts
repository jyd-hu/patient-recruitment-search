import Exa from "exa-js";
import { NextResponse } from "next/server";

const exa = new Exa(process.env.EXA_API_KEY);

type SearchMode = "patient" | "physician";

const PHYSICIAN_DOMAINS = [
  "pubmed.ncbi.nlm.nih.gov",
  "doximity.com",
  "mayoclinic.org",
  "clevelandclinic.org",
  "hopkinsmedicine.org",
  "massgeneral.org",
  "stanfordhealthcare.org",
  "mountsinai.org",
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
        "Email or contact link if present, otherwise empty string",
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
  return 6;
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

    const capped = capResultsPerDomain(response.results);
    const enriched =
      searchMode === "patient"
        ? capped.map((result) => ({
            ...result,
            channelType: classifyChannelType(
              result.url,
              "text" in result && typeof result.text === "string"
                ? result.text
                : ""
            ),
          }))
        : capped.map((result) => ({
            ...result,
            ...parsePhysicianSummary(
              "summary" in result ? result.summary : undefined
            ),
          }));

    // Composite score + re-rank for neural only; keyword stays unscored (control).
    const results =
      searchType === "neural"
        ? enriched
            .map((result) => {
              const relevanceScore = normalizeRelevanceScore(result.score);
              const secondary =
                searchMode === "patient"
                  ? reachScore(
                      "channelType" in result ? result.channelType : "Other"
                    )
                  : contactabilityScore(
                      "contact" in result ? result.contact : ""
                    );
              return {
                ...result,
                score: round1(0.6 * relevanceScore + 0.4 * secondary),
              };
            })
            .sort((a, b) => b.score - a.score)
        : enriched.map(({ score: _score, ...rest }) => rest);

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
