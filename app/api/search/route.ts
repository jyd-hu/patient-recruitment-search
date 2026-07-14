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

function buildQuery(mode: SearchMode, indication: string, criteria: string) {
  if (mode === "physician") {
    return `physician or specialist treating ${indication} patients ${criteria}, clinical trial referral`;
  }
  return `online forum, community, or social media group where people with ${indication} discuss ${criteria}, or a support group for ${indication}`;
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

    const response = await exa.searchAndContents(query, {
      type: searchType,
      numResults: 20,
      ...(searchMode === "physician"
        ? { includeDomains: PHYSICIAN_DOMAINS }
        : {}),
      text: { maxCharacters: 300 },
      highlights: true,
    });

    return NextResponse.json({
      ...response,
      results: capResultsPerDomain(response.results),
    });
  } catch (error) {
    console.error("Exa search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
