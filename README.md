# Forge Mask Tools

An extension for **Forge** and **Forge Neo** that adds 4 buttons to every drawing canvas toolbar
(ControlNet units and img2img inpaint), next to Undo / Redo:

| Button | What it does |
|---|---|
| **◐ Invert** | Painted becomes unpainted and the other way round. ControlNet with preprocessor `None` keeps what is painted, so: paint the clothes, press ◐, and everything *except* the clothes is held. |
| **✦ Select** | Turn it on, click a piece of clothing, and it selects that whole object (SAM2). Click more pieces to add them. |
| **➰ Lasso** | Turn it on, drag around an area, and the inside gets filled. |
| **🪄 Magic wand** | Turn it on, click an area, and it selects the part of similar colour that **touches your click**. A **strength slider** sets how similar the colour has to be: low strength takes only nearly identical colour, high strength reaches further (the low end is fine-grained, so small nudges make small changes). Click again with a higher strength to grow the selection. It never jumps to a separate patch elsewhere in the picture, and it stops at sharp edges such as outlines and the borders of clothing: a higher strength tolerates bigger colour jumps, but a hard outline still stops it. |

`Ctrl+Z` undoes any of them. `Esc` (or clicking the lit button again) turns ✦ / ➰ / 🪄 off.

**✦ Select or 🪄 Magic wand?** ✦ uses an AI model to pick the whole object you clicked, so it can include separate
pieces that look alike elsewhere in the picture (for example both sleeves). 🪄 is plain colour matching that grows only
from your click, so it stays local and does what the slider says.

## Install (from inside Forge Neo)

1. Open the **Extensions** tab, then **Install from URL**.
2. Paste this link and press **Install**:

   ```
   https://github.com/ghostbonniie/ForgeNEO-controlnet-addons
   ```

3. **Restart Forge fully.** Closing the browser tab is not enough, and neither is only reloading the UI.

That is all. The four buttons appear on every canvas toolbar.

### Manual install

Clone it into your Forge `extensions` folder, so the files end up at
`<your forge>/extensions/ForgeNEO-controlnet-addons/javascript/invert_mask.js` and
`<your forge>/extensions/ForgeNEO-controlnet-addons/scripts/click_select.py`:

```
cd <your forge>/extensions
git clone https://github.com/ghostbonniie/ForgeNEO-controlnet-addons
```

Then restart Forge fully.

## Requirements

- **◐ Invert**, **➰ Lasso** and **🪄 Magic wand** need nothing else.
- **✦ Select** needs the `ultralytics` package, which the **ADetailer** extension already installs
  (install ADetailer if you don't have it).
  It uses `models/adetailer/sam2.1_b.pt` if you have it. If not, the first click downloads it
  (about 160 MB, one time), so that first click takes a while. After that a click takes under a second.

## If something doesn't work

- A button doesn't show: press `Ctrl+Shift+R` in the browser.
- ✦ shows an error popup: the message says what is missing.

## What is in here

| File | Purpose |
|---|---|
| `javascript/invert_mask.js` | Adds the buttons and draws the results through the canvas's own foreground textbox, so undo works and the backend receives the new mask. |
| `scripts/click_select.py` | Adds one server route, `/invert_mask/select`, that runs SAM2 on the clicked point. |

## License

MIT. See [LICENSE](LICENSE).
