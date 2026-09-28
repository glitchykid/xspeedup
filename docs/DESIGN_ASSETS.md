# Generated design assets

Production PNG assets were generated on 2026-09-28 with the built-in image generation tool, not the API/CLI fallback. They are stored in the repository and packaged locally; the app fetches no remote images. Drafts from earlier design directions are not shipped.

| Asset                                | Role                                          |
| ------------------------------------ | --------------------------------------------- |
| `public/images/speedup-glass.png`    | Transparent hero illustration for both themes |
| `public/images/app-icon.png`         | Brand mark and Windows packaging icon source  |
| `public/images/navigation-glass.png` | Transparent four-column/two-row icon atlas    |

The atlas order is overview, file cleanup, empty folders, registry; services, memory, history, lightning. `ArtIcon.svelte` selects cells through CSS positioning. Navigation labels remain accessible text; images are decorative. Small action glyphs remain vectors. Electron Builder handles Windows icon resource conversion from the generated PNG during packaging.

## Hero prompt

> Use case: stylized-concept. Asset type: original illustration for the hero panel of the X SpeedUp desktop maintenance app in light and dark glass morphism themes. Subject: a compact sculptural desktop computer with a glowing lightning symbol on the display, three orderly storage blocks beside it and a small memory module in front. Style: refined translucent frosted glass, softly rounded corners, realistic gentle reflections, pale icy blue glass with lavender and teal accents, restrained studio 3D illustration with a clean readable silhouette at 260 px. Centered square composition with ample margin around all elements. Transparent background. No pedestal, no backdrop, no text or logos, no watermark, no black outlines, no hard cast shadow. Make the computer feel like a single distinctive coherent object, not a pile of UI panels.

## Application icon prompt

> Use case: logo-brand. Asset type: Windows application icon for X SpeedUp. A single bold lightning bolt carved from luminous aqua blue glass centered inside a softly rounded square of deep cobalt and violet frosted glass. Highly distinctive, clean geometric silhouette readable at 16 and 32 pixels, minimal details, polished glass morphism aesthetic. The square fills 85 percent of a square canvas with even margins. Front view, gentle soft bevel, restrained highlight. Transparent exterior background. No text, no letters, no additional objects, no cast shadow outside the square. Professional production application icon.

## Navigation atlas prompts

Generation:

> Use case: stylized-concept. Asset type: production navigation icon sprite sheet for the X SpeedUp glass morphism desktop app. Create exactly EIGHT distinct icons in a perfectly regular 4 columns x 2 rows grid on a transparent square canvas. All cells equal size, each icon precisely centered in its cell with generous empty padding of 20 percent all around; nothing crosses a cell boundary. Each icon should occupy approximately 60 percent of its cell. No grid lines or cell backgrounds. Reading order: top row 1 a monitor with four small dashboard squares, 2 a short cleaning brush with a tiny sparkle, 3 an open empty folder, 4 three linked registry cubes. Bottom row 1 a sliders settings control, 2 a memory chip, 3 a circular history clock arrow, 4 a strong single lightning bolt. Consistent translucent frosted blue glass bodies, lavender and teal accents, soft bevels, strong simple recognizable silhouettes legible at 32 pixels, subtle highlights with enough saturated blue contrast on white and navy backgrounds. Front three-quarter view, same angle and scale for all. No letters, numbers, logos, labels, backdrop or shadows outside the icons.

Final edit using the generated sheet as input:

> Edit target: the provided eight-icon sheet. Preserve the exact eight glass icon designs, colors and reading order. Remove the ENTIRE opaque dark/blue glowing background, replacing it with genuine transparent alpha. Isolate just the eight icons; no surrounding glow or backdrop. Reflow them into a regular FOUR-COLUMN, TWO-ROW sprite atlas on a 2:1 landscape canvas, ideally 2048x1024. Each of the eight equal SQUARE cells contains one centered icon at the same 68-percent footprint with empty transparent margins. No text, no grids or labels. The transparent gap between cells is essential for UI sprite use.
