import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

export const OUTPUT_DIR = resolve("store-assets/0.12.1");
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
export const LOCATE_ICON_DATA_URL = await fileDataUrl(
  "assets/icons/locate.svg",
  "image/svg+xml",
);

function text({ x, y, value, size = 14, fill = "#202124", weight = 400 }) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="${size}" font-weight="${weight}" dominant-baseline="middle">${escapeXml(value)}</text>`;
}

function tabRow({
  x,
  y,
  width,
  title,
  selected = false,
  accent = "#5f6368",
  depth = 0,
  parent = false,
  expanded = true,
}) {
  const indent = depth * 12;
  const background = selected
    ? `<rect x="${x}" y="${y}" width="${width}" height="32" rx="5" fill="#fff3bf"/>`
    : "";
  const toggle = parent
    ? `<path d="${expanded
      ? `M ${x + indent + 4} ${y + 13} l 4 4 l 4 -4`
      : `M ${x + indent + 5} ${y + 11} l 4 5 l -4 5`}" fill="none" stroke="#5f6368" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  const leaf = depth > 0 && !parent
    ? `<circle cx="${x + indent + 8}" cy="${y + 16}" r="2" fill="#80868b"/>`
    : "";

  return `${background}
    ${toggle}
    ${leaf}
    <rect x="${x + indent + 17}" y="${y + 9}" width="14" height="14" rx="4" fill="${accent}"/>
    ${text({ x: x + indent + 38, y: y + 16, value: title, size: 14, weight: parent ? 600 : 400 })}`;
}

