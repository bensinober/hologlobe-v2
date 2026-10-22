// Hologlobe UI — web components, served from the Zig server at /script.js.
// The DRAW mode is intentionally hidden from the UI (it still exists server-side).

const MODES = ["IDLE", "CALIBRATE", "ANIMATION", "RUNONCE"]

const HINTS = {
  IDLE: "Edit an image and send it to the hologlobe.",
  CALIBRATE: "Running the calibration pattern. Press STOP or IDLE to end.",
  ANIMATION: "Animating on the hologlobe. Press STOP or IDLE to end.",
  RUNONCE: "Rendering one pass, then back to idle.",
}

const BASE_CSS = `
<style>
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    color: #dbe6f0;
    padding: 0.55em 1.1em;
    transition: background 0.15s ease, border-color 0.15s ease,
                box-shadow 0.15s ease, transform 0.05s ease;
  }
  /* only neutral buttons get the plain hover; primary/active keep their look */
  button:not(.primary):not(.active):hover { background: rgba(255, 255, 255, 0.12); }
  button:active { transform: translateY(1px); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #041016;
    font-weight: 700;
  }
  button.primary:hover { filter: brightness(1.1); }
  button:disabled { opacity: 0.55; cursor: default; }
</style>
`

// ---------------------------------------------------------------------------
// <holo-mode-switcher> — mode buttons with live active state (polls /getMode)
// ---------------------------------------------------------------------------
class HoloModeSwitcher extends HTMLElement {
  #timer = null
  #mode = "IDLE"
  #buttons = {}

  connectedCallback() {
    const root = this.attachShadow({ mode: "open" })
    root.innerHTML = `
      <style>
        :host { display: block; --accent: #3ce8ff; }
        .modes { display: grid; gap: 10px; }
        button { width: 100%; font-weight: 600; letter-spacing: 0.04em; }
        button.active {
          background: var(--accent);
          border-color: var(--accent);
          color: #041016;
          font-weight: 700;
          box-shadow: 0 0 18px rgba(60, 232, 255, 0.45);
        }
        button.active:hover { filter: brightness(1.05); }
      </style>
      ${BASE_CSS}
      <div class="modes" role="group" aria-label="LED mode"></div>
    `
    const wrap = root.querySelector(".modes")
    for (const mode of MODES) {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = mode
      b.dataset.mode = mode
      b.title = mode === "RUNONCE" ? "Render one pass, then return to idle" : `Switch to ${mode} mode`
      b.addEventListener("click", () => this.setMode(mode))
      wrap.appendChild(b)
      this.#buttons[mode] = b
    }
    this.#refresh()
    this.#timer = setInterval(() => this.#refresh(), 1000)
  }

  disconnectedCallback() {
    clearInterval(this.#timer)
  }

  get mode() {
    return this.#mode
  }

  async setMode(mode) {
    try {
      await fetch(`/setMode/${mode}`)
    } catch (err) {
      console.error("setMode failed:", err)
    }
    this.#refresh()
  }

  async #refresh() {
    let mode
    try {
      const res = await fetch("/getMode", { cache: "no-store" })
      if (!res.ok) return
      const text = (await res.text()).trim()
      // DRAW is hidden in this UI; anything unknown or DRAW reads as IDLE
      mode = MODES.includes(text) ? text : "IDLE"
    } catch {
      return // device unreachable; keep last known state
    }
    const changed = mode !== this.#mode
    this.#mode = mode
    this.#paintActive()
    if (changed) {
      this.dispatchEvent(
        new CustomEvent("modechange", { detail: { mode }, bubbles: true, composed: true })
      )
    }
  }

  #paintActive() {
    for (const [mode, b] of Object.entries(this.#buttons)) {
      const active = mode === this.#mode
      b.classList.toggle("active", active)
      b.setAttribute("aria-pressed", String(active))
    }
  }
}
customElements.define("holo-mode-switcher", HoloModeSwitcher)

// ---------------------------------------------------------------------------
// <holo-pixel-grid> — pixel editor + toolbar
// ---------------------------------------------------------------------------
class HoloPixelGrid extends HTMLElement {
  #root = null
  #grid = null
  #drawing = false
  #color = "#ffffff"

  get cols() { return Number(this.getAttribute("cols")) || 56 }
  get rows() { return Number(this.getAttribute("rows")) || 112 }
  get mode() { return this.getAttribute("mode") || "IDLE" }

