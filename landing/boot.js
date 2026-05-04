(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const bootEl = document.getElementById("boot");
  const bootLog = document.getElementById("boot-log");
  const pageEl = document.getElementById("page");

  const bootLines = [
    "VITRONITOR // boot sequence v1.0",
    "[ OK ] memory replica .......... attached",
    "[ OK ] sync engine ............. armed",
    "[ OK ] ota signing key ......... verified",
    "[ OK ] platforms ............... web · ios · android · electron",
    "[ OK ] vital monitor ........... humming",
    "> SYSTEMS NOMINAL. AWAITING OPERATOR.",
  ];

  function showPage() {
    bootEl.classList.add("fade-out");
    pageEl.hidden = false;
    setTimeout(() => bootEl.remove(), 360);
    initInteractions();
  }

  function typewriter(lines, speed = 18) {
    let i = 0, j = 0;
    const tick = () => {
      if (i >= lines.length) {
        setTimeout(showPage, 380);
        return;
      }
      const line = lines[i];
      if (j <= line.length) {
        bootLog.textContent =
          lines.slice(0, i).join("\n") + (i ? "\n" : "") + line.slice(0, j) + "▌";
        j++;
        setTimeout(tick, speed);
      } else {
        bootLog.textContent = lines.slice(0, i + 1).join("\n");
        i++;
        j = 0;
        setTimeout(tick, 110);
      }
    };
    tick();
  }

  if (reduceMotion) {
    bootLog.textContent = bootLines.join("\n");
    setTimeout(showPage, 60);
  } else {
    typewriter(bootLines);
  }

  function initInteractions() {
    initUptime();
    initCopy();
    initEasterEgg();
  }

  // Uptime ticker
  function initUptime() {
    const el = document.getElementById("uptime");
    if (!el) return;
    const start = Date.now();
    const fmt = (n) => String(n).padStart(2, "0");
    const tick = () => {
      const s = Math.floor((Date.now() - start) / 1000);
      el.textContent = `${fmt(Math.floor(s / 3600))}:${fmt(Math.floor((s % 3600) / 60))}:${fmt(s % 60)}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  // Copy button
  function initCopy() {
    const btn = document.getElementById("copy");
    const snippet = document.getElementById("snippet");
    if (!btn || !snippet) return;

    const defaultEl = btn.querySelector("[data-copy-default]");
    const doneEl = btn.querySelector("[data-copy-done]");

    btn.addEventListener("click", async () => {
      // Plain text only: strip the leading "$ " prompt
      const text = snippet.innerText
        .split("\n")
        .map((line) => line.replace(/^\$\s?/, ""))
        .join("\n");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Fallback: use execCommand on a temp textarea
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch {}
        document.body.removeChild(ta);
      }
      btn.classList.add("done");
      defaultEl.hidden = true;
      doneEl.hidden = false;
      setTimeout(() => {
        btn.classList.remove("done");
        defaultEl.hidden = false;
        doneEl.hidden = true;
      }, 1600);
    });
  }

  // Easter egg: type "vitals"
  function initEasterEgg() {
    const overload = document.getElementById("overload");
    if (!overload) return;
    const target = "vitals";
    let buf = "";
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.length !== 1) return;
      buf = (buf + e.key.toLowerCase()).slice(-target.length);
      if (buf === target) {
        overload.hidden = false;
        setTimeout(() => { overload.hidden = true; }, 900);
      }
    });
  }
})();
