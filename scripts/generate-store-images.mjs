import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const OUTPUT_DIR = resolve("store-assets/0.10.2");
export const OUTPUTS = [
  { name: "screenshot-1280x800.png", width: 1280, height: 800 },
  { name: "small-promo-440x280.png", width: 440, height: 280 },
  { name: "marquee-1400x560.png", width: 1400, height: 560 },
];

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const projectRoot = resolve(import.meta.dirname, "..");

async function fileDataUrl(relativePath, mimeType) {
  const contents = await readFile(resolve(projectRoot, relativePath));
  return `data:${mimeType};base64,${contents.toString("base64")}`;
}

export const ICON_DATA_URL = await fileDataUrl(
  "assets/icons/icon-128.png",
  "image/png",
);
export const SEARCH_ICON_DATA_URL = await fileDataUrl(
  "assets/icons/search.svg",
  "image/svg+xml",
);
export const SETTINGS_ICON_DATA_URL = await fileDataUrl(
  "assets/icons/settings.svg",
  "image/svg+xml",
);

function text({ x, y, value, size = 14, fill = "#202124", weight = 400 }) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="${size}" font-weight="${weight}" dominant-baseline="middle">${escapeXml(value)}</text>`;
}

function tabRow({ x, y, width, title, selected = false, accent = "#5f6368" }) {
  const background = selected
    ? `<rect x="${x}" y="${y}" width="${width}" height="32" rx="6" fill="#e8f0fe"/>`
    : "";

  return `${background}
    <circle cx="${x + 18}" cy="${y + 16}" r="7" fill="${accent}"/>
    ${text({ x: x + 34, y: y + 16, value: title, size: 14 })}`;
}

function groupHeader({ x, y, width, label, color, count }) {
  return `<rect x="${x}" y="${y}" width="${width}" height="28" rx="6" fill="${color}" fill-opacity="0.1"/>
    <circle cx="${x + 15}" cy="${y + 14}" r="5" fill="${color}"/>
    ${text({ x: x + 28, y: y + 14, value: label, size: 13, fill: color, weight: 600 })}
    ${text({ x: x + width - 22, y: y + 14, value: count, size: 12, fill: "#80868b" })}`;
}

export function sidebarPreview({ x, y, width, height, compact = false }) {
  const inset = compact ? 12 : 16;
  const rowGap = compact ? 30 : 34;
  const contentX = x + inset;
  const contentWidth = width - inset * 2;
  const clipId = `sidebar-preview-${String(x)}-${String(y)}-${String(width)}-${String(height)}`
    .replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  let cursorY = y + (compact ? 14 : 18);

  const pinned = [
    tabRow({
      x: contentX,
      y: cursorY,
      width: contentWidth,
      title: "项目看板",
      selected: true,
      accent: "#1a73e8",
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap,
      width: contentWidth,
      title: "设计文档",
      accent: "#f9ab00",
    }),
  ].join("\n");
  cursorY += rowGap * 2 + 6;

  const workHeader = groupHeader({
    x: contentX,
    y: cursorY,
    width: contentWidth,
    label: "工作",
    color: "#1a73e8",
    count: "2",
  });
  cursorY += 31;
  const workTabs = [
    tabRow({
      x: contentX,
      y: cursorY,
      width: contentWidth,
      title: "发布检查",
      selected: true,
      accent: "#34a853",
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap,
      width: contentWidth,
      title: "设计文档",
      accent: "#a142f4",
    }),
  ].join("\n");
  cursorY += rowGap * 2 + 6;

  const readingHeader = groupHeader({
    x: contentX,
    y: cursorY,
    width: contentWidth,
    label: "阅读",
    color: "#188038",
    count: "2",
  });
  cursorY += 31;
  const readingTabs = [
    tabRow({
      x: contentX,
      y: cursorY,
      width: contentWidth,
      title: "技术文章",
      accent: "#188038",
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap,
      width: contentWidth,
      title: "稍后阅读",
      accent: "#5f6368",
    }),
  ].join("\n");

  const toolbarY = y + height - 49;
  const shortcutY = toolbarY - 45;
  const shortcuts = ["#202124", "#1a73e8", "#34a853"]
    .map(
      (color, index) =>
        `<rect x="${contentX + index * 34}" y="${shortcutY}" width="26" height="26" rx="7" fill="${color}"/>`,
    )
    .join("\n");

  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/></clipPath></defs>
    <g clip-path="url(#${clipId})">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>
      ${pinned}
      ${workHeader}
      ${workTabs}
      ${readingHeader}
      ${readingTabs}
      <rect x="${x}" y="${shortcutY - 10}" width="${width}" height="1" fill="#e8eaed"/>
      ${shortcuts}
      <rect x="${x}" y="${toolbarY - 9}" width="${width}" height="58" fill="#ffffff"/>
      <rect x="${contentX}" y="${toolbarY}" width="${contentWidth}" height="34" rx="17" fill="#f1f3f4"/>
      <image x="${contentX + 10}" y="${toolbarY + 9}" width="16" height="16" href="${escapeXml(SEARCH_ICON_DATA_URL)}" opacity="0.62"/>
      ${text({ x: contentX + 34, y: toolbarY + 17, value: "搜索标签", size: 13, fill: "#80868b" })}
      <image x="${contentX + contentWidth - 27}" y="${toolbarY + 8}" width="18" height="18" href="${escapeXml(SETTINGS_ICON_DATA_URL)}" opacity="0.62"/>
    </g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="none" stroke="#dadce0"/>`;
}
