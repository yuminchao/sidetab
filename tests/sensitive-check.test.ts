// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type SensitiveFinding = {
  category: string;
  path: string;
  line: number;
  column: number;
};

type SensitiveCheckModule = {
  scanSensitiveInformation(projectRoot: string): Promise<readonly SensitiveFinding[]>;
};

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function loadSensitiveCheck(): Promise<SensitiveCheckModule> {
  const modulePath = "../scripts/check-sensitive.mjs";
  return import(/* @vite-ignore */ modulePath) as Promise<SensitiveCheckModule>;
}

async function createScanFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sidetab-sensitive-"));
  temporaryRoots.add(root);
  for (const path of [
    "manifest.json",
    "package.json",
    "package-lock.json",
    "README.md",
    "update.log",
    "docs/privacy-policy.md",
    "docs/chrome-web-store-checklist.md",
    "src/config.ts",
    "scripts/build.mjs",
  ]) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "clean release text\n");
  }
  return root;
}

describe("pre-package sensitive information check", () => {
  it("reports a credential assignment by location without exposing its value", async () => {
    const root = await createScanFixture();
    const secretValue = "D0-not-print-this-credential";
    await writeFile(join(root, "src/config.ts"), `const password = "${secretValue}";\n`);
    const { scanSensitiveInformation } = await loadSensitiveCheck();

    const findings = await scanSensitiveInformation(root);

    expect(findings).toEqual([
      {
        category: "credential-assignment",
        path: "src/config.ts",
        line: 1,
        column: 7,
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain(secretValue);
  });

  it("classifies credential, personal, company, and internal endpoint signals", async () => {
    const root = await createScanFixture();
    const sensitiveValues = [
      "github_pat_A1B2C3D4E5F6G7H8",
      "ghp_1234567890abcdefghij",
      "release-owner@private-company.cn",
      "13812345678",
      "11010519900101123X",
      "https://admin.corp.internal/api",
      "示例科技有限公司",
      "-----BEGIN PRIVATE KEY-----",
    ];
    await writeFile(
      join(root, "src/config.ts"),
      [
        sensitiveValues[0],
        sensitiveValues[2],
        sensitiveValues[3],
        sensitiveValues[4],
        sensitiveValues[5],
        sensitiveValues[6],
        sensitiveValues[7],
      ].join("\n"),
    );
    await writeFile(join(root, "README.md"), `${sensitiveValues[1]}\n`);
    const { scanSensitiveInformation } = await loadSensitiveCheck();

    const findings = await scanSensitiveInformation(root);

    expect(findings.map((finding) => finding.category).sort()).toEqual([
      "company-identifier",
      "email",
      "github-token",
      "github-token",
      "internal-endpoint",
      "mainland-id",
      "mainland-phone",
      "private-key",
    ]);
    for (const value of sensitiveValues) {
      expect(JSON.stringify(findings)).not.toContain(value);
    }
  });

  it("allows explicit public examples and excludes non-release instruction or fixture paths", async () => {
    const root = await createScanFixture();
    await writeFile(
      join(root, "src/config.ts"),
      [
        "support@example.com",
        "http://localhost:4173/",
        'const token = "REDACTED";',
      ].join("\n"),
    );
    for (const path of [
      "scripts/check-sensitive.mjs",
      "docs/superpowers/plan.md",
      "tests/fixtures/config.ts",
    ]) {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, 'const password = "excluded-real-looking-value";\n');
    }
    const { scanSensitiveInformation } = await loadSensitiveCheck();

    await expect(scanSensitiveInformation(root)).resolves.toEqual([]);
  });

  it("runs as a redacted CLI gate with success and failure exit codes", async () => {
    const root = await createScanFixture();
    const script = resolve("scripts/check-sensitive.mjs");
    const clean = spawnSync(process.execPath, [script, root], { encoding: "utf8" });

    expect(clean.status).toBe(0);
    expect(clean.stdout).toMatch(/sensitive information check passed/i);

    const secretValue = "github_pat_must_not_appear_987654321";
    await writeFile(join(root, "README.md"), `${secretValue}\n`);
    const dirty = spawnSync(process.execPath, [script, root], { encoding: "utf8" });

    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain("README.md:1:1 [github-token]");
    expect(`${dirty.stdout}\n${dirty.stderr}`).not.toContain(secretValue);
  });
});
