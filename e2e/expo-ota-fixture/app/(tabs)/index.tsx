import { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as Updates from "expo-updates";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { OTA_MARKER } from "../ota-marker";

type OtaDiagnostics = {
  marker: string;
  runtimeVersion: string;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  checkResult: "idle" | "checking" | "up-to-date" | "update-fetched" | "error";
  fetchedUpdateId: string | null;
  error: string | null;
  launchAssetHash: string | null;
  launchAssetUrl: string | null;
  manifestCreatedAt: string | null;
  manifestRawId: string | null;
  checkDurationMs: number | null;
  fetchDurationMs: number | null;
  reloadRequestedAt: string | null;
  logs: string[];
  timestamp: string;
};

const STATUS_FILE = `${FileSystem.documentDirectory ?? ""}ota-status.json`;

export default function HomeScreen() {
  const currentManifest = (
    Updates.manifest
      ? Updates.manifest
      : Updates.manifestString
        ? JSON.parse(Updates.manifestString)
        : null
  ) as
    | {
        id?: string;
        createdAt?: string;
        launchAsset?: { hash?: string; url?: string };
        extra?: { expoClient?: { extra?: { otaMarker?: string } } };
      }
    | null;
  const marker =
    currentManifest?.extra?.expoClient?.extra?.otaMarker ??
    OTA_MARKER;

  function appendLog(logs: string[], message: string): string[] {
    const entry = `${new Date().toISOString()} ${message}`;
    return [entry, ...logs].slice(0, 30);
  }

  const [diagnostics, setDiagnostics] = useState<OtaDiagnostics>({
    marker,
    runtimeVersion: String(Updates.runtimeVersion ?? "unknown"),
    updateId: Updates.updateId ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    checkResult: "idle",
    fetchedUpdateId: null,
    error: null,
    launchAssetHash: currentManifest?.launchAsset?.hash ?? null,
    launchAssetUrl: currentManifest?.launchAsset?.url ?? null,
    manifestCreatedAt: currentManifest?.createdAt ?? null,
    manifestRawId: currentManifest?.id ?? null,
    checkDurationMs: null,
    fetchDurationMs: null,
    reloadRequestedAt: null,
    logs: [
      `${new Date().toISOString()} launch updateId=${Updates.updateId ?? "null"} marker=${marker} embedded=${String(Updates.isEmbeddedLaunch)}`,
    ],
    timestamp: new Date().toISOString(),
  });

  async function persist(next: OtaDiagnostics) {
    await FileSystem.writeAsStringAsync(STATUS_FILE, JSON.stringify(next, null, 2));
  }

  async function runUpdateCheck() {
    const checkStart = Date.now();
    let next: OtaDiagnostics = {
      ...diagnostics,
      checkResult: "checking",
      error: null,
      checkDurationMs: null,
      fetchDurationMs: null,
      timestamp: new Date().toISOString(),
      logs: appendLog(diagnostics.logs, "check started"),
    };
    setDiagnostics(next);

    try {
      const check = await Updates.checkForUpdateAsync();
      const checkDurationMs = Date.now() - checkStart;
      if (!check.isAvailable) {
        next = {
          ...next,
          checkResult: "up-to-date",
          fetchedUpdateId: null,
          updateId: Updates.updateId ?? null,
          checkDurationMs,
          timestamp: new Date().toISOString(),
          logs: appendLog(
            next.logs,
            `check complete: up-to-date in ${checkDurationMs}ms (updateId=${Updates.updateId ?? "null"})`
          ),
        };
        setDiagnostics(next);
        await persist(next);
        return;
      }

      const fetchStart = Date.now();
      const fetched = await Updates.fetchUpdateAsync();
      const fetchDurationMs = Date.now() - fetchStart;
      const fetchedUpdateId =
        fetched.manifest && "id" in fetched.manifest
          ? String(fetched.manifest.id)
          : null;

      next = {
        ...next,
        checkResult: "update-fetched",
        fetchedUpdateId,
        updateId: Updates.updateId ?? null,
        checkDurationMs,
        fetchDurationMs,
        reloadRequestedAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        logs: appendLog(
          next.logs,
          `fetch complete: fetchedUpdateId=${fetchedUpdateId ?? "null"} checkMs=${checkDurationMs} fetchMs=${fetchDurationMs}`
        ),
      };
      setDiagnostics(next);
      await persist(next);
      await persist({
        ...next,
        logs: appendLog(next.logs, "reload requested"),
      });
      await Updates.reloadAsync();
    } catch (error) {
      next = {
        ...next,
        checkResult: "error",
        error: error instanceof Error ? error.message : String(error),
        updateId: Updates.updateId ?? null,
        timestamp: new Date().toISOString(),
        logs: appendLog(
          next.logs,
          `check error: ${error instanceof Error ? error.message : String(error)}`
        ),
      };
      setDiagnostics(next);
      await persist(next);
    }
  }

  useEffect(() => {
    const initial = {
      ...diagnostics,
      timestamp: new Date().toISOString(),
    };
    setDiagnostics(initial);
    persist(initial).catch(() => {});
    runUpdateCheck().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Airlock OTA Fixture</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Marker</Text>
        <Text selectable testID="marker" style={styles.value}>{diagnostics.marker}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Manifest Marker (extra.otaMarker)</Text>
        <Text selectable testID="manifest-marker" style={styles.value}>
          {currentManifest?.extra?.expoClient?.extra?.otaMarker ?? "null"}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Runtime Version</Text>
        <Text selectable testID="runtime-version" style={styles.value}>{diagnostics.runtimeVersion}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Manifest Raw ID</Text>
        <Text selectable testID="manifest-raw-id" style={styles.value}>
          {diagnostics.manifestRawId ?? "null"}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Manifest Created At</Text>
        <Text selectable testID="manifest-created-at" style={styles.value}>
          {diagnostics.manifestCreatedAt ?? "null"}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Active Update ID</Text>
        <Text selectable testID="update-id" style={styles.value}>{diagnostics.updateId ?? "null"}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Launch Asset Hash</Text>
        <Text selectable testID="launch-asset-hash" style={styles.value}>
          {diagnostics.launchAssetHash ?? "null"}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Launch Asset URL</Text>
        <Text selectable testID="launch-asset-url" style={styles.value}>
          {diagnostics.launchAssetUrl ?? "null"}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Embedded Launch</Text>
        <Text selectable style={styles.value}>{String(diagnostics.isEmbeddedLaunch)}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Check Status</Text>
        <Text selectable testID="check-status" style={styles.value}>{diagnostics.checkResult}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Fetched Update ID</Text>
        <Text selectable testID="fetched-update-id" style={styles.value}>
          {diagnostics.fetchedUpdateId ?? "null"}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Last Error</Text>
        <Text selectable testID="last-error" style={styles.value}>{diagnostics.error ?? "none"}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Timings</Text>
        <Text selectable testID="timings" style={styles.value}>
          {`check=${diagnostics.checkDurationMs ?? "null"}ms fetch=${diagnostics.fetchDurationMs ?? "null"}ms`}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Status File</Text>
        <Text selectable style={styles.path}>{STATUS_FILE}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Debug Logs</Text>
        <Text selectable testID="debug-logs" style={styles.path}>
          {diagnostics.logs.join("\n")}
        </Text>
      </View>
      <Pressable style={styles.button} onPress={() => runUpdateCheck()}>
        <Text style={styles.buttonText}>Check/FETCH Update</Text>
      </Pressable>
      <Text style={styles.hint}>
        Restart the app after status says update-fetched to launch the new update.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12,
    backgroundColor: "#F3F5F8",
    minHeight: "100%",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#13233A",
    marginBottom: 8,
  },
  card: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  label: {
    fontSize: 12,
    color: "#506176",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    color: "#0A1A2F",
    fontWeight: "600",
  },
  path: {
    fontSize: 12,
    color: "#244B73",
  },
  button: {
    backgroundColor: "#0E5EA8",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  hint: {
    fontSize: 12,
    color: "#4D5D70",
  },
});
