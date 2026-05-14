const state = {
  keywords: [],
  result: null,
  loading: false,
  progress: 0,
  progressText: ""
};

const elements = {
  apiKey: document.querySelector("#apiKey"),
  csv: document.querySelector("#csv"),
  threshold: document.querySelector("#threshold"),
  thresholdValue: document.querySelector("#thresholdValue"),
  runButton: document.querySelector("#runButton"),
  exportButton: document.querySelector("#exportButton"),
  fileInfo: document.querySelector("#fileInfo"),
  status: document.querySelector("#status"),
  error: document.querySelector("#error"),
  keywordCount: document.querySelector("#keywordCount"),
  csvVolume: document.querySelector("#csvVolume"),
  clusterCount: document.querySelector("#clusterCount"),
  clusteredCount: document.querySelector("#clusteredCount"),
  progressFill: document.querySelector("#progressFill"),
  progressText: document.querySelector("#progressText"),
  tableWrap: document.querySelector("#tableWrap"),
  resultsBody: document.querySelector("#resultsBody"),
  emptyState: document.querySelector("#emptyState"),
  errorDetails: document.querySelector("#errorDetails"),
  errorDetailsCount: document.querySelector("#errorDetailsCount"),
  errorDetailsList: document.querySelector("#errorDetailsList")
};

const keywordColumnHints = ["keyword", "mot-clÃ©", "mot clÃ©", "motcle", "query", "requÃªte"];
const volumeColumnHints = ["volume", "search volume", "vol", "recherches"];

