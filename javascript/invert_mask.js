// Five buttons on every Forge drawing canvas (ControlNet units, inpaint), lives outside modules_forge so a
// Forge update can't wipe it:
//   ◐ Invert: painted becomes unpainted and the other way round.
//   ✦ Click select: while on, each click on a piece of clothing adds that whole object (SAM2, server side).
//   ➰ Lasso: drag around an area to fill it.
//   Magic wand: click selects the connected area of similar colour; a strength slider sets how similar.
//   − Subtract: while on (red), click select / lasso / the wand REMOVE from the selection instead of adding.
//     Holding Alt while clicking does the opposite of the switch for that one click.
// They all write through the canvas's own foreground textbox: ForgeCanvas polls it, redraws, and saves an
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

    // a grey mask PNG (white = selected) as a canvas whose ALPHA is the mask
    async function maskAlphaCanvas(maskUrl, w, h) {
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = maskUrl; });
        const m = document.createElement("canvas");
        m.width = w; m.height = h;
        const mc = m.getContext("2d");
        mc.drawImage(img, 0, 0, w, h);
        const d = mc.getImageData(0, 0, w, h);
        for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = d.data[i];  // grey -> alpha
        mc.putImageData(d, 0, 0);
        return m;
    }

    // current drawing + a grey mask PNG (white = selected), painted in the brush style
    async function addedDataUrl(uuid, maskUrl) {
        const src = document.getElementById(`drawingCanvas_${uuid}`);
        const w = src.width, h = src.height;
        const m = await maskAlphaCanvas(maskUrl, w, h);
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

    // current drawing with the masked area taken out. Only the mask's alpha matters here, so the brush colour,
    // the high-contrast checker mode and soft or half-transparent strokes are all handled the same way.
    async function subtractedDataUrl(uuid, maskUrl, tidy) {
        const src = document.getElementById(`drawingCanvas_${uuid}`);
        const w = src.width, h = src.height;
        const m = await maskAlphaCanvas(maskUrl, w, h);
        const out = document.createElement("canvas");
        out.width = w; out.height = h;
        const ctx = out.getContext("2d");
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(m, 0, 0);
        if (tidy) tidyLeftovers(ctx, m, w, h);
        const url = out.toDataURL("image/png");
        if (!url.startsWith("data:image/png")) throw new Error("the canvas is empty");
        return url;
    }

    // After a wand removal: clear loose leftovers of selection that sit right next to the removed area. A leftover
    // goes if it is a speck (up to 0.05% of the picture) or a thin sliver (narrower than about 2.4% of the picture's
    // longer side, such as the dark rim where a shade changes) that has been cut off from the rest of the selection.
    // Wide areas and anything still joined to the main selection are left alone.
    function tidyLeftovers(ctx, m, w, h) {
        const md = m.getContext("2d").getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (md[(y * w + x) * 4 + 3] > 127) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) return;
        const R = 3, SPECK = Math.max(50, Math.round(w * h * 0.0005)), SLIVER_MAX = Math.round(w * h * 0.05);
        const HALF = Math.max(3, Math.round(Math.max(w, h) * 0.012));  // a piece with no (2*HALF+1)-px square inside is thin
        const img = ctx.getImageData(0, 0, w, h), a = img.data;
        const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
        const near = (x, y) => {  // within R px of the removed area?
            for (let j = Math.max(y0, y - R); j <= Math.min(y1, y + R); j++)
                for (let i = Math.max(x0, x - R); i <= Math.min(x1, x + R); i++) if (md[(j * w + i) * 4 + 3] > 127) return true;
            return false;
        };
        const thin = comp => {
            let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
            for (const n of comp) { const x = n % w, y = (n - x) / w; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
            const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, side = 2 * HALF + 1;
            if (bw < side || bh < side) return true;
            const W1 = bw + 1, sum = new Int32Array(W1 * (bh + 1));  // integral image of the piece
            const m2 = new Uint8Array(bw * bh);
            for (const n of comp) { const x = n % w; m2[(((n - x) / w) - by0) * bw + (x - bx0)] = 1; }
            for (let y = 0; y < bh; y++) { let row = 0; for (let x = 0; x < bw; x++) { row += m2[y * bw + x]; sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + row; } }
            for (let y = 0; y + side <= bh; y++) for (let x = 0; x + side <= bw; x++)
                if (sum[(y + side) * W1 + x + side] - sum[y * W1 + x + side] - sum[(y + side) * W1 + x] + sum[y * W1 + x] === side * side) return false;
            return true;
        };
        let changed = false;
        for (let y = Math.max(0, y0 - R); y <= Math.min(h - 1, y1 + R); y++) for (let x = Math.max(0, x0 - R); x <= Math.min(w - 1, x1 + R); x++) {
            const s = y * w + x;
            if (seen[s] || !a[s * 4 + 3] || !near(x, y)) continue;
            const comp = [s]; let t = 0, big = false; seen[s] = 1; stack[t++] = s;
            while (t) {  // 8-connected flood over the whole piece of remaining selection
                const q = stack[--t], qx = q % w, qy = (q - qx) / w;
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const nx = qx + dx, ny = qy + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const n = ny * w + nx;
                    if (seen[n] || !a[n * 4 + 3]) continue;
                    seen[n] = 1; stack[t++] = n;
                    if (big) continue;
                    comp.push(n);
                    if (comp.length > SLIVER_MAX) { big = true; comp.length = 0; }
                }
            }
            if (!big && (comp.length <= SPECK || thin(comp))) { for (const n of comp) a[n * 4 + 3] = 0; changed = true; }
        }
        if (changed) ctx.putImageData(img, 0, 0);
    }

    // current drawing + the lasso polygon filled in the brush style (or, with `subtract`, cut out of it)
    function lassoDataUrl(uuid, pts, subtract) {
        const src = document.getElementById(`drawingCanvas_${uuid}`);
        const out = document.createElement("canvas");
        out.width = src.width; out.height = src.height;
        const ctx = out.getContext("2d");
        ctx.drawImage(src, 0, 0);
        if (subtract) ctx.globalCompositeOperation = "destination-out";
        else ctx.fillStyle = fillStyle(ctx, uuid);
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.fill();
        return out.toDataURL("image/png");
    }

    // ---- magic wand -------------------------------------------------------------------------------------------
    // Colours are compared in CIE Lab, not RGB. Lab separates BRIGHTNESS (L) from COLOUR (a, b), so shading may
    // change a lot (skin from lit to shadow) while a change of colour (skin -> grey fence, blue sky, white hair)
    // still counts as a real difference. In RGB a dark skin tone and a dark grey fence are close together.
    const LIN = (() => {  // sRGB byte -> linear light
        const t = new Float32Array(256);
        for (let v = 0; v < 256; v++) { const c = v / 255; t[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
        return t;
    })();
    const labF = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const L_WEIGHT = 0.5;  // brightness counts half as much as colour in every comparison
    const EDGE_STEP = 5;   // biggest difference allowed between two neighbouring pixels (a crisp edge is bigger)
    const EDGE_SPAN = 9;   // ... and between a pixel and the one 3 steps ahead (a soft edge shows up over a few pixels)

    // the grey mask (white = selected) for the area CONNECTED to (x0, y0) that stays close to the clicked colour.
    // `tol` is a Lab distance (see wandTolerance). Rules:
    //  1. every pixel must be within `tol` of the CLICKED colour, so a slow gradient cannot creep far away;
    //  2. it only moves between touching pixels, so a distant patch of the same colour is never taken;
    //  3. it will not step across an edge, crisp or soft (outline, lace border, hair against skin), whatever the
    //     strength: smooth shading changes a little per pixel, an edge changes a lot.
    // The clicked colour is the median of the 3x3 pixels around the click, so one sparkly or noisy pixel does not
    // decide everything. Then (optionally) small gaps that the selection completely surrounds are filled.
    function wandMaskUrl(image, w, h, x0, y0, tol, fill) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const cx = c.getContext("2d", { willReadFrequently: true });
        cx.drawImage(image, 0, 0, w, h);
        const px = cx.getImageData(0, 0, w, h).data;
        const n = w * h;
        const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const R = LIN[px[i * 4]], G = LIN[px[i * 4 + 1]], Bl = LIN[px[i * 4 + 2]];
            const fx = labF((0.4124 * R + 0.3576 * G + 0.1805 * Bl) / 0.95047);
            const fy = labF(0.2126 * R + 0.7152 * G + 0.0722 * Bl);
            const fz = labF((0.0193 * R + 0.1192 * G + 0.9505 * Bl) / 1.08883);
            L[i] = 116 * fy - 16; A[i] = 500 * (fx - fy); B[i] = 200 * (fy - fz);
        }
        const s = y0 * w + x0;
        const ls = [], as = [], bs = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = x0 + dx, y = y0 + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            ls.push(L[y * w + x]); as.push(A[y * w + x]); bs.push(B[y * w + x]);
        }
        const mid = a => a.sort((m, k) => m - k)[a.length >> 1];  // median: one odd pixel cannot move it
        const L0 = mid(ls), A0 = mid(as), B0 = mid(bs);
        L[s] = L0; A[s] = A0; B[s] = B0;  // the first step compares against that colour too
        const tol2 = tol * tol, step2 = EDGE_STEP * EDGE_STEP, span2 = EDGE_SPAN * EDGE_SPAN;
        const dist2 = (i, j) => { const dl = L_WEIGHT * (L[i] - L[j]), da = A[i] - A[j], db = B[i] - B[j]; return dl * dl + da * da + db * db; };
        const nearClick = j => { const dl = L_WEIGHT * (L[j] - L0), da = A[j] - A0, db = B[j] - B0; return dl * dl + da * da + db * db <= tol2; };
        const go = (i, x, y, dx, dy) => {  // may the fill step from pixel i (at x, y) to its neighbour at (x+dx, y+dy)?
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
            const j = ny * w + nx;
            if (seen[j] || !nearClick(j) || dist2(i, j) > step2) return false;  // too far from the click, or a crisp edge
            const fx = x + 3 * dx, fy = y + 3 * dy;  // a soft edge: look 3 steps ahead too
            if (fx >= 0 && fy >= 0 && fx < w && fy < h && dist2(i, fy * w + fx) > span2) return false;
            seen[j] = 1;
            return true;
        };
        const seen = new Uint8Array(n), stack = new Int32Array(n);
        const out = cx.createImageData(w, h);  // starts transparent black = not selected
        let top = 0;
        seen[s] = 1; stack[top++] = s;
        while (top) {
            const i = stack[--top], x = i % w, y = (i - x) / w;
            out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = out.data[i * 4 + 3] = 255;
            if (go(i, x, y, -1, 0)) stack[top++] = i - 1;
            if (go(i, x, y, 1, 0)) stack[top++] = i + 1;
            if (go(i, x, y, 0, -1)) stack[top++] = i - w;
            if (go(i, x, y, 0, 1)) stack[top++] = i + w;
        }
        // Looking ahead stops the fill 2-3 pixels short of an edge, which would leave a visible gap along every
        // outline. Grow the selection back by two pixels, but only into pixels still close to the clicked colour:
        // a real edge pixel (an outline, hair, lace) is far from it, so the growth stops there.
        const list = new Int32Array(n);
        for (let round = 0; round < 2; round++) {
            let m = 0;
            for (let i = 0; i < n; i++) {
                if (seen[i]) continue;
                const x = i % w;
                if (!((x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (i >= w && seen[i - w]) || (i < n - w && seen[i + w]))) continue;
                if (nearClick(i)) list[m++] = i;
            }
            for (let k = 0; k < m; k++) {
                const i = list[k];
                seen[i] = 1;
                out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = out.data[i * 4 + 3] = 255;
            }
        }
        if (fill) {
            // Fill small gaps that the selection completely surrounds (a shiny highlight, an eye): find every
            // unselected pixel that can reach the image border, the rest are enclosed pockets, and take each
            // pocket that is small. A big enclosed pocket (a whole garment) is left alone.
            const cap = Math.max(40, Math.round(n * 0.01));
            const mark = new Uint8Array(n);  // 1 = unselected and connected to the border, 2 = a pocket being measured
            let t = 0;
            const around = (i, f) => {
                const x = i % w;
                if (x > 0) f(i - 1);
                if (x < w - 1) f(i + 1);
                if (i >= w) f(i - w);
                if (i < n - w) f(i + w);
            };
            const outside = j => { if (!seen[j] && !mark[j]) { mark[j] = 1; stack[t++] = j; } };
            for (let x = 0; x < w; x++) { outside(x); outside((h - 1) * w + x); }
            for (let y = 0; y < h; y++) { outside(y * w); outside(y * w + w - 1); }
            while (t) around(stack[--t], outside);
            const pocket = new Int32Array(n);
            let cnt = 0;
            const grow = j => { if (!seen[j] && !mark[j]) { mark[j] = 2; stack[t++] = j; } };
            for (let s0 = 0; s0 < n; s0++) {
                if (seen[s0] || mark[s0]) continue;
                cnt = 0; t = 0; mark[s0] = 2; stack[t++] = s0;
                while (t) { const i = stack[--t]; pocket[cnt++] = i; around(i, grow); }
                if (cnt <= cap) for (let k = 0; k < cnt; k++) {
                    const q = pocket[k] * 4;
                    out.data[q] = out.data[q + 1] = out.data[q + 2] = out.data[q + 3] = 255;
                }
            }
        }
        cx.putImageData(out, 0, 0);
        return c.toDataURL("image/png");
    }

    // ForgeCanvas applies a new ta.value up to ~100 ms later (its poller, then an async image load). A second
    // click inside that window would be composed against the OLD canvas and lose the first one, so a wand or
    // click-select click keeps the busy flag for this long after writing.
    const settle = () => new Promise(r => setTimeout(r, 250));

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
                const sb = document.getElementById(`subtractButton_${uuid}`);
                if (sb) sb.style.display = hide;
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
            // Subtract: a visible on/off switch, so nobody has to know a hidden key. While it is on (red), click
            // select, the lasso and the wand REMOVE from the selection instead of adding to it. Holding Alt while
            // clicking does the opposite of the switch for that one click.
            const subBtn = makeButton(uuid, "subtractButton", "Subtract: turn on (the button turns red), then click select, the lasso and the wand remove from the selection instead of adding to it. Esc, or turning the tool off, switches it off. Holding Alt while you click does the opposite for that one click (Ctrl+Z undoes).", "−");
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
            // Eraser: "−" on with no tool picked turns the mouse into a round eraser (drag to rub the selection out)
            const erasePanel = document.createElement("div");
            erasePanel.id = `erasePanel_${uuid}`;
            erasePanel.className = "forge-range-row";
            erasePanel.style.display = "none";
            const eraseLabel = document.createElement("div");
            eraseLabel.className = "forge-toolbar-label";
            const eraseSlider = document.createElement("input");
            eraseSlider.type = "range"; eraseSlider.className = "forge-toolbar-range";
            eraseSlider.min = "4"; eraseSlider.max = "300"; eraseSlider.value = "40";
            const showEraseSize = () => { eraseLabel.textContent = `Eraser Size (${eraseSlider.value})`; };
            eraseSlider.addEventListener("input", () => { showEraseSize(); showRing(); });
            showEraseSize();
            erasePanel.append(eraseLabel, eraseSlider);
            boxB.append(erasePanel);
            const ring = document.createElement("div");  // circle that follows the mouse and shows the eraser size
            ring.style.cssText = "position:fixed;pointer-events:none;border:2px solid #e5484d;border-radius:50%;display:none;z-index:9999;box-sizing:border-box";
            document.body.append(ring);
            let ringAt = null;
            const showRing = () => {
                if (!ringAt || !(subtract && !mode)) { ring.style.display = "none"; return; }
                const r = canvas.getBoundingClientRect();
                const d = +eraseSlider.value * r.width / canvas.width;
                ring.style.cssText += `;display:block;width:${d}px;height:${d}px;left:${ringAt[0] - d / 2}px;top:${ringAt[1] - d / 2}px`;
            };
            // strength 0-100 -> a Lab colour distance 0-40; skin from lit to shadow is about 22 apart, a grey fence
            // or sky is 30+ away from skin. Up to 20 it is a straight line (20 -> 8); above that it starts gentler and
            // speeds up, so the middle of the slider has finer steps (40 -> 13, 60 -> 20, 80 -> 29, 100 -> 40)
            const wandTolerance = () => +wandSlider.value <= 20 ? +wandSlider.value * 0.4 : 8 + 0.2 * (+wandSlider.value - 20) + 0.0025 * (+wandSlider.value - 20) ** 2;

            // one mode at a time: null, "select", "lasso" or "wand"
            let mode = null, busy = false, pts = null, snap = null, subtract = false, lassoSub = false;
            const ctx = canvas.getContext("2d");
            const ADD = "#f5a623", REMOVE = "#e5484d";  // orange = adding, red = removing
            const paint = () => {
                const c = subtract ? REMOVE : ADD;
                subBtn.style.outline = subtract ? `2px solid ${REMOVE}` : "";
                sel.style.outline = mode === "select" ? `2px solid ${c}` : "";
                las.style.outline = mode === "lasso" ? `2px solid ${c}` : "";
                wand.style.outline = mode === "wand" ? `2px solid ${c}` : "";
                const erasing = subtract && !mode;
                erasePanel.style.display = erasing ? "" : "none";
                canvas.style.cursor = erasing ? "none" : mode ? "crosshair" : "";
                showRing();
            };
            const setMode = m => {
                mode = m;
                if (!m) subtract = false;  // turning the tool off also switches subtract off
                paint();
                wandPanel.style.display = m === "wand" ? "" : "none";  // "" = the row's own flex column
            };
            const cancelLasso = () => { if (pts) ctx.putImageData(snap, 0, 0); pts = snap = null; };
            sel.addEventListener("click", e => { e.preventDefault(); cancelLasso(); setMode(mode === "select" ? null : "select"); });
            las.addEventListener("click", e => { e.preventDefault(); cancelLasso(); setMode(mode === "lasso" ? null : "lasso"); });
            wand.addEventListener("click", e => { e.preventDefault(); cancelLasso(); setMode(mode === "wand" ? null : "wand"); });
            subBtn.addEventListener("click", e => { e.preventDefault(); subtract = !subtract; paint(); });
            document.addEventListener("keydown", e => { if (e.key === "Escape" && (mode || subtract)) { cancelLasso(); setMode(null); } });
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
                ctx.strokeStyle = lassoSub ? REMOVE : ADD; ctx.lineWidth = Math.max(2, canvas.width / 400);
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
                if (done.length > 2) ta.value = lassoDataUrl(uuid, done, lassoSub);  // the canvas's own poller picks this up
            }, true);
            // eraser: drag with "−" on and no tool picked. The strokes are rubbed straight out of the canvas as you
            // drag (so you see them go), then the result goes through the textbox once, like every other tool.
            let erasing = null;
            const eraseTo = (x, y) => {
                const [px, py] = erasing;
                ctx.save();
                ctx.globalCompositeOperation = "destination-out"; ctx.globalAlpha = 1;
                ctx.strokeStyle = ctx.fillStyle = "#000"; ctx.lineCap = ctx.lineJoin = "round"; ctx.lineWidth = +eraseSlider.value;
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x + 0.01, y); ctx.stroke();
                ctx.beginPath(); ctx.arc(x, y, +eraseSlider.value / 2, 0, 7); ctx.fill();
                ctx.restore();
                erasing = [x, y];
            };
            container.addEventListener("pointerdown", e => {
                if (mode || !subtract || e.button !== 0 || e.target !== canvas || !loaded()) return;
                e.preventDefault(); e.stopPropagation();
                canvas.setPointerCapture(e.pointerId);
                erasing = xy(e);
                eraseTo(...erasing);
            }, true);
            container.addEventListener("pointermove", e => {
                if (mode || !subtract) return;
                ringAt = [e.clientX, e.clientY]; showRing();
                if (!erasing) return;
                e.stopPropagation();
                eraseTo(...xy(e));
            }, true);
            container.addEventListener("pointerleave", () => { ringAt = null; showRing(); });
            container.addEventListener("pointerup", e => {
                if (!erasing) return;
                e.stopPropagation();
                erasing = null;
                const url = canvas.toDataURL("image/png");
                if (url.startsWith("data:image/png")) ta.value = url;  // the canvas's own poller picks this up
            }, true);
            // capture on the parent so this runs before ForgeCanvas starts a brush stroke
            container.addEventListener("pointerdown", async e => {
                if (!mode || e.button !== 0 || e.target !== canvas || !loaded()) return;
                e.preventDefault(); e.stopPropagation();
                const sub = e.altKey !== subtract;  // decided here, so flipping the switch mid-click changes nothing
                if (mode === "lasso") {
                    lassoSub = sub;
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
                    try { ta.value = await (sub ? subtractedDataUrl : addedDataUrl)(uuid, wandMaskUrl(image, w, h, x, y, wandTolerance(), fillBox.checked), true); await settle(); }
                    catch (err) { alert("Magic wand failed: " + err); }
                    busy = false;
                    return;
                }
                busy = true; sel.textContent = "…"; canvas.style.cursor = "progress";
                try {
                    const res = await (await fetch("/invert_mask/select", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ image: image.src, x, y }) })).json();
                    if (res.error) alert("Click select: " + res.error);
                    else { ta.value = await (sub ? subtractedDataUrl : addedDataUrl)(uuid, res.mask); await settle(); }
                } catch (err) { alert("Click select failed: " + err); }
                busy = false; sel.textContent = "✦"; canvas.style.cursor = mode ? "crosshair" : "";
            }, true);

            redo.after(inv);
            inv.after(sel);
            sel.after(las);
            las.after(wand);
            wand.after(subBtn);
        });
    }

    onUiLoaded(addButtons);
    onUiUpdate(addButtons);  // ponytail: cheap id check per update; catches canvases rendered late
})();