function contextMenuPreview({ x, y, width = 232 }) {
  const items = [
    "复制标签页",
    "固定标签页",
    "设为快捷网站",
    "打开所有快捷网站",
    null,
    "添加到分组",
    "快速分组",
    null,
    "解散树节点",
    "删除树节点及子标签",
    null,
    "关闭下方标签页",
    "关闭上方标签页",
    "关闭其他同类网站标签页",
    "打开最近关闭标签页",
  ];
  let cursor = y + 8;
  const rows = items.map((label) => {
    if (label === null) {
      const separator = `<rect x="${x + 10}" y="${cursor + 4}" width="${width - 20}" height="1" fill="#dadce0"/>`;
      cursor += 10;
      return separator;
    }
    const highlighted = label === "解散树节点";
    const row = `${highlighted
      ? `<rect x="${x + 4}" y="${cursor}" width="${width - 8}" height="24" rx="3" fill="#f1f3f4"/>`
      : ""}
      ${text({
        x: x + 12,
        y: cursor + 12,
        value: label,
        size: 12,
        fill: label === "删除树节点及子标签" ? "#b3261e" : "#202124",
      })}`;
    cursor += 24;
    return row;
  }).join("\n");
  const height = cursor - y + 8;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="#ffffff" stroke="#c7c9cc"/>
    <rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" rx="4" fill="#ffffff"/>
    ${rows}
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="none" stroke="#c7c9cc"/>`;
}

function groupHeader({ x, y, width, label, color, count }) {
  return `<rect x="${x}" y="${y}" width="${width}" height="28" rx="6" fill="${color}" fill-opacity="0.1"/>
    <circle cx="${x + 15}" cy="${y + 14}" r="5" fill="${color}"/>
    ${text({ x: x + 28, y: y + 14, value: label, size: 13, fill: color, weight: 600 })}
    ${text({ x: x + width - 22, y: y + 14, value: count, size: 12, fill: "#80868b" })}`;
}

export function sidebarPreview({ x, y, width, height, compact = false, showContextMenu = false }) {
  const inset = compact ? 12 : 16;
  const rowGap = compact ? 30 : 34;
  const contentX = x + inset;
  const contentWidth = width - inset * 2;
  const clipId = `sidebar-preview-${String(x)}-${String(y)}-${String(width)}-${String(height)}`
    .replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  let cursorY = y + (compact ? 52 : 64);
  const shortcutColors = ["#202124", "#1a73e8", "#34a853"];
  const shortcutIcons = shortcutColors.map((color, index) =>
    `<circle cx="${contentX + 16 + index * 36}" cy="${y + 25}" r="10" fill="${color}"/>`).join("\n");
  const locateIcon = `<image x="${contentX + contentWidth - 22}" y="${y + 14}" width="22" height="22" href="${escapeXml(LOCATE_ICON_DATA_URL)}" opacity="0.72"/>`;
  const rows = [
    tabRow({
      x: contentX,
      y: cursorY,
      width: contentWidth,
      title: "产品发布",
      selected: true,
      accent: "#1a73e8",
      parent: true,
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap,
      width: contentWidth,
      title: "商店素材",
      accent: "#34a853",
      depth: 1,
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap * 2,
      width: contentWidth,
      title: "审核准备",
      accent: "#f9ab00",
      depth: 1,
      parent: true,
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap * 3,
      width: contentWidth,
      title: "权限说明",
      accent: "#a142f4",
      depth: 2,
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap * 4 + 8,
      width: contentWidth,
      title: "研究资料",
      accent: "#188038",
      parent: true,
      expanded: false,
    }),
    tabRow({
      x: contentX,
      y: cursorY + rowGap * 5 + 8,
      width: contentWidth,
      title: "设计文档",
      accent: "#5f6368",
    }),
  ].join("\n");

  const toolbarY = y + height - 49;
  const newTabY = Math.min(cursorY + rowGap * 6 + 14, toolbarY - 42);

  return `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/></clipPath></defs>
    <g clip-path="url(#${clipId})">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>
      ${shortcutIcons}
      ${locateIcon}
      <rect x="${x}" y="${y + 48}" width="${width}" height="1" fill="#e8eaed"/>
      ${rows}
      ${compact ? "" : `<rect x="${contentX + contentWidth - 44}" y="${newTabY}" width="44" height="24" rx="4" fill="#ffffff" stroke="#bdc1c6"/>
      ${text({ x: contentX + contentWidth - 22, y: newTabY + 12, value: "+", size: 18, fill: "#5f6368" })}`}
      <rect x="${x}" y="${toolbarY - 9}" width="${width}" height="58" fill="#ffffff"/>
      <rect x="${contentX}" y="${toolbarY}" width="${contentWidth}" height="34" rx="17" fill="#f1f3f4"/>
      <image x="${contentX + 10}" y="${toolbarY + 9}" width="16" height="16" href="${escapeXml(SEARCH_ICON_DATA_URL)}" opacity="0.62"/>
      ${text({ x: contentX + 34, y: toolbarY + 17, value: compact ? "搜索" : "搜索标签", size: 13, fill: "#80868b" })}
      <image x="${contentX + contentWidth - 27}" y="${toolbarY + 8}" width="18" height="18" href="${escapeXml(SETTINGS_ICON_DATA_URL)}" opacity="0.62"/>
      ${showContextMenu ? contextMenuPreview({ x: x + width - 250, y: y + 142, width: 232 }) : ""}
    </g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="none" stroke="#dadce0"/>`;
}

function svgDocument(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}

export function renderScreenshot() {
  const width = 1280;
  const height = 800;
  const panelX = 850;
  return svgDocument(width, height, `
    <rect width="${width}" height="${height}" fill="#f8fafd"/>
    <rect x="0" y="0" width="${width}" height="72" fill="#ffffff"/>
    <rect x="0" y="72" width="${width}" height="1" fill="#dadce0"/>
    <circle cx="32" cy="36" r="6" fill="#ea4335"/><circle cx="52" cy="36" r="6" fill="#fbbc04"/><circle cx="72" cy="36" r="6" fill="#34a853"/>
    <rect x="112" y="22" width="580" height="30" rx="15" fill="#f1f3f4"/>
    ${text({ x: 136, y: 37, value: "项目工作台", size: 13, fill: "#5f6368" })}
    ${text({ x: 42, y: 124, value: "发布看板", size: 28, weight: 700 })}
    ${text({ x: 42, y: 164, value: "本周进度", size: 15, fill: "#5f6368" })}
    <rect x="42" y="202" width="360" height="170" rx="8" fill="#ffffff" stroke="#e0e5eb"/>
    <rect x="426" y="202" width="360" height="170" rx="8" fill="#ffffff" stroke="#e0e5eb"/>
    ${text({ x: 66, y: 232, value: "设计确认", size: 15, weight: 600 })}
    ${text({ x: 450, y: 232, value: "发布准备", size: 15, weight: 600 })}
    <rect x="66" y="270" width="280" height="12" rx="6" fill="#e8f0fe"/>
    <rect x="66" y="302" width="220" height="12" rx="6" fill="#eef2f6"/>
    <rect x="450" y="270" width="270" height="12" rx="6" fill="#e6f4ea"/>
    <rect x="450" y="302" width="190" height="12" rx="6" fill="#eef2f6"/>
    <rect x="42" y="398" width="744" height="292" rx="8" fill="#ffffff" stroke="#e0e5eb"/>
    ${text({ x: 66, y: 430, value: "最近文档", size: 15, weight: 600 })}
    <rect x="66" y="470" width="654" height="12" rx="6" fill="#eef2f6"/>
    <rect x="66" y="512" width="510" height="12" rx="6" fill="#eef2f6"/>
    <rect x="66" y="554" width="606" height="12" rx="6" fill="#eef2f6"/>
    <rect x="${panelX}" y="0" width="430" height="800" fill="#ffffff" stroke="#dfe3e8"/>
    ${sidebarPreview({ x: panelX + 12, y: 38, width: 406, height: 724, showContextMenu: true })}
  `);
}

export function renderSmallPromo() {
  return svgDocument(440, 280, `
    <rect width="440" height="280" fill="#f8fafd"/>
    <circle cx="38" cy="38" r="20" fill="#ffffff" stroke="#dfe3e8"/>
    <image x="25" y="25" width="26" height="26" href="${escapeXml(ICON_DATA_URL)}"/>
    ${text({ x: 68, y: 38, value: "SideTab Lite", size: 17, weight: 600 })}
    <text x="28" y="92" fill="#202124" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="24" font-weight="700">树形标签，随手整理</text>
    ${text({ x: 28, y: 127, value: "父子层级 · 整树操作", size: 14, fill: "#5f6368" })}
    ${text({ x: 28, y: 151, value: "Alt+V 随时打开侧边栏", size: 14, fill: "#5f6368" })}
    <rect x="264" y="18" width="158" height="244" rx="12" fill="#ffffff" stroke="#dfe3e8"/>
    ${sidebarPreview({ x: 268, y: 22, width: 150, height: 236, compact: true })}
  `);
}

export function renderMarquee() {
  return svgDocument(1400, 560, `
    <rect width="1400" height="560" fill="#f8fafd"/>
    <rect x="0" y="0" width="760" height="560" fill="#ffffff"/>
    <circle cx="94" cy="112" r="34" fill="#f1f3f4" stroke="#dfe3e8"/>
    <image x="72" y="90" width="44" height="44" href="${escapeXml(ICON_DATA_URL)}"/>
    ${text({ x: 150, y: 112, value: "SideTab Lite", size: 28, weight: 700 })}
    <text x="94" y="222" fill="#202124" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="44" font-weight="700">树形标签，清晰有序</text>
    ${text({ x: 98, y: 278, value: "展开、拖动、整树操作，都顺着你的工作脉络。", size: 22, fill: "#5f6368" })}
    <rect x="98" y="326" width="112" height="34" rx="17" fill="#e8f0fe"/>
    <rect x="222" y="326" width="112" height="34" rx="17" fill="#e6f4ea"/>
    <rect x="346" y="326" width="112" height="34" rx="17" fill="#fef7e0"/>
    ${text({ x: 120, y: 343, value: "父子层级", size: 15, fill: "#174ea6", weight: 600 })}
    ${text({ x: 244, y: 343, value: "整树操作", size: 15, fill: "#137333", weight: 600 })}
    ${text({ x: 368, y: 343, value: "快速定位", size: 15, fill: "#b06000", weight: 600 })}
    <rect x="820" y="38" width="500" height="484" rx="18" fill="#ffffff" stroke="#dfe3e8"/>
    ${sidebarPreview({ x: 832, y: 50, width: 476, height: 460 })}
  `);
}

async function writePng(svg, output) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await sharp(Buffer.from(svg))
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .toColourspace("srgb")
    .png({ compressionLevel: 9, palette: false })
    .toFile(resolve(OUTPUT_DIR, output.name));
}

export async function generateStoreImages() {
  await writePng(renderScreenshot(), OUTPUTS[0]);
  await writePng(renderSmallPromo(), OUTPUTS[1]);
  await writePng(renderMarquee(), OUTPUTS[2]);
}

if (process.argv[1]?.endsWith("generate-store-images.mjs")) {
  await generateStoreImages();
}