function formatNumber(value) {
  return Number(value || 0).toLocaleString("fr-FR");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseVolume(value) {
  const cleaned = String(value || "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseDelimited(text) {
  const delimiter = detectDelimiter(text);
  return parseCsv(text, delimiter);
}

function findColumn(headers, hints) {
  const normalized = headers.map((header) => ({
    original: header,
    normalized: header.trim().toLowerCase()
  }));

  const exact = normalized.find((header) => hints.includes(header.normalized));
  if (exact) return exact.original;

  const partial = normalized.find((header) =>
    hints.some((hint) => header.normalized.includes(hint))
  );
  return partial ? partial.original : headers[0];
}

function unparseCsv(rows) {
  const headers = [
    "Mot-clÃ© principal",
    "Volume",
    "Nombre de mots-clÃ©s",
    "Volume cumulÃ©",
    "Mots-clÃ©s du cluster"
  ];
  const lines = [headers, ...rows].map((row) =>
    row
      .map((value) => {
        const text = String(value ?? "");
        return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(";")
  );
  return lines.join("\n");
}

function clustersToCsv(clusters) {
  return unparseCsv(
    clusters.map((cluster) => [
      cluster.mainKeyword,
      cluster.mainVolume,
      cluster.keywordCount,
      cluster.totalVolume,
      cluster.keywords
        .map((keyword) =>
          keyword.similarity === 1
            ? `${keyword.keyword} (${keyword.volume})`
            : `${keyword.keyword} (${keyword.volume}, ${Math.round(keyword.similarity * 100)}%)`
        )
        .join(" | ")
    ])
  );
}

function downloadCsv() {
  if (!state.result) return;
  const blob = new Blob([`\uFEFF${clustersToCsv(state.result.clusters)}`], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "clusters-similarite-serp.csv";
  link.click();
  URL.revokeObjectURL(url);
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

function updateUi() {
  const totalVolume = state.keywords.reduce((sum, keyword) => sum + keyword.volume, 0);
  const clusterCount = state.result ? state.result.clusters.length : 0;
  const clusteredCount = state.result
    ? state.result.clusters.reduce((sum, cluster) => sum + cluster.keywordCount, 0)
    : 0;

  elements.thresholdValue.textContent = `${elements.threshold.value}%`;
  elements.keywordCount.textContent = formatNumber(state.keywords.length);
  elements.csvVolume.textContent = formatNumber(totalVolume);
  elements.clusterCount.textContent = formatNumber(clusterCount);
  elements.clusteredCount.textContent = formatNumber(clusteredCount);
  elements.runButton.disabled =
    state.loading || !elements.apiKey.value.trim() || state.keywords.length === 0;
  elements.exportButton.disabled = !state.result || state.result.clusters.length === 0;

  const progress = state.loading
    ? state.progress
    : state.result
      ? 100
      : state.keywords.length > 0
        ? 20
        : 0;
  elements.progressFill.style.width = `${progress}%`;
  elements.progressText.textContent = state.loading
    ? state.progressText || "Analyse en cours..."
    : state.result
      ? `${state.result.serpCount} SERP rÃ©cupÃ©rÃ©es. ${state.result.errors.length} erreurs.`
      : "En attente d'un CSV et d'une clÃ© API.";

  renderResults();
  renderErrorDetails();
}

function renderResults() {
  if (!state.result || state.result.clusters.length === 0) {
    elements.tableWrap.classList.add("hidden");
    elements.emptyState.classList.remove("hidden");
    elements.resultsBody.innerHTML = "";
    return;
  }

  elements.tableWrap.classList.remove("hidden");
  elements.emptyState.classList.add("hidden");
  elements.resultsBody.innerHTML = state.result.clusters
    .map((cluster) => {
      const keywords = cluster.keywords
        .map((keyword) =>
          keyword.similarity === 1
            ? `${keyword.keyword} (${keyword.volume})`
            : `${keyword.keyword} (${keyword.volume}, ${Math.round(keyword.similarity * 100)}%)`
        )
        .join(" | ");

      return `<tr>
        <td><strong>${escapeHtml(cluster.mainKeyword)}</strong></td>
        <td>${formatNumber(cluster.mainVolume)}</td>
        <td>${formatNumber(cluster.keywordCount)}</td>
        <td>${formatNumber(cluster.totalVolume)}</td>
        <td class="keywords">${escapeHtml(keywords)}</td>
      </tr>`;
    })
    .join("");
}

function simplifySerperMessage(message) {
  const text = String(message || "");

  if (text.includes("429")) return "Limite de dÃ©bit ou quota Serper atteint";
  if (text.includes("401") || text.includes("403")) return "ClÃ© API refusÃ©e ou non autorisÃ©e";
  if (text.includes("402")) return "CrÃ©dits Serper insuffisants";
  if (text.includes("500") || text.includes("502") || text.includes("503") || text.includes("504")) {
    return "Erreur temporaire cÃ´tÃ© Serper";
  }

  return text;
}

function renderErrorDetails() {
  if (!state.result || state.result.errors.length === 0) {
    elements.errorDetails.classList.add("hidden");
    elements.errorDetailsList.innerHTML = "";
    elements.errorDetailsCount.textContent = "";
    return;
  }

  elements.errorDetails.classList.remove("hidden");
  elements.errorDetailsCount.textContent = `${state.result.errors.length} mot(s)-clÃ©(s) non rÃ©cupÃ©rÃ©(s)`;
  elements.errorDetailsList.innerHTML = state.result.errors
    .slice(0, 30)
    .map(
      (error) => `<div class="error-row">
        <strong>${escapeHtml(error.keyword)}</strong>
        <span>${escapeHtml(simplifySerperMessage(error.message))}</span>
      </div>`
    )
    .join("");

  if (state.result.errors.length > 30) {
    elements.errorDetailsList.innerHTML += `<div class="error-row muted-row">Et ${
      state.result.errors.length - 30
    } erreur(s) supplÃ©mentaire(s)...</div>`;
  }
}

async function handleFile(file) {
  state.result = null;
  elements.error.textContent = "";
  elements.fileInfo.textContent = file ? `Fichier : ${file.name}` : "";

  if (!file) return;

  const text = await file.text();
  const rows = parseDelimited(text);
  const headers = rows.shift() || [];

  if (headers.length === 0) {
    elements.error.textContent = "Le CSV doit contenir une ligne d'en-tÃªtes.";
    state.keywords = [];
    updateUi();
    return;
  }

  const keywordColumn = findColumn(headers, keywordColumnHints);
  const volumeColumn = findColumn(headers, volumeColumnHints);
  const keywordIndex = headers.indexOf(keywordColumn);
  const volumeIndex = headers.indexOf(volumeColumn);

  state.keywords = rows
    .map((row) => ({
      keyword: String(row[keywordIndex] || "").trim(),
      volume: parseVolume(row[volumeIndex] || "0")
    }))
    .filter((row) => row.keyword);

  elements.status.textContent = `${state.keywords.length} mots-clÃ©s chargÃ©s depuis les colonnes "${keywordColumn}" et "${volumeColumn}".`;
  updateUi();
}

async function runAnalysis() {
  state.loading = true;
  state.result = null;
  state.progress = 5;
  state.progressText = "Preparation de l'analyse...";
  elements.error.textContent = "";
  elements.status.textContent = "Recuperation des SERP Google FR via Serper...";
  updateUi();

  try {
    const batchSize = 40;
    const allSerps = [];
    const allErrors = [];
    const totalBatches = Math.ceil(state.keywords.length / batchSize);

    for (let index = 0; index < totalBatches; index += 1) {
      const start = index * batchSize;
      const batch = state.keywords.slice(start, start + batchSize);
      state.progress = Math.max(8, Math.round((index / totalBatches) * 85));
      state.progressText = `Lot ${index + 1}/${totalBatches} : recuperation de ${batch.length} SERP...`;
      elements.status.textContent = state.progressText;
      updateUi();

      const response = await fetch("/api/serps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          apiKey: elements.apiKey.value,
          keywords: batch,
          gl: "fr",
          hl: "fr",
          topN: 10
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Erreur pendant la recuperation SERP.");
      }

      allSerps.push(...payload.serps);
      allErrors.push(...payload.errors);
    }

    state.progress = 92;
    state.progressText = "Calcul des similarites et creation des clusters...";
    updateUi();

    state.result = {
      clusters: buildSeoClusters(allSerps, Number(elements.threshold.value) / 100, 10),
      serpCount: allSerps.filter((item) => item.serp.length > 0).length,
      errors: allErrors
    };
    elements.status.textContent = "Analyse terminee.";
  } catch (error) {
    elements.error.textContent =
      error instanceof Error ? error.message : "Erreur pendant l'analyse.";
    elements.status.textContent = "";
  } finally {
    state.loading = false;
    state.progress = 0;
    state.progressText = "";
    updateUi();
  }
}
elements.csv.addEventListener("change", (event) => handleFile(event.target.files[0]));
elements.apiKey.addEventListener("input", updateUi);
elements.threshold.addEventListener("input", updateUi);
elements.runButton.addEventListener("click", runAnalysis);
elements.exportButton.addEventListener("click", downloadCsv);

updateUi();
