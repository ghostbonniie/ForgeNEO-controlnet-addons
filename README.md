# Forge Mask Tools

An extension for **Forge** and **Forge Neo** that adds 4 buttons to every drawing canvas toolbar
(ControlNet units and img2img inpaint), next to Undo / Redo:

| Button | What it does |
|---|---|
| **◐ Invert** | Painted becomes unpainted and the other way round. ControlNet with preprocessor `None` keeps what is painted, so: paint the clothes, press ◐, and everything *except* the clothes is held. |
| **✦ Select** | Turn it on, click a piece of clothing, and it selects that whole object (SAM2). Click more pieces to add them. |
| **➰ Lasso** | Turn it on, drag around an area, and the inside gets filled. |
| **🪄 Magic wand** | Turn it on, click an area, and it selects the part of similar colour that **touches your click**. A **strength slider** (0 to 100) sets how similar the colour has to be. It never jumps to a separate patch elsewhere in the picture, and it stops at edges, crisp or soft (outlines, the border of clothing, hair against skin), at **any** strength. **Fill gaps** (on by default) also takes small gaps that the selection completely surrounds, such as a shiny highlight on skin. See [Magic wand: which strength?](#magic-wand-which-strength) below. |

`Ctrl+Z` undoes any of them. `Esc` (or clicking the lit button again) turns ✦ / ➰ / 🪄 off.

**✦ Select or 🪄 Magic wand?** ✦ uses an AI model to pick the whole object you clicked, so it can include separate
pieces that look alike elsewhere in the picture (for example both sleeves). 🪄 is plain colour matching that grows only
from your click, so it stays local and does what the slider says.

## Magic wand: which strength?

Colours are compared the way the eye sees them: a change of **brightness** (shading) counts for less than a change of
**colour**. So shaded skin stays together, while a grey fence, blue sky or white hair does not join it.

| Strength | What you get | Good for |
|---|---|---|
| **0 to 8** | Almost nothing. | Too strict to be useful. |
| **10 to 15** | A small patch of one shade. | A small part of the skin; staying close to clothing and lace edges. |
| **20** (the default) | One band of one shade. | **A good place to start.** |
| **30 to 50** | The whole shaded body part: all the connected skin of that shade. Lace, hair, sky and fence stay out. | Selecting a body area; flat areas such as sky (30 to 45). |
| **60 and up** | It starts taking things of a similar colour, such as see-through pink lace over skin or tan hair. | Rarely what you want. |

These numbers come from tests on one painted picture, so yours may differ a little. Move in steps of 5.

**Tips**

- **Too little selected?** Raise the strength by 5 and click the same spot again. Each click adds to the selection.
- **Too much selected?** Press `Ctrl+Z` and lower the strength by 5.
- **Light and shaded skin are different shades.** The lit part around a highlight is not selected by a low strength. Click
  it as well, or use 35 or more.
- **Leave Fill gaps on.** It takes small spots that the selection completely surrounds, such as a shiny highlight or an
  eye (anything under 1% of the picture). A large lit area is not a gap, so click it.
- **Lace and other fine patterns** are full of tiny edges, so the wand selects very little of them. Use ✦ Select for lace.
- **Skin that runs smoothly into more skin** (a thigh into a hip into a butt) has no edge between the parts, so the wand
  cannot tell where one ends. Use a lower strength, or ➰ Lasso.

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
