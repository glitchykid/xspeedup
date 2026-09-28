import { _electron as electron } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const paths = JSON.parse(await readFile('scripts/icon-paths.json', 'utf8'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['scripts/icon-window.cjs'], env });
try {
  const page = await app.firstWindow();
  await mkdir('public/images/icons', { recursive: true });
  const icons = await page.evaluate(
    (paths) =>
      Object.entries(paths).map(([name, path]) => {
        // Draw original glyph geometry directly into a high resolution transparent raster.
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        ctx.scale(4, 4);
        ctx.strokeStyle = '#d5ded6';
        ctx.lineWidth = 1.65;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(new Path2D(path));
        const pixels = ctx.getImageData(0, 0, 96, 96).data;
        let partial = 0,
          solid = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] > 0 && pixels[i] < 255) partial++;
          if (pixels[i] === 255) solid++;
        }
        if (!partial || !solid || pixels[3] !== 0)
          throw new Error('Antialiasing or transparency missing: ' + name);
        return [name, canvas.toDataURL('image/png').split(',')[1]];
      }),
    paths,
  );
  for (const [name, data] of icons)
    await writeFile(`public/images/icons/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`Generated ${icons.length} antialiased transparent PNG icons.`);
} finally {
  await app.close();
}
