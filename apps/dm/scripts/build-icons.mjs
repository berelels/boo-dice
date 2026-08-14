import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

/**
 * Rasteriza `resources/icons/icon.svg` nos formatos que o electron-builder
 * precisa: `.ico` multi-resolução pro Windows, `.png` de 512×512 pro
 * AppImage/deb do Linux. O `sharp` já traz suporte a SVG embutido (via
 * librsvg) — não depende de nenhum binário do sistema.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '../resources/icons/icon.svg');
const OUT_DIR = resolve(HERE, '../build');

await mkdir(OUT_DIR, { recursive: true });

const png1024 = await sharp(SOURCE).resize(1024, 1024).png().toBuffer();

await sharp(png1024).resize(512, 512).png().toFile(resolve(OUT_DIR, 'icon.png'));
console.log('  build/icon.png (512×512) gerado');

const ico = await pngToIco(png1024);
await writeFile(resolve(OUT_DIR, 'icon.ico'), ico);
console.log('  build/icon.ico (16–256px) gerado');
