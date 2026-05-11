const state = {
  keywords: [],
  result: null,
  loading: false
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
  emptyState: document.querySelector("#emptyState")
};

const keywordColumnHints = ["keyword", "mot-clé", "mot clé", "motcle", "query", "requête"];
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
    "Mot-clé principal",
    "Volume",
    "Nombre de mots-clés",
    "Volume cumulé",
    "Mots-clés du cluster"
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

  const progress = state.loading ? 55 : state.result ? 100 : state.keywords.length > 0 ? 20 : 0;
  elements.progressFill.style.width = `${progress}%`;
  elements.progressText.textContent = state.loading
    ? "Analyse en cours. Pour 400 mots-clés, cela peut prendre un peu de temps côté API."
    : state.result
      ? `${state.result.serpCount} SERP récupérées. ${state.result.errors.length} erreurs.`
      : "En attente d'un CSV et d'une clé API.";

  renderResults();
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

async function handleFile(file) {
  state.result = null;
  elements.error.textContent = "";
  elements.fileInfo.textContent = file ? `Fichier : ${file.name}` : "";

  if (!file) return;

  const text = await file.text();
  const rows = parseDelimited(text);
  const headers = rows.shift() || [];

  if (headers.length === 0) {
    elements.error.textContent = "Le CSV doit contenir une ligne d'en-têtes.";
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

  elements.status.textContent = `${state.keywords.length} mots-clés chargés depuis les colonnes "${keywordColumn}" et "${volumeColumn}".`;
  updateUi();
}

async function runAnalysis() {
  state.loading = true;
  state.result = null;
  elements.error.textContent = "";
  elements.status.textContent = "Récupération des SERP Google FR via Serper...";
  updateUi();

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        apiKey: elements.apiKey.value,
        keywords: state.keywords,
        threshold: Number(elements.threshold.value) / 100,
        gl: "fr",
        hl: "fr",
        topN: 10
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Erreur pendant l'analyse.");
    }

    state.result = payload;
    elements.status.textContent = "Analyse terminée.";
  } catch (error) {
    elements.error.textContent =
      error instanceof Error ? error.message : "Erreur pendant l'analyse.";
    elements.status.textContent = "";
  } finally {
    state.loading = false;
    updateUi();
  }
}

elements.csv.addEventListener("change", (event) => handleFile(event.target.files[0]));
elements.apiKey.addEventListener("input", updateUi);
elements.threshold.addEventListener("input", updateUi);
elements.runButton.addEventListener("click", runAnalysis);
elements.exportButton.addEventListener("click", downloadCsv);

updateUi();
