# Forge Mask Tools

An extension for **Forge** and **Forge Neo** that adds 5 buttons to every drawing canvas toolbar
(ControlNet units and img2img inpaint), next to Undo / Redo:

| Button | What it does |
|---|---|
| **◐ Invert** | Painted becomes unpainted and the other way round. ControlNet with preprocessor `None` keeps what is painted, so: paint the clothes, press ◐, and everything *except* the clothes is held. |
| **✦ Select** | Turn it on, click a piece of clothing, and it selects that whole object (SAM2). Click more pieces to add them. |
| **➰ Lasso** | Turn it on, drag around an area, and the inside gets filled. |
| **🪄 Magic wand** | Turn it on, click an area, and it selects the part of similar colour that **touches your click**. A **strength slider** (0 to 100) sets how similar the colour has to be. It never jumps to a separate patch elsewhere in the picture, and it stops at edges, crisp or soft (outlines, the border of clothing, hair against skin), at **any** strength. **Fill gaps** (on by default) also takes small gaps that the selection completely surrounds, such as a shiny highlight on skin. See [Magic wand: which strength?](#magic-wand-which-strength) below. |
| **− Subtract / Eraser** | A switch (it turns **red** when on). With **no tool picked**, it is an **eraser**: drag over the selection to rub it out, and the **Eraser Size** slider sets the brush size (a red ring follows the mouse). With ✦ Select, ➰ Lasso or 🪄 Magic wand picked, those tools **remove** from the selection instead of adding to it. Holding **Alt** while you click does the opposite for that one click. It switches itself off when you press `Esc` or turn the tool off. See [Removing part of a selection](#removing-part-of-a-selection). |

`Ctrl+Z` undoes any of them. `Esc` (or clicking the lit button again) turns ✦ / ➰ / 🪄 and − off.

**✦ Select or 🪄 Magic wand?** ✦ uses an AI model to pick the whole object you clicked, so it can include separate
pieces that look alike elsewhere in the picture (for example both sleeves). 🪄 is plain colour matching that grows only
from your click, so it stays local and does what the slider says.

## Removing part of a selection

Every click and drag **adds** to the selection, so there are three ways to take something back out:

- **Undo** (`Ctrl+Z`) removes the whole last step.
- **− Eraser:** turn **−** on (it turns red) with no tool picked, set **Eraser Size**, and drag over what you want gone,
  like a rubber. This is the easiest way to clean up leftovers and specks.
- **− with a tool:** turn **−** on, then pick ➰ Lasso, ✦ Select or 🪄 Magic wand and use it as usual. It removes instead
  of adds, and the tool's outline turns red. The wand also takes out small gaps, loose specks and thin slivers (such as a dark rim where a shade changes) left next to
  the area it removes (**Fill gaps** applies here too). A wide area of a different shade is not touched: click it
  too, or use the eraser. Holding **Alt** while you click flips the switch for that one click. (On some
  Linux desktops the window manager takes Alt+click. If that happens, use the **−** button.)
- **Shift + drag** is Forge's own freehand eraser.

Which tool to remove with:

- **A piece of lace or any pattern:** use the eraser, ➰ Lasso (draw around it) or ✦ Select. The wand sees lace as tiny separate bits,
  so one click removes only a speck.
- **A flat area of one colour:** the 🪄 wand works, at a low strength.
- Clicking close to an edge can land on the other side of it. If the wrong thing disappears, press `Ctrl+Z`.

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
- **Too much selected?** Press `Ctrl+Z` and lower the strength by 5, or turn **−** on and rub the extra bit out with
  the eraser.
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

That is all. The five buttons appear on every canvas toolbar.

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

- **◐ Invert**, **➰ Lasso**, **🪄 Magic wand** and **− Subtract** need nothing else.
- **✦ Select** needs the `ultralytics` package, which the **ADetailer** extension already installs
  (install ADetailer if you don't have it).
  It uses `models/adetailer/sam2.1_b.pt` if you have it. If not, the first click downloads it
  (about 160 MB, one time), so that first click takes a while. After that a click takes under a second.

## If something doesn't work

- A button doesn't show: press `Ctrl+Shift+R` in the browser.
- ✦ shows an error popup: the message says what is missing.
- A click seems ignored: after a 🪄 or ✦ click, the next click is ignored for about a quarter of a second, so two clicks
  cannot overlap and lose the first one. Just click again.

## What is in here

| File | Purpose |
|---|---|
| `javascript/invert_mask.js` | Adds the buttons (invert, click select, lasso, magic wand, subtract) and draws the results through the canvas's own foreground textbox, so undo works and the backend receives the new mask. The wand and subtract run entirely in the browser. |
| `scripts/click_select.py` | Adds one server route, `/invert_mask/select`, that runs SAM2 on the clicked point. |

## License

MIT. See [LICENSE](LICENSE).