  connectedCallback() {
    const root = this.attachShadow({ mode: "open" })
    this.#root = root
    root.innerHTML = `
      <style>
        :host { display: block; --accent: #3ce8ff; --cell: 6px; }
        .toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .toolbar button { padding: 0.45em 0.9em; }
        input[type="color"] {
          inline-size: 2.4em;
          block-size: 2.4em;
          padding: 0;
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 8px;
          background: transparent;
          cursor: pointer;
        }
        input[type="file"] { display: none; }
        .upload {
          display: inline-block;
          cursor: pointer;
          border-radius: 999px;
          border: 1px dashed rgba(255, 255, 255, 0.3);
          padding: 0.5em 1em;
          color: #b9c6d4;
        }
        .upload:hover { background: rgba(255, 255, 255, 0.08); }
        .grid-wrap {
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          background: #04070c;
          padding: 10px;
          overflow: auto;
          /* extend to the bottom of the viewport (dvh when supported) */
          max-height: calc(100vh - 180px);
          max-height: calc(100dvh - 180px);
        }
        #grid {
          display: grid;
          gap: 1px;
          background: #0a0f18;
          border: 1px solid #ffffff;
          width: fit-content;
          margin-inline: auto;
          touch-action: none;
          user-select: none;
        }
        .pixel {
          width: var(--cell);
          height: var(--cell);
          background: #000000;
        }
        /* the editor only makes sense when the device is not busy */
        :host([mode="CALIBRATE"]) .toolbar,
        :host([mode="CALIBRATE"]) .grid-wrap,
        :host([mode="ANIMATION"]) .toolbar,
        :host([mode="ANIMATION"]) .grid-wrap { display: none; }
      </style>
      ${BASE_CSS}
      <div class="toolbar">
        <button id="clear" type="button">T&oslash;m</button>
        <input type="color" id="color" value="#ffffff" title="Pixel color" />
        <label class="upload">Last opp bilde<input type="file" id="file" accept="image/*" /></label>
        <button id="download" type="button">Last ned PNG</button>
        <button id="send" type="button" class="primary">Send to hologlobe</button>
      </div>
      <div class="grid-wrap"><div id="grid"></div></div>
    `

    this.#grid = root.getElementById("grid")
    root.getElementById("clear").addEventListener("click", () => this.clearCanvas())
    root.getElementById("download").addEventListener("click", () => this.download())
    root.getElementById("send").addEventListener("click", () => this.sendImage())
    root.getElementById("file").addEventListener("change", (e) => this.loadPixels(e))
    const colorInput = root.getElementById("color")
    colorInput.addEventListener("input", (e) => { this.#color = e.target.value })

    this.#grid.addEventListener("pointerdown", (e) => this.#startDraw(e))
    this.#grid.addEventListener("pointermove", (e) => this.#moveDraw(e))
    window.addEventListener("pointerup", () => { this.#drawing = false })

    this.createGrid()
  }

  createGrid() {
    const { cols, rows } = this
    this.#grid.innerHTML = ""
    this.#grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell))`
    this.#grid.style.gridTemplateRows = `repeat(${rows}, var(--cell))`
    const frag = document.createDocumentFragment()
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const pixel = document.createElement("div")
        pixel.className = "pixel"
        pixel.dataset.x = x
        pixel.dataset.y = y
        frag.appendChild(pixel)
      }
    }
    this.#grid.appendChild(frag)
  }

  clearCanvas() {
    this.createGrid()
  }

  // --- drawing (pointer events cover mouse + touch) ---

  #startDraw(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return
    this.#drawing = true
    // paint via elementFromPoint + coordinates, so implicit pointer capture
    // on touch does not matter (moves still report clientX/Y correctly)
    this.#paintAt(e.clientX, e.clientY)
    e.preventDefault()
  }

  #moveDraw(e) {
    if (!this.#drawing) return
    this.#paintAt(e.clientX, e.clientY)
    e.preventDefault()
  }

  #paintAt(x, y) {
    const el = this.#root.elementFromPoint(x, y)
    if (el && el.classList.contains("pixel")) {
      el.style.backgroundColor = this.#color
    }
  }

  // --- image import/export ---

  // renders the current grid into an offscreen canvas at grid resolution
  #toCanvas() {
    const { cols, rows } = this
    const canvas = document.createElement("canvas")
    canvas.width = cols
    canvas.height = rows
    const ctx = canvas.getContext("2d")
    this.#root.querySelectorAll(".pixel").forEach((pixel, index) => {
      const x = index % cols
      const y = Math.floor(index / cols)
      ctx.fillStyle = pixel.style.backgroundColor || "#000000"
      ctx.fillRect(x, y, 1, 1)
    })
    return canvas
  }

  // load image and pixelate to canvas grid size (rotated 90 deg, as the strips read it)
  loadPixels(evt) {
    const input = evt.target
    const file = input.files[0]
    if (!file) {
      alert("Please select an image to upload.")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const { cols, rows } = this
        const tempCanvas = document.createElement("canvas")
        const ctx = tempCanvas.getContext("2d")
        const scale = cols / img.height
        tempCanvas.width = cols
        tempCanvas.height = rows
        ctx.setTransform(
          0, scale,      // x axis down the screen
          -scale, 0,     // y axis across the screen from right to left
          cols,          // x origin is on the right side of the canvas
          0              // y origin is at the top
        )
        ctx.drawImage(img, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)

        const imageData = ctx.getImageData(0, 0, cols, rows).data
        this.createGrid()
        const pixels = this.#root.querySelectorAll(".pixel")
        for (let i = 0; i < imageData.length; i += 4) {
          const r = imageData[i]
          const g = imageData[i + 1]
          const b = imageData[i + 2]
          const hexColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
          const pixelElement = pixels[i / 4]
          if (pixelElement) pixelElement.style.backgroundColor = hexColor
        }
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
    input.value = "" // allow re-selecting the same file later
  }

  async sendImage() {
    const canvas = this.#toCanvas()
    const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
    const button = this.#root.getElementById("send")
    button.disabled = true
    try {
      const res = await fetch("/uploadRawImg", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: bytes,
      })
      if (res.ok) {
        console.log("Image uploaded to hologlobe")
      } else {
        console.error("Failed to upload image:", res.status, res.statusText)
      }
    } catch (err) {
      console.error("Upload failed:", err)
    } finally {
      button.disabled = false
    }
  }

  download() {
    const link = document.createElement("a")
    link.download = "pixel_art.png"
    link.href = this.#toCanvas().toDataURL("image/png")
    link.click()
  }
}
customElements.define("holo-pixel-grid", HoloPixelGrid)

