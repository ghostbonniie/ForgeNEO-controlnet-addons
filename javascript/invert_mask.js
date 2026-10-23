// Four buttons on every Forge drawing canvas (ControlNet units, inpaint), lives outside modules_forge so a
// Forge update can't wipe it:
//   ◐ Invert: painted becomes unpainted and the other way round.
//   ✦ Click select: while on, each click on a piece of clothing adds that whole object (SAM2, server side).
//   ➰ Lasso: drag around an area to fill it.
//   Magic wand: click selects the connected area of similar colour; a strength slider sets how similar.
// Both write through the canvas's own foreground textbox: ForgeCanvas polls it, redraws, and saves an
// undo step, so Ctrl+Z undoes them and the backend gets the new mask (it reads alpha only).
(function () {
    // keep the look: checker strokes when the canvas is in high-contrast mode (ForgeCanvas sets opacity 0.5), else the brush colour
    function fillStyle(ctx, uuid) {
        if (document.getElementById(`drawingCanvas_${uuid}`).style.opacity === "0.5") {
            const tile = document.createElement("canvas"), s = 10;
            tile.width = tile.height = s * 2;
            const t = tile.getContext("2d");
            t.fillStyle = "#ffffff"; t.fillRect(0, 0, s, s); t.fillRect(s, s, s, s);
            t.fillStyle = "#000000"; t.fillRect(s, 0, s, s); t.fillRect(0, s, s, s);
            return ctx.createPattern(tile, "repeat");
        }
        return (document.getElementById(`scribbleColor_${uuid}`) || {}).value || "#ffffff";
    }

    function invertedDataUrl(uuid) {
        const src = document.getElementById(`drawingCanvas_${uuid}`);
        const out = document.createElement("canvas");
        out.width = src.width; out.height = src.height;
        const ctx = out.getContext("2d");
        ctx.fillStyle = fillStyle(ctx, uuid);
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.globalCompositeOperation = "destination-out";  // new alpha = 1 - old alpha
        ctx.drawImage(src, 0, 0);
        return out.toDataURL("image/png");
    }

    // current drawing + a grey mask PNG (white = selected), painted in the brush style
    async function addedDataUrl(uuid, maskUrl) {
        const src = document.getElementById(`drawingCanvas_${uuid}`);
        const w = src.width, h = src.height;
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = maskUrl; });
        const m = document.createElement("canvas");
        m.width = w; m.height = h;
        const mc = m.getContext("2d");
        mc.drawImage(img, 0, 0, w, h);
        const d = mc.getImageData(0, 0, w, h);
        for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = d.data[i];  // grey -> alpha
        mc.putImageData(d, 0, 0);
        const out = document.createElement("canvas");
        out.width = w; out.height = h;
        const ctx = out.getContext("2d");
        ctx.fillStyle = fillStyle(ctx, uuid);
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";  // keep the fill only where selected
        ctx.drawImage(m, 0, 0);
        ctx.globalCompositeOperation = "destination-over";  // old strokes underneath
        ctx.drawImage(src, 0, 0);
        return out.toDataURL("image/png");
    }

    // current drawing + the lasso polygon filled in the brush style
    function lassoDataUrl(uuid, pts) {
        const src = document.getElementById(`drawingCanvas_${uuid}`);
        const out = document.createElement("canvas");
        out.width = src.width; out.height = src.height;
        const ctx = out.getContext("2d");
        ctx.drawImage(src, 0, 0);
        ctx.fillStyle = fillStyle(ctx, uuid);
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.fill();
        return out.toDataURL("image/png");
    }

    // magic wand: the grey mask (white = selected) for the area CONNECTED to (x0, y0) that stays close to the
    // colour at the click. Three rules keep it from running off:
    //  1. every pixel must be within `tol` (0-255, per channel) of the CLICKED colour, so a slow gradient cannot
    //     creep far away;
    //  2. it only moves between touching pixels, so a distant patch of the same colour is never taken;
    //  3. it will not step across a sharp edge (outline, lace border, a different garment): the colour jump
    //     between two neighbouring pixels must stay under a limit that grows with `tol`.
    // The clicked colour is the median of the 3x3 pixels around the click, so a single noisy or sparkly pixel
    // does not decide everything.
    function wandMaskUrl(image, w, h, x0, y0, tol, fill) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const cx = c.getContext("2d", { willReadFrequently: true });
        cx.drawImage(image, 0, 0, w, h);
        const px = cx.getImageData(0, 0, w, h).data;
        const s = y0 * w + x0;
        const rs = [], gs = [], bs = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = x0 + dx, y = y0 + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const p = (y * w + x) * 4;
            rs.push(px[p]); gs.push(px[p + 1]); bs.push(px[p + 2]);
        }
        const mid = a => a.sort((m, n) => m - n)[a.length >> 1];  // median: one odd pixel cannot move it
        const r0 = mid(rs), g0 = mid(gs), b0 = mid(bs);
        px[s * 4] = r0; px[s * 4 + 1] = g0; px[s * 4 + 2] = b0;  // the first step compares against that colour too
        const edge = 24 + tol * 0.5;  // biggest colour jump allowed between two neighbouring pixels
        const near = (i, j) => {  // may the fill step from pixel i to its neighbour j?
            const p = j * 4, q = i * 4;
            return Math.abs(px[p] - r0) <= tol && Math.abs(px[p + 1] - g0) <= tol && Math.abs(px[p + 2] - b0) <= tol
                && Math.abs(px[p] - px[q]) <= edge && Math.abs(px[p + 1] - px[q + 1]) <= edge && Math.abs(px[p + 2] - px[q + 2]) <= edge;
        };
        const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
        const out = cx.createImageData(w, h);  // starts transparent black = not selected
        let top = 0;
        seen[s] = 1; stack[top++] = s;
        while (top) {
            const i = stack[--top], x = i % w;
            out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = out.data[i * 4 + 3] = 255;
            if (x > 0 && !seen[i - 1] && near(i, i - 1)) { seen[i - 1] = 1; stack[top++] = i - 1; }
            if (x < w - 1 && !seen[i + 1] && near(i, i + 1)) { seen[i + 1] = 1; stack[top++] = i + 1; }
            if (i >= w && !seen[i - w] && near(i, i - w)) { seen[i - w] = 1; stack[top++] = i - w; }
            if (i < w * (h - 1) && !seen[i + w] && near(i, i + w)) { seen[i + w] = 1; stack[top++] = i + w; }
        }
        if (fill) {
            // Fill small gaps that the selection completely surrounds (a shiny highlight, an eye): find every
            // unselected pixel that can reach the image border, the rest are enclosed pockets, and take each
            // pocket that is small. A big enclosed pocket (a whole garment) is left alone.
            const cap = Math.max(40, Math.round(w * h * 0.005));
            const mark = new Uint8Array(w * h);  // 1 = unselected and connected to the border, 2 = a pocket being measured
            let t = 0;
            const around = (i, f) => {
                const x = i % w;
                if (x > 0) f(i - 1);
                if (x < w - 1) f(i + 1);
                if (i >= w) f(i - w);
                if (i < w * (h - 1)) f(i + w);
            };
            const outside = j => { if (!seen[j] && !mark[j]) { mark[j] = 1; stack[t++] = j; } };
            for (let x = 0; x < w; x++) { outside(x); outside((h - 1) * w + x); }
            for (let y = 0; y < h; y++) { outside(y * w); outside(y * w + w - 1); }
            while (t) around(stack[--t], outside);
            const pocket = new Int32Array(w * h);
            let n = 0;
            const grow = j => { if (!seen[j] && !mark[j]) { mark[j] = 2; stack[t++] = j; } };
            for (let s0 = 0; s0 < w * h; s0++) {
                if (seen[s0] || mark[s0]) continue;
                n = 0; t = 0; mark[s0] = 2; stack[t++] = s0;
                while (t) { const i = stack[--t]; pocket[n++] = i; around(i, grow); }
                if (n <= cap) for (let k = 0; k < n; k++) {
                    const q = pocket[k] * 4;
                    out.data[q] = out.data[q + 1] = out.data[q + 2] = out.data[q + 3] = 255;
                }
            }
        }
        cx.putImageData(out, 0, 0);
        return c.toDataURL("image/png");
    }

    function makeButton(uuid, id, title, text) {
        const btn = document.createElement("button");
        btn.id = `${id}_${uuid}`;
        btn.className = "forge-btn";
        btn.title = title;
        btn.textContent = text;
        return btn;
    }

    function addButtons() {
        document.querySelectorAll('[id^="toolbar_"]').forEach(bar => {
            const uuid = bar.id.slice("toolbar_".length);
            const boxB = bar.querySelector(".forge-toolbar-box-b");
            if (!boxB) return;
            const old = document.getElementById(`invertButton_${uuid}`);
            // ForgeCanvas may init after us and hide the brush tools (preview canvases): follow it
            if (old) {
                const hide = boxB.style.display === "none" ? "none" : "";
                old.style.display = hide;
                document.getElementById(`selectButton_${uuid}`).style.display = hide;
                document.getElementById(`lassoButton_${uuid}`).style.display = hide;
                const wb = document.getElementById(`wandButton_${uuid}`);
                if (wb) wb.style.display = hide;
                return;
            }
            const ta = document.querySelector(`#${CSS.escape(uuid)}.logical_image_foreground textarea`);
            const redo = document.getElementById(`redoButton_${uuid}`);
            const container = document.getElementById(`container_${uuid}`);
            const canvas = document.getElementById(`drawingCanvas_${uuid}`);
            const image = document.getElementById(`image_${uuid}`);
            if (!ta || !redo || !container || !canvas || !image) return;
            const loaded = () => image.style.display !== "none" && image.src.startsWith("data:");

            const inv = makeButton(uuid, "invertButton", "Invert mask (Ctrl+Z to undo)", "◐");
            inv.addEventListener("click", e => {
                e.preventDefault();
                if (loaded()) ta.value = invertedDataUrl(uuid);  // the canvas's own poller picks this up within 100 ms
            });

            const sel = makeButton(uuid, "selectButton", "Click select: turn on, then click each piece of clothing (Ctrl+Z undoes a click, Esc or click again to stop)", "✦");
            const las = makeButton(uuid, "lassoButton", "Lasso: turn on, then drag around an area to fill it (Ctrl+Z undoes, Esc or click again to stop)", "➰");
            // Magic wand: click selects the connected area of similar colour; the slider sets how similar.
            // Inline SVG instead of an emoji so it shows on every system and font.
            const wand = makeButton(uuid, "wandButton", "Magic wand: turn on, then click an area to select the connected part of similar colour. Use the strength slider to choose how similar; click again with a higher strength to grow it (Ctrl+Z undoes, Esc or click again to stop)", "");
            wand.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle"><path d="M4 20 L14 10"/><path d="M16 3v4M14 5h4M20 10v3M18.5 11.5h3"/></svg>';
            // The slider is one more row in the toolbar's second box, built with Forge's own classes so it
            // looks like Brush Width / Alpha / Softness and sits inside the floating toolbar (outside it, it
            // stretched across the canvas and its label hid behind the toolbar).
            const wandPanel = document.createElement("div");
            wandPanel.id = `wandPanel_${uuid}`;
            wandPanel.className = "forge-range-row";
            wandPanel.style.display = "none";
            const wandLabel = document.createElement("div");
            wandLabel.className = "forge-toolbar-label";
            const wandSlider = document.createElement("input");
            wandSlider.type = "range"; wandSlider.className = "forge-toolbar-range";
            wandSlider.min = "0"; wandSlider.max = "100"; wandSlider.value = "20";
            const showStrength = () => { wandLabel.textContent = `Wand Strength (${wandSlider.value})`; };
            wandSlider.addEventListener("input", showStrength);
            showStrength();
            const fillLabel = document.createElement("label");
            fillLabel.className = "forge-toolbar-label";
            fillLabel.style.cssText = "font-size:12px;gap:4px;cursor:pointer";
            fillLabel.title = "Also select small gaps that the selection completely surrounds, like a shiny highlight. Big gaps (a whole piece of clothing) stay out.";
            const fillBox = document.createElement("input");
            fillBox.type = "checkbox"; fillBox.checked = true;
            fillLabel.append(fillBox, "Fill gaps");
            wandPanel.append(wandLabel, wandSlider, fillLabel);
            boxB.append(wandPanel);
            // squared, so the low end is fine-grained: 20 -> 10, 40 -> 41, 50 -> 64, 75 -> 143, 100 -> 255
            const wandTolerance = () => Math.round((+wandSlider.value / 100) ** 2 * 255);

            // one mode at a time: null, "select", "lasso" or "wand"
            let mode = null, busy = false, pts = null, snap = null;
            const ctx = canvas.getContext("2d");
            const setMode = m => {
                mode = m;
                sel.style.outline = m === "select" ? "2px solid #f5a623" : "";
                las.style.outline = m === "lasso" ? "2px solid #f5a623" : "";
                wand.style.outline = m === "wand" ? "2px solid #f5a623" : "";
                wandPanel.style.display = m === "wand" ? "" : "none";  // "" = the row's own flex column
                canvas.style.cursor = m ? "crosshair" : "";
            };
            const cancelLasso = () => { if (pts) ctx.putImageData(snap, 0, 0); pts = snap = null; };
            sel.addEventListener("click", e => { e.preventDefault(); cancelLasso(); setMode(mode === "select" ? null : "select"); });
            las.addEventListener("click", e => { e.preventDefault(); cancelLasso(); setMode(mode === "lasso" ? null : "lasso"); });
            wand.addEventListener("click", e => { e.preventDefault(); cancelLasso(); setMode(mode === "wand" ? null : "wand"); });
            document.addEventListener("keydown", e => { if (mode && e.key === "Escape") { cancelLasso(); setMode(null); } });
            const xy = e => {
                const r = canvas.getBoundingClientRect();
                return [(e.clientX - r.left) / r.width * canvas.width, (e.clientY - r.top) / r.height * canvas.height];
            };
            // lasso: preview line drawn on the canvas, restored before the real fill is written
            container.addEventListener("pointermove", e => {
                if (mode !== "lasso" || !pts) return;
                e.stopPropagation();
                pts.push(xy(e));
                ctx.putImageData(snap, 0, 0);
                ctx.save();
                ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
                ctx.strokeStyle = "#f5a623"; ctx.lineWidth = Math.max(2, canvas.width / 400);
                ctx.beginPath();
                pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
                ctx.stroke();
                ctx.restore();
            }, true);
            container.addEventListener("pointerup", e => {
                if (mode !== "lasso" || !pts) return;
                e.stopPropagation();
                const done = pts;
                cancelLasso();
                if (done.length > 2) ta.value = lassoDataUrl(uuid, done);  // the canvas's own poller picks this up
            }, true);
            // capture on the parent so this runs before ForgeCanvas starts a brush stroke
            container.addEventListener("pointerdown", async e => {
                if (!mode || e.button !== 0 || e.target !== canvas || !loaded()) return;
                e.preventDefault(); e.stopPropagation();
                if (mode === "lasso") {
                    snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    pts = [xy(e)];
                    canvas.setPointerCapture(e.pointerId);
                    return;
                }
                if (busy) return;
                const [x, y] = xy(e).map(Math.round);
                if (mode === "wand") {
                    const w = canvas.width, h = canvas.height;
                    if (x < 0 || y < 0 || x >= w || y >= h) return;
                    busy = true;
                    try { ta.value = await addedDataUrl(uuid, wandMaskUrl(image, w, h, x, y, wandTolerance(), fillBox.checked)); }
                    catch (err) { alert("Magic wand failed: " + err); }
                    busy = false;
                    return;
                }
                busy = true; sel.textContent = "…"; canvas.style.cursor = "progress";
                try {
                    const res = await (await fetch("/invert_mask/select", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ image: image.src, x, y }) })).json();
                    if (res.error) alert("Click select: " + res.error);
                    else ta.value = await addedDataUrl(uuid, res.mask);
                } catch (err) { alert("Click select failed: " + err); }
                busy = false; sel.textContent = "✦"; canvas.style.cursor = mode ? "crosshair" : "";
            }, true);

            redo.after(inv);
            inv.after(sel);
            sel.after(las);
            las.after(wand);
        });
    }

    onUiLoaded(addButtons);
    onUiUpdate(addButtons);  // ponytail: cheap id check per update; catches canvases rendered late
})();
