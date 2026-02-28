import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dir, "..", "..");
const fixtureDir = join(root, "e2e", "expo-ota-fixture");
const markerFile = join(fixtureDir, "app", "ota-marker.ts");
const fixtureAppJsonFile = join(fixtureDir, "app.json");
const bundleId = process.env.AIRLOCK_E2E_BUNDLE_ID ?? "com.dawson.airlockotafixture";
const simulatorName = process.env.AIRLOCK_E2E_SIMULATOR ?? "iPhone 17 Pro";
const port = process.env.AIRLOCK_E2E_PORT ?? "8788";
const token = process.env.AIRLOCK_E2E_TOKEN ?? "local-dev-token";
const runtime = process.env.AIRLOCK_E2E_RUNTIME ?? "1.0.0";
const reportPath = join(root, "e2e", "ios-ota-report.json");

type OtaStatus = {
  marker: string;
  runtimeVersion: string;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  checkResult: string;
  fetchedUpdateId: string | null;
  error: string | null;
  timestamp: string;
};

function setFixtureMarker(marker: string) {
  const appJson = JSON.parse(readFileSync(fixtureAppJsonFile, "utf-8")) as {
    expo?: { extra?: Record<string, unknown> };
  };
  appJson.expo ??= {};
  appJson.expo.extra ??= {};
  appJson.expo.extra.otaMarker = marker;
  writeFileSync(fixtureAppJsonFile, `${JSON.stringify(appJson, null, 2)}\n`);
}

function run(cmd: string[], cwd = root, env?: Record<string, string>, allowFail = false): string {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (proc.exitCode !== 0 && !allowFail) {
    throw new Error(`command failed (${proc.exitCode}): ${cmd.join(" ")}`);
  }

  return stdout;
}

async function timeStep<T>(
  timings: Array<{ step: string; ms: number }>,
  step: string,
  fn: () => Promise<T> | T
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  timings.push({ step, ms: Date.now() - start });
  return result;
}

async function waitForServer(url: string, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await Bun.sleep(250);
  }
  throw new Error(`server did not become healthy: ${url}`);
}

async function exportAndPublish(marker: string, message: string) {
  const distDir = join(fixtureDir, `dist-${marker}`);
  await Bun.write(markerFile, `export const OTA_MARKER = "${marker}";\n`);
  setFixtureMarker(marker);
  run(["rm", "-rf", distDir]);
  run(
    ["bunx", "expo", "export", "--clear", "--platform", "ios", "--output-dir", distDir],
    fixtureDir,
    {
      EXPO_NO_TELEMETRY: "1",
      CI: "1",
    }
  );
  const expoConfigRaw = run(
    ["bunx", "expo", "config", "--type", "public", "--json"],
    fixtureDir,
    {
      EXPO_NO_TELEMETRY: "1",
      CI: "1",
    }
  );
  const expoConfig = JSON.parse(expoConfigRaw);
  await Bun.write(join(distDir, "expoConfig.json"), `${JSON.stringify(expoConfig, null, 2)}\n`);
  run(
    [
      "bun",
      "run",
      "src/cli.ts",
      "publish",
      "--dist",
      distDir,
      "--platform",
      "ios",
      "--runtime",
      runtime,
      "--message",
      message,
    ],
    root,
    {
      AIRLOCK_SERVER: `http://127.0.0.1:${port}/ota`,
      AIRLOCK_TOKEN: token,
    }
  );
}

function ensureFixture() {
  if (!existsSync(fixtureDir)) {
    throw new Error(`fixture app not found: ${fixtureDir}`);
  }
}

async function buildRelease(marker: string) {
  await Bun.write(markerFile, `export const OTA_MARKER = "${marker}";\n`);
  setFixtureMarker(marker);
  run(
    [
      "bunx",
      "expo",
      "run:ios",
      "--configuration",
      "Release",
      "--no-bundler",
      "--device",
      simulatorName,
    ],
    fixtureDir,
    {
      EXPO_NO_TELEMETRY: "1",
      CI: "1",
    }
  );
}

function launchAndReadStatus(): OtaStatus {
  run(["xcrun", "simctl", "terminate", "booted", bundleId], root, undefined, true);
  run(["xcrun", "simctl", "launch", "booted", bundleId]);
  run(["sleep", "8"]);

  const dataDir = run(["xcrun", "simctl", "get_app_container", "booted", bundleId, "data"])
    .trim()
    .split("\n")
    .pop()!;
  const statusPath = join(dataDir, "Documents", "ota-status.json");
  const raw = run(["cat", statusPath]).trim();
  const status = JSON.parse(raw) as OtaStatus;
  console.log(`[ota-status] ${JSON.stringify(status, null, 2)}`);
  return status;
}

async function main() {
  ensureFixture();
  const timings: Array<{ step: string; ms: number }> = [];
  const startedAt = new Date().toISOString();

  const serverProc = Bun.spawn(
    ["bun", "run", "src/e2e/local-server.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        AIRLOCK_E2E_PORT: port,
        AIRLOCK_E2E_TOKEN: token,
      },
      stdout: "inherit",
      stderr: "inherit",
    }
  );

  try {
    await timeStep(timings, "wait_for_server", () =>
      waitForServer(`http://127.0.0.1:${port}/health`)
    );

    await timeStep(timings, "export_publish_v1", () =>
      exportAndPublish("v1", "fixture v1")
    );
    await timeStep(timings, "build_release_v1", () => buildRelease("v1"));

    const firstLaunch = await timeStep(timings, "first_launch", () =>
      Promise.resolve(launchAndReadStatus())
    );
    if (firstLaunch.marker !== "v1") {
      throw new Error(`expected first launch marker=v1, got ${firstLaunch.marker}`);
    }

    await timeStep(timings, "export_publish_v2", () =>
      exportAndPublish("v2", "fixture v2")
    );

    const secondLaunch = await timeStep(timings, "second_launch", () =>
      Promise.resolve(launchAndReadStatus())
    );
    if (secondLaunch.checkResult !== "update-fetched" && secondLaunch.checkResult !== "up-to-date") {
      throw new Error(`expected second launch to fetch/update, got ${secondLaunch.checkResult}`);
    }

    const thirdLaunch = await timeStep(timings, "third_launch", () =>
      Promise.resolve(launchAndReadStatus())
    );
    if (thirdLaunch.marker !== "v2") {
      throw new Error(`expected third launch marker=v2, got ${thirdLaunch.marker}`);
    }

    const totalMs = timings.reduce((sum, item) => sum + item.ms, 0);
    const report = {
      startedAt,
      completedAt: new Date().toISOString(),
      totalMs,
      timings,
      launches: {
        first: firstLaunch,
        second: secondLaunch,
        third: thirdLaunch,
      },
    };
    await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[airlock-e2e] timing report written to ${reportPath}`);

    console.log("PASS: iOS OTA loop complete (v1 -> v2).");
  } finally {
    await Bun.write(markerFile, 'export const OTA_MARKER = "v1";\n');
    setFixtureMarker("v1");
    serverProc.kill();
  }
}

await main();
