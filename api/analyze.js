const SERPER_ENDPOINT = "https://google.serper.dev/search";

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

async function fetchSerp(apiKey, input, options) {
  const response = await fetch(SERPER_ENDPOINT, {
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
    throw new Error(`Serper ${response.status}: ${detail.slice(0, 180)}`);
  }

  const payload = await response.json();
  const serp = (payload.organic || [])
    .filter((result) => result.link)
    .slice(0, options.topN)
    .map((result, index) => ({
      position: result.position || index + 1,
      title: result.title || "",
      link: result.link || "",
      normalizedUrl: normalizeUrl(result.link || "")
    }));

  return { ...input, serp };
}

async function fetchSerpsInBatches(apiKey, keywords, options) {
  const concurrency = options.concurrency || 5;
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

function sharedUrlCount(a, b) {
  const aUrls = new Set(a.serp.map((result) => result.normalizedUrl));
  return b.serp.reduce(
    (count, result) => count + (aUrls.has(result.normalizedUrl) ? 1 : 0),
    0
  );
}

function buildSeoClusters(serps, threshold, topN) {
  const candidates = [...serps]
    .filter((item) => item.serp.length > 0)
    .sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword));

  const assigned = new Set();
  const clusters = [];

  for (const main of candidates) {
    if (assigned.has(main.keyword)) continue;

    const secondaryKeywords = [];

    for (const candidate of candidates) {
      if (candidate.keyword === main.keyword || assigned.has(candidate.keyword)) continue;

      const sharedUrls = sharedUrlCount(main, candidate);
      const similarity = sharedUrls / topN;

      if (similarity >= threshold) {
        secondaryKeywords.push({
          keyword: candidate.keyword,
          volume: candidate.volume,
          similarity,
          sharedUrls
        });
      }
    }

    const keywords = [
      {
        keyword: main.keyword,
        volume: main.volume,
        similarity: 1,
        sharedUrls: topN
      },
      ...secondaryKeywords.sort(
        (a, b) =>
          b.similarity - a.similarity ||
          b.volume - a.volume ||
          a.keyword.localeCompare(b.keyword)
      )
    ];

    for (const keyword of keywords) {
      assigned.add(keyword.keyword);
    }

    clusters.push({
      mainKeyword: main.keyword,
      mainVolume: main.volume,
      keywordCount: keywords.length,
      totalVolume: keywords.reduce((sum, keyword) => sum + keyword.volume, 0),
      keywords
    });
  }

  return clusters.sort(
    (a, b) =>
      b.totalVolume - a.totalVolume ||
      b.mainVolume - a.mainVolume ||
      a.mainKeyword.localeCompare(b.mainKeyword)
  );
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ message: "Méthode non autorisée." });
    return;
  }

  try {
    const body = request.body || {};
    const apiKey = String(body.apiKey || "").trim();
    const threshold = Number(body.threshold);
    const topN = Number(body.topN || 10);

    if (!apiKey) {
      response.status(400).json({ message: "Clé API Serper manquante." });
      return;
    }

    if (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 1) {
      response.status(400).json({ message: "Le seuil doit être compris entre 10% et 100%." });
      return;
    }

    if (!Number.isFinite(topN) || topN < 1 || topN > 10) {
      response.status(400).json({ message: "Le nombre de résultats doit être compris entre 1 et 10." });
      return;
    }

    const keywords = (body.keywords || [])
      .map((item) => ({
        keyword: cleanKeyword(item.keyword),
        volume: cleanVolume(item.volume)
      }))
      .filter((item) => item.keyword);

    if (keywords.length === 0) {
      response.status(400).json({ message: "Aucun mot-clé valide." });
      return;
    }

    if (keywords.length > 500) {
      response.status(400).json({ message: "Limite fixée à 500 mots-clés par analyse." });
      return;
    }

    const serps = await fetchSerpsInBatches(apiKey, keywords, {
      gl: body.gl || "fr",
      hl: body.hl || "fr",
      topN,
      concurrency: 5
    });

    response.status(200).json({
      clusters: buildSeoClusters(serps, threshold, topN),
      serpCount: serps.filter((item) => item.serp.length > 0).length,
      errors: serps
        .filter((item) => item.error)
        .map((item) => ({ keyword: item.keyword, message: item.error || "" }))
    });
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "Erreur pendant l'analyse SERP."
    });
  }
};

module.exports.config = {
  maxDuration: 60
};
