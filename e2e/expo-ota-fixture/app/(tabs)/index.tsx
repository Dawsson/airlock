import { useEffect, useMemo, useState } from "react";
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
  timestamp: string;
};

const STATUS_FILE = `${FileSystem.documentDirectory ?? ""}ota-status.json`;

export default function HomeScreen() {
  const marker = useMemo(() => OTA_MARKER, []);
  const [diagnostics, setDiagnostics] = useState<OtaDiagnostics>({
    marker,
    runtimeVersion: String(Updates.runtimeVersion ?? "unknown"),
    updateId: Updates.updateId ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    checkResult: "idle",
    fetchedUpdateId: null,
    error: null,
    timestamp: new Date().toISOString(),
  });

  async function persist(next: OtaDiagnostics) {
    await FileSystem.writeAsStringAsync(STATUS_FILE, JSON.stringify(next, null, 2));
  }

  async function runUpdateCheck() {
    let next: OtaDiagnostics = {
      ...diagnostics,
      checkResult: "checking",
      timestamp: new Date().toISOString(),
    };
    setDiagnostics(next);

    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        next = {
          ...next,
          checkResult: "up-to-date",
          fetchedUpdateId: null,
          updateId: Updates.updateId ?? null,
          timestamp: new Date().toISOString(),
        };
        setDiagnostics(next);
        await persist(next);
        return;
      }

      const fetched = await Updates.fetchUpdateAsync();
      const fetchedUpdateId =
        fetched.manifest && "id" in fetched.manifest
          ? String(fetched.manifest.id)
          : null;

      next = {
        ...next,
        checkResult: "update-fetched",
        fetchedUpdateId,
        updateId: Updates.updateId ?? null,
        timestamp: new Date().toISOString(),
      };
      setDiagnostics(next);
      await persist(next);
      // Apply the freshly downloaded update immediately so the next cold launch
      // is guaranteed to boot the new bundle in e2e validation.
      await Updates.reloadAsync();
    } catch (error) {
      next = {
        ...next,
        checkResult: "error",
        error: error instanceof Error ? error.message : String(error),
        updateId: Updates.updateId ?? null,
        timestamp: new Date().toISOString(),
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
        <Text style={styles.label}>Runtime Version</Text>
        <Text selectable testID="runtime-version" style={styles.value}>{diagnostics.runtimeVersion}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Active Update ID</Text>
        <Text selectable testID="update-id" style={styles.value}>{diagnostics.updateId ?? "null"}</Text>
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
        <Text style={styles.label}>Status File</Text>
        <Text selectable style={styles.path}>{STATUS_FILE}</Text>
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
