(() => {
  const root = document.querySelector("#root");
  const isStillLoading = () => !!root?.querySelector(".loading-shell");

  function showBootError(message) {
    if (!root || !isStillLoading()) return;
    root.innerHTML = `
      <main class="auth-wrap">
        <div class="auth-card">
          <div class="logo">CQ</div>
          <p class="eyebrow">CUTQUEST</p>
          <h2>Couldn’t start CutQuest</h2>
          <p class="muted">${String(message || "The app could not finish loading.")}</p>
          <button id="bootRetry" class="btn primary full">Retry</button>
        </div>
      </main>`;
    document.querySelector("#bootRetry")?.addEventListener("click", () => location.reload());
  }

  function loadScript(src, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        script.onload = script.onerror = null;
        script.remove();
        reject(new Error("Timed out loading " + src));
      }, timeoutMs);

      script.src = src;
      script.async = true;
      script.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.remove();
        reject(new Error("Could not load " + src));
      };
      document.head.appendChild(script);
    });
  }

  async function loadSupabase() {
    if (window.supabase) return;
    const sources = [
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.min.js",
      "https://unpkg.com/@supabase/supabase-js@2.117.1/dist/umd/supabase.min.js"
    ];
    let lastError = null;
    for (const src of sources) {
      try {
        await loadScript(src, 5000);
        if (window.supabase) return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Supabase client unavailable");
  }

  window.addEventListener("error", event => {
    if (isStillLoading()) showBootError(event.message || "A startup script failed.");
  });
  window.addEventListener("unhandledrejection", event => {
    if (isStillLoading()) showBootError(event.reason?.message || "A startup request failed.");
  });

  setTimeout(() => {
    if (isStillLoading()) {
      showBootError("Startup is taking too long. Check your connection and tap Retry.");
    }
  }, 15000);

  (async () => {
    try {
      if (!window.CUTQUEST_CONFIG) throw new Error("Missing CutQuest configuration.");
      await loadSupabase();
      await loadScript("./app.js?v=16", 5000);
      await loadScript("./manual-log.js?v=16", 5000);
    } catch (err) {
      showBootError(err?.message || "The app could not finish loading.");
    }
  })();
})();