"use client";

export const HelmChartComparison = () => {
  const [versions, setVersions] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const releases = [...new Set(Array.from(document.querySelectorAll('a[href*="github.com/langchain-ai/helm/releases/download/langsmith-"]'))
      .map((link) => link.href.match(/\/download\/(langsmith-[^/]+)\//)?.[1])
      .filter(Boolean))];
    setVersions(releases);
    setFrom(releases[1] || "");
    setTo(releases[0] || "");
    const controller = new AbortController();
    fetch("https://raw.githubusercontent.com/langchain-ai/docs/main/src/langsmith/self-hosted-changelog.mdx", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load chart versions.");
        return response.text();
      })
      .then((source) => setVersions([...new Set([...source.matchAll(/github\.com\/langchain-ai\/helm\/releases\/download\/(langsmith-[^/]+)\//g)].map((match) => match[1]))]))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setResult(null);
    setError("");
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    if (!loading) return;
    const controller = new AbortController();
    const chartTree = async (version) => {
      const response = await fetch(`https://api.github.com/repos/langchain-ai/helm/git/trees/${encodeURIComponent(version)}?recursive=1`, { signal: controller.signal });
      if (!response.ok) throw new Error("GitHub could not load the charts. Try again later.");
      const tree = await response.json();
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("GitHub returned an incomplete chart tree. Try again later.");
      return new Map(tree.tree.filter((file) => file.type === "blob" && file.path.startsWith("charts/langsmith/")).map((file) => [file.path, file.sha]));
    };
    const readFile = async (version, path, exists) => {
      if (!exists) return "";
      const response = await fetch(`https://raw.githubusercontent.com/langchain-ai/helm/${encodeURIComponent(version)}/${path.split("/").map(encodeURIComponent).join("/")}`, { signal: controller.signal });
      if (!response.ok) throw new Error("GitHub could not load a chart file. Try again later.");
      return response.text();
    };
    Promise.all([chartTree(from), chartTree(to)])
      .then(async ([before, after]) => {
        const files = [];
        for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
          if (before.get(path) === after.get(path)) continue;
          const [oldText, newText] = await Promise.all([readFile(from, path, before.has(path)), readFile(to, path, after.has(path))]);
          const oldLines = oldText ? oldText.split("\n") : [];
          const newLines = newText ? newText.split("\n") : [];
          let prefix = 0;
          while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
          let suffix = 0;
          while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
          const removed = oldLines.slice(prefix, oldLines.length - suffix);
          const added = newLines.slice(prefix, newLines.length - suffix);
          files.push({ filename: path, status: !before.has(path) ? "added" : !after.has(path) ? "removed" : "modified", additions: added.length, deletions: removed.length,
            patch: [`@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`, ...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)].join("\n") });
        }
        if (!controller.signal.aborted) setResult({ files });
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loading, from, to]);

  return (
    <section aria-label="Compare Helm charts" className="not-prose my-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-end gap-4">
        {[{ label: "From chart version", value: from, change: setFrom }, { label: "To chart version", value: to, change: setTo }].map(({ label, value, change }) => (
          <label key={label} className="flex min-w-0 flex-1 flex-col gap-2">
            <span>{label}</span>
            <select aria-label={label} value={value} onChange={(event) => change(event.target.value)} className="rounded-md border border-gray-300 bg-white p-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
              {versions.map((version) => <option key={version} value={version}>{version}</option>)}
            </select>
          </label>
        ))}
        <button type="button" disabled={!from || !to || from === to || loading} onClick={() => { setError(""); setResult(null); setLoading(true); }} className="rounded-md border border-gray-300 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600">
          {loading ? "Loading diff…" : "Compare charts"}
        </button>
      </div>
      <p className="mt-3 text-sm">Compare chart source files, including default values and templates. This compares the selected chart files directly, not rendered Kubernetes manifests or application code. Unchanged leading and trailing lines are omitted.</p>
      <div aria-live="polite" aria-busy={loading}>
        {from && from === to && <p className="mt-3">Select two different chart versions.</p>}
        {error && <p role="alert" className="mt-3">{error}</p>}
        {result && (
          <div className="mt-4">
            {!result.files.length && <p>No LangSmith chart source changes found in this comparison.</p>}
            {result.files.map((file) => (
              <details key={file.filename} className="mt-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
                <summary className="cursor-pointer break-all">{file.filename} ({file.status}, +{file.additions}, −{file.deletions})</summary>
                {file.patch ? <pre className="mt-3 overflow-x-auto text-xs"><code>{file.patch}</code></pre> : <p className="mt-3">The patch is unavailable or too large. View this file in the full GitHub comparison.</p>}
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