// ---------------------------------------------------------------------------
// <holo-app> — page shell: header, status, mode switcher, editor
// ---------------------------------------------------------------------------
class HoloApp extends HTMLElement {
  #grid = null
  #switcher = null
  #status = null
  #modeLabel = null
  #stopBtn = null
  #hint = null

  connectedCallback() {
    const root = this.attachShadow({ mode: "open" })
    const rows = this.getAttribute("rows") || 112
    const cols = this.getAttribute("cols") || 56
    root.innerHTML = `
      <style>
        :host { display: block; width: min(100%, 980px); padding: 24px 16px 48px; --accent: #3ce8ff; }
        header {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }
        h1 {
          margin: 0;
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: 0.06em;
        }
        h1 .dim { color: #7f93a8; font-weight: 400; }
        .status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0.35em 0.9em;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.05);
          font-size: 0.8rem;
          letter-spacing: 0.08em;
        }
        .status .dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #66788a;
        }
        .status[data-mode="ANIMATION"] .dot {
          background: #3ce8ff;
          box-shadow: 0 0 10px #3ce8ff;
          animation: pulse 1s ease-in-out infinite;
        }
        .status[data-mode="CALIBRATE"] .dot { background: #ffb454; box-shadow: 0 0 10px #ffb454; }
        .status[data-mode="RUNONCE"] .dot { background: #b07bff; box-shadow: 0 0 10px #b07bff; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        #fs { margin-left: auto; }
        main {
          display: flex;
          gap: 20px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .panel {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 16px;
        }
        .canvas-panel { flex: 1 1 360px; min-width: 300px; }
        .side-panel {
          flex: 0 0 220px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          position: sticky;
          top: 16px;
        }
        .side-panel h2 {
          margin: 0;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #7f93a8;
        }
        #stop {
          border-color: #ff5d73;
          color: #ff8b9c;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        #stop:hover { background: rgba(255, 93, 115, 0.15); }
        #stop[hidden] { display: none; }
        #hint {
          margin: 0;
          font-size: 0.82rem;
          line-height: 1.45;
          color: #9db0c2;
        }
        h2.section {
          margin: 0 0 10px;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #7f93a8;
        }
      </style>
      ${BASE_CSS}
      <header>
        <h1>Hologlobe <span class="dim">(${cols}&times;${rows})</span></h1>
        <div class="status" id="status" data-mode="IDLE" aria-live="polite">
          <span class="dot"></span><span id="modeLabel">IDLE</span>
        </div>
        <button id="fs" type="button">Fullskjerm</button>
      </header>
      <main>
        <section class="panel canvas-panel">
          <h2 class="section">Editor</h2>
          <holo-pixel-grid id="grid" rows="${rows}" cols="${cols}" mode="IDLE"></holo-pixel-grid>
        </section>
        <aside class="panel side-panel">
          <h2>Mode</h2>
          <holo-mode-switcher id="switcher"></holo-mode-switcher>
          <button id="stop" type="button" hidden>STOP</button>
          <p id="hint"></p>
        </aside>
      </main>
    `

    this.#grid = root.getElementById("grid")
    this.#switcher = root.getElementById("switcher")
    this.#status = root.getElementById("status")
    this.#modeLabel = root.getElementById("modeLabel")
    this.#stopBtn = root.getElementById("stop")
    this.#hint = root.getElementById("hint")

    this.#stopBtn.addEventListener("click", () => this.#switcher.setMode("IDLE"))
    root.getElementById("fs").addEventListener("click", () => this.#toggleFullscreen())
    this.addEventListener("modechange", (e) => this.#applyMode(e.detail.mode))
    this.#applyMode("IDLE")
  }

  #applyMode(mode) {
    this.#grid.setAttribute("mode", mode)
    this.#status.dataset.mode = mode
    this.#modeLabel.textContent = mode
    this.#stopBtn.hidden = mode !== "ANIMATION" && mode !== "CALIBRATE"
    this.#hint.textContent = HINTS[mode] ?? ""
  }

  #toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      this.requestFullscreen().catch(() => {})
    }
  }
}
customElements.define("holo-app", HoloApp)
