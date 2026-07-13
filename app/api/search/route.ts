import Exa from "exa-js";
import { NextResponse } from "next/server";

const exa = new Exa(process.env.EXA_API_KEY);

export async function POST(request: Request) {
  try {
    const { condition, type } = await request.json();

    if (!condition) {
      return NextResponse.json(
        { error: "Missing 'condition' in request body" },
        { status: 400 }
      );
    }

    const searchType = type === "keyword" ? "keyword" : "neural";

    const results = await exa.searchAndContents(condition, {
      type: searchType,
      numResults: 10,
      text: true,
      highlights: true,
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Exa search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
