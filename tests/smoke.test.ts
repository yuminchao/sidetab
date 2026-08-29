import manifest from "../manifest.json";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function parseCsp(value: string): Record<string, string[]> {
  return Object.fromEntries(
    value
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources.sort()];
      }),
  );
}

describe("extension manifest", () => {
  it("keeps the npm and extension release versions aligned at 0.12.8", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(manifest.version).toBe("0.12.8");
    expect(packageJson.version).toBe("0.12.8");
    expect(packageLock.version).toBe("0.12.8");
    expect(packageLock.packages[""].version).toBe("0.12.8");
  });

  it("records the 0.10.4 context actions and visual refinements release", () => {
    const updateLog = readFileSync("update.log", "utf8");
    for (const detail of [
      "打开所有快捷网站",
      "完整 hostname",
      "关闭上方标签页",
      "4px",
      "淡黄色背景",
      "无新增权限",
      "无新增查询",
      "无新增轮询",
      "无长期缓存",
      "无远程代码",
      "0.10.4",
    ]) {
      expect(updateLog).toContain(detail);
    }
  });

  it("documents the current release archive, permissions, and file count", () => {
    const readme = readFileSync("README.md", "utf8");
    const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");
    expect(readme).toContain(`release/sidetab-lite-${manifest.version}.zip`);
    for (const permission of [
      "sidePanel",
      "tabs",
      "tabGroups",
      "storage",
      "history",
      "sessions",
      "bookmarks",
      "scripting",
      "search",
    ]) {
      expect(readme).toContain(`\`${permission}\``);
      expect(checklist).toContain(`\`${permission}\``);
    }
    expect(readme).toContain(
      "精确包含 16 个审核文件，其中图标资源为四个扩展 PNG 图标和五个 SVG（定位、固定、网络兜底、搜索、设置）",
    );
    expect(checklist).toContain(
      "精确包含 16 个审核文件，图标资源为 4 个 PNG 与 5 个 SVG（定位、固定、网络兜底、搜索、设置）",
    );
  });

  it("preserves the 0.8.1 history, add-tab, and recently closed release notes", () => {
    const updateLog = readFileSync("update.log", "utf8");

    expect(updateLog).toContain("0.8.1");
    expect(updateLog).toContain("主机名及端口与规范化路径");
    expect(updateLog).toContain("失去焦点");
    expect(updateLog).toContain("新增标签页图标");
    expect(updateLog).toContain("打开最近关闭标签页");
    expect(updateLog).toContain("只缓存一个 sessionId");
  });

  it("documents the current shortcut defaults and text add-tab button without stale UI claims", () => {
    const readme = readFileSync("README.md", "utf8");
    const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");

    for (const document of [readme, checklist]) {
      expect(document).toContain("快捷入口默认开启");
      expect(document).toContain("OpenAI、Google、GitHub");
      expect(document).toContain("显式关闭");
      expect(document).toContain("恢复默认");
      expect(document).toContain("默认值为 14 像素");
      expect(document).toContain("44x24");
      expect(document).toContain("文本 `+`");
      expect(document).toContain("边框");
      expect(document).not.toContain("快捷入口默认关闭");
      expect(document).not.toContain("默认值为 16 像素");
      expect(document).not.toContain("新增标签页图标");
      expect(document).not.toContain("无边框样式");
    }
  });

  it("documents bookmark-first search and its local permission use", () => {
    const documents = [
      readFileSync("README.md", "utf8"),
      readFileSync("docs/privacy-policy.md", "utf8"),
      readFileSync("docs/chrome-web-store-checklist.md", "utf8"),
    ];

    for (const document of documents) {
      for (const detail of [
        "空查询",
        "最近 20 条",
        "非空",
        "`chrome.bookmarks.search()`",
        "最多 5 条收藏夹",
        "总数最多 20 条",
        "收藏夹优先",
        "不缓存完整收藏夹树",
        "不注册收藏夹监听器",
        "不持久化",
        "不上传",
        "`bookmarks`",
        "升级",
        "重新启用扩展",
        "Chrome 浏览器数据",
        "扩展升级不会迁移或清除",
      ]) {
        expect(document).toContain(detail);
      }
    }
  });

  it("documents hidden actions, exact bookmarking, and default-search fallback privacy", () => {
    const readme = readFileSync("README.md", "utf8");
    const privacyPolicy = readFileSync("docs/privacy-policy.md", "utf8");
    const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");

    for (const document of [readme, checklist]) {
      expect(document).toContain("不可用的操作直接隐藏");
      expect(document).toContain("精确查询当前 HTTP/HTTPS 标签页的完整 URL");
      expect(document).toContain("两处搜索框");
      expect(document).toContain("本地查询已完成且结果为空");
      expect(document).toContain("默认搜索引擎");
      expect(document).toContain("来源胶囊");
    }
    for (const detail of [
      "生效日期：2026 年 8 月 29 日",
      "不读取默认搜索引擎配置",
      "不读取搜索结果页面内容",
      "精确查询当前 HTTP/HTTPS 标签页的完整 URL",
      "只创建一个收藏夹节点",
      "本地查询已完成且结果为空",
    ]) {
      expect(privacyPolicy).toContain(detail);
    }
    for (const staleClaim of [
      "叶子标签上的两项保持禁用",
      "无可关闭目标时菜单禁用",
      "没有标签记录时禁用",
      "没有可恢复记录时该菜单项不可用",
      "没有 host permission 和 content script",
      "`bookmarks` 仅用于非空搜索时读取",
    ]) {
      expect(`${readme}\n${checklist}\n${privacyPolicy}`).not.toContain(staleClaim);
    }
  });

  it("documents accurate search permission warnings and the current manual QA limitation", () => {
    const readme = readFileSync("README.md", "utf8");
    const privacyPolicy = readFileSync("docs/privacy-policy.md", "utf8");
    const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");

    for (const document of [readme, privacyPolicy, checklist]) {
      expect(document).toContain("`search` 权限本身不会触发新增权限警告");
      expect(document).toContain("HTTP/HTTPS 主机权限");
    }
    expect(checklist).toContain("自动验收记录（2026-08-29）");
    expect(checklist).toContain("44x44 host");
    expect(checklist).toContain("没有 `.result-source` 指纹");
    expect(checklist).toContain("未获授权安装或重新加载 0.12.8");
    expect(checklist).toContain("Chrome Web Store 页面不可脚本化");
    for (const staleClaim of [
      "升级到包含新增权限的版本时，Chrome 可能要求用户接受权限变更",
      "已有安装升级到包含这些权限的版本时，Chrome 可能要求用户接受新增权限",
    ]) {
      expect(`${readme}\n${privacyPolicy}\n${checklist}`).not.toContain(staleClaim);
    }
  });

  it("records the 0.12.8 update release first", () => {
    const updateLog = readFileSync("update.log", "utf8");
    const nextVersion = updateLog.search(/\r?\n(?=\d+\.\d+\.\d+\r?$)/m);
    const currentRelease = nextVersion === -1 ? updateLog : updateLog.slice(0, nextVersion);

    expect(updateLog.split(/\r?\n/, 1)[0]).toBe("0.12.8");
    for (const detail of [
      "不可用",
      "收藏",
      "默认搜索引擎",
      "来源胶囊",
      "search",
      "不读取默认搜索引擎配置",
      "敏感信息扫描",
      "逐字节",
    ]) {
      expect(currentRelease).toContain(detail);
    }
  });

  it("documents the 0.8.0 performance and consistency changes", () => {
    const updateLog = readFileSync("update.log", "utf8");
    for (const detail of [
      "0.8.0",
      "tabs.onReplaced",
      "增量 DOM",
      "快捷网站图标缓存",
      "统一网络兜底",
      "历史记录按完整 URL 去重",
    ]) {
      expect(updateLog).toContain(detail);
    }
  });

  it("documents the 0.7.0 tab-group and middle-click workflows", () => {
    const readme = readFileSync("README.md", "utf8");
    const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");
    for (const document of [readme, checklist]) {
      expect(document).toContain("添加到分组");
      expect(document).toContain("新建分组");
      expect(document).toContain("从分组中移除");
      expect(document).toContain("折叠");
      expect(document).toContain("中键");
    }
    expect(checklist).not.toContain("右键菜单包含四项");
    expect(checklist).not.toContain("包含四项的菜单");
  });

  it("uses the required restricted MV3 permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.permissions).toEqual([
      "sidePanel",
      "tabs",
      "tabGroups",
      "storage",
      "history",
      "sessions",
      "bookmarks",
      "scripting",
      "search",
    ]);
    expect(manifest.permissions.filter((permission) => permission === "search")).toHaveLength(1);
    expect(manifest.host_permissions).toEqual(["http://*/*", "https://*/*"]);
    expect(manifest.content_scripts).toEqual([{
      matches: ["http://*/*", "https://*/*"],
      js: ["content/floating-ball.js"],
      run_at: "document_idle",
    }]);
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
    expect(parseCsp(manifest.content_security_policy.extension_pages)).toEqual({
      "connect-src": ["'none'"],
      "frame-src": ["'none'"],
      "img-src": ["'self'", "data:", "http:", "https:"].sort(),
      "object-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
    });
    expect(manifest.background.service_worker).toBe("background/service-worker.js");
    expect(manifest.background.type).toBe("module");
    expect(manifest.side_panel.default_path).toBe("sidepanel/index.html");
    expect(manifest.icons).toEqual({
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
      "48": "assets/icons/icon-48.png",
      "128": "assets/icons/icon-128.png",
    });
    expect(manifest.action.default_icon).toEqual({
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
    });
    expect(manifest.commands).toEqual({
      _execute_action: {
        suggested_key: { default: "Alt+V" },
      },
    });
  });

  it("builds the classic content script as an IIFE", () => {
    const buildSource = readFileSync("scripts/build.mjs", "utf8");
    const serviceWorkerSource = readFileSync("src/background/service-worker.ts", "utf8");
    expect(buildSource).toContain('format: "iife"');
    expect(buildSource).toContain('"content/floating-ball"');
    expect(serviceWorkerSource).toContain("search: chrome.search");
  });
});
