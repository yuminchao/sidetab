import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const iconDirectory = resolve(root, "assets/icons");
const shortcutDirectory = resolve(root, "assets/shortcuts");

await Promise.all([
  mkdir(iconDirectory, { recursive: true }),
  mkdir(shortcutDirectory, { recursive: true }),
]);

const extensionIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="20" fill="#f7f7f5"/>
    <rect x="14" y="14" width="28" height="100" rx="10" fill="#202124"/>
    <circle cx="28" cy="30" r="5" fill="#f7f7f5"/>
    <rect x="22" y="47" width="12" height="5" rx="2.5" fill="#8b949e"/>
    <rect x="22" y="61" width="12" height="5" rx="2.5" fill="#8b949e"/>
    <rect x="22" y="75" width="12" height="5" rx="2.5" fill="#8b949e"/>
    <rect x="54" y="27" width="60" height="15" rx="7.5" fill="#1a73e8"/>
    <rect x="54" y="57" width="48" height="12" rx="6" fill="#8b949e"/>
    <rect x="54" y="86" width="57" height="12" rx="6" fill="#c1c7cd"/>
  </svg>
`;

for (const size of [16, 32, 48, 128]) {
  const png = await sharp(Buffer.from(extensionIcon))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(iconDirectory, `icon-${size}.png`), png);
}

const shortcutTiles = [
  { name: "openai", label: "AI", background: "#202123", foreground: "#ffffff", border: "#202123", fontSize: 11 },
  { name: "google", label: "G", background: "#ffffff", foreground: "#1a73e8", border: "#1a73e8", fontSize: 15 },
  { name: "github", label: "GH", background: "#24292f", foreground: "#ffffff", border: "#24292f", fontSize: 11 },
];

for (const tile of shortcutTiles) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="${tile.background}" stroke="${tile.border}" stroke-width="2"/>
      <text x="16" y="16" fill="${tile.foreground}" font-family="Arial, sans-serif" font-size="${tile.fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${tile.label}</text>
    </svg>
  `;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(resolve(shortcutDirectory, `${tile.name}.png`), png);
}

console.log("generated 7 local PNG assets");
