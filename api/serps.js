const SERPER_BASE_URL = "https://google.serper.dev";
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SEARCH_TYPES = new Set([
  "search",
  "images",
  "videos",
  "places",
  "maps",
  "reviews",
  "news",
  "shopping",
  "scholar",
  "patents",
  "autocomplete"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.search = "";
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const path = url.pathname.replace(/\/$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return String(rawUrl || "")
      .split("#")[0]
      .split("?")[0]
      .replace(/\/$/, "")
      .toLowerCase();
  }
}

function cleanKeyword(value) {
  return String(value || "").trim();
}

function cleanVolume(value) {
  const parsed = Number(String(value || "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function cleanSearchType(value) {
  const searchType = String(value || "search").trim().toLowerCase();
  return SEARCH_TYPES.has(searchType) ? searchType : "search";
}

function getEndpoint(searchType) {
  return `${SERPER_BASE_URL}/${cleanSearchType(searchType)}`;
}

function findResultsArray(payload, searchType) {
  const preferredKeys = {
    search: ["organic"],
    images: ["images"],
    videos: ["videos"],
    places: ["places"],
    maps: ["places", "maps"],
    reviews: ["reviews"],
    news: ["news"],
    shopping: ["shopping"],
    scholar: ["organic", "scholarlyArticles"],
    patents: ["organic", "patents"],
    autocomplete: ["suggestions"]
  };

  for (const key of preferredKeys[searchType] || ["organic"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  const fallback = Object.values(payload).find((value) => Array.isArray(value));
  return Array.isArray(fallback) ? fallback : [];
}

function valueFrom(result, keys) {
  for (const key of keys) {
    if (result[key] !== undefined && result[key] !== null && result[key] !== "") {
      return result[key];
    }
  }
  return "";
}

function normalizeResult(result, index, searchType) {
  const link = String(
    valueFrom(result, [
      "link",
      "url",
      "sourceUrl",
      "imageUrl",
      "thumbnailUrl",
      "website",
      "pdfUrl"
    ])
  );
  const title = String(valueFrom(result, ["title", "name", "query", "suggestion"]));

  return {
    position: Number(result.position || index + 1),
    title,
    link,
    normalizedUrl: normalizeUrl(link || title),
    snippet: String(valueFrom(result, ["snippet", "description", "address"])),
    source: String(valueFrom(result, ["source", "domain", "publisher", "seller"])),
    date: String(valueFrom(result, ["date", "publishedDate", "year"])),
    rating: String(valueFrom(result, ["rating", "reviews"])),
    price: String(valueFrom(result, ["price", "extractedPrice"])),
    searchType
  };
}

async function fetchSerp(apiKey, input, options) {
  const maxAttempts = options.maxAttempts || 3;
  const searchType = cleanSearchType(options.searchType);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(getEndpoint(searchType), {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: input.keyword,
        gl: options.gl,
        hl: options.hl,
        num: options.topN
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      const message = `Serper ${response.status}: ${detail.slice(0, 180)}`;

      if (attempt < maxAttempts && RETRYABLE_STATUSES.has(response.status)) {
        await sleep(600 * attempt);
        continue;
      }

      throw new Error(message);
    }

    const payload = await response.json();
    const serp = findResultsArray(payload, searchType)
      .slice(0, options.topN)
      .map((result, index) => normalizeResult(result, index, searchType))
      .filter((result) => result.link || result.title);

    return {
      ...input,
      searchType,
      country: options.gl,
      language: options.hl,
      serp
    };
  }

  throw new Error("Serper: échec après plusieurs tentatives.");
}

async function fetchSerpsInBatches(apiKey, keywords, options) {
  const concurrency = options.concurrency || 3;
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < keywords.length) {
      const current = keywords[cursor];
      cursor += 1;

      try {
        results.push(await fetchSerp(apiKey, current, options));
      } catch (error) {
        results.push({
          ...current,
          serp: [],
          error: error instanceof Error ? error.message : "Erreur inconnue"
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, keywords.length) }, () => worker())
  );

  const order = new Map(keywords.map((keyword, index) => [keyword.keyword, index]));
  return results.sort((a, b) => (order.get(a.keyword) || 0) - (order.get(b.keyword) || 0));
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ message: "Méthode non autorisée." });
    return;
  }

  try {
    const body = request.body || {};
    const apiKey = String(body.apiKey || "").trim();
    const topN = Number(body.topN || 10);
    const searchType = cleanSearchType(body.searchType);
    const keywords = (body.keywords || [])
      .map((item) => ({
        keyword: cleanKeyword(item.keyword),
        volume: cleanVolume(item.volume)
      }))
      .filter((item) => item.keyword);

    if (!apiKey) {
      response.status(400).json({ message: "Clé API Serper manquante." });
      return;
    }

    if (keywords.length === 0) {
      response.status(400).json({ message: "Aucun mot-clé valide." });
      return;
    }

    if (!Number.isFinite(topN) || topN < 1 || topN > 100) {
      response.status(400).json({ message: "Le nombre de résultats doit être compris entre 1 et 100." });
      return;
    }

    const serps = await fetchSerpsInBatches(apiKey, keywords, {
      searchType,
      gl: body.gl || "fr",
      hl: body.hl || "fr",
      topN,
      concurrency: 3,
      maxAttempts: 3
    });

    response.status(200).json({
      serps,
      serpCount: serps.filter((item) => item.serp.length > 0).length,
      errors: serps
        .filter((item) => item.error)
        .map((item) => ({ keyword: item.keyword, message: item.error || "" }))
    });
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "Erreur pendant la récupération SERP."
    });
  }
};

module.exports.config = {
  maxDuration: 60
};
