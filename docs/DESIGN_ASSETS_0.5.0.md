# 0.5.0 raster assets

The final brief requires opaque application artwork and transparent internal PNG icons, with antialiasing and no rendered vector icons.

- `public/images/app-icon.png`: original generated X/lightning mark, fully opaque Gunmetal background. Generated with the built-in imagegen tool; no CLI/API fallback. Copied into the repository from the tool output.
- `public/images/icons/*.png`: 22 original minimalist glyphs rasterized directly to transparent 96 × 96 PNGs with antialiased edges using Canvas2D. `scripts/render-ui-icons.mjs` reproducibly generates them from construction geometry; production UI renders only PNG files. Alpha checks require transparent padding and partially covered edge pixels. No background-removal step is used.

## Application icon prompt

Create a finished raster Windows desktop application icon for X SpeedUp. Square 1024x1024 image. Entire image fully opaque, solid uniform gunmetal #2A3439 background right to every corner, NO transparency. Central bold capital X, a single angular lightning bolt integrated through its center. Modern minimalist industrial mark, geometric clean silhouette, X warm light gray #dfe5df and lightning muted sage #b8cf80. Mark fills about 70 percent of the canvas with generous equal padding. Flat crisp surfaces with excellent antialiasing. NO border, NO rounded square container, NO glow, NO halo, NO shadow, NO blue, NO texture, NO words, NO small details, NO additional symbols. This must work as a small taskbar icon. Strong readable X and clearly readable lightning bolt as one coherent emblem.

The generated file is retained without semantic postprocessing. Windows packaging creates the required icon resource sizes from it. Earlier assets and briefs documented for older releases no longer describe the production UI.
