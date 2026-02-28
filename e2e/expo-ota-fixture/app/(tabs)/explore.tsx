import { useMemo, useState } from 'react';
import { NativeModules, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type SwiftUIPack = {
  ui: any;
  modifiers: any;
} | null;

function loadSwiftUI(): SwiftUIPack {
  if (Platform.OS !== 'ios' || !(NativeModules as { ExpoUI?: unknown }).ExpoUI) {
    return null;
  }
  try {
    return {
      ui: require('@expo/ui/swift-ui'),
      modifiers: require('@expo/ui/swift-ui/modifiers'),
    };
  } catch {
    return null;
  }
}

export default function ExploreScreen() {
  const [isLiquidSheetPresented, setIsLiquidSheetPresented] = useState(false);
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const swiftUI = useMemo(() => loadSwiftUI(), []);
  const canUseSwiftUISheet = !!swiftUI;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedView style={styles.heroCard}>
          <ThemedText type="title">Native Liquid Glass Sheet</ThemedText>
          <ThemedText style={styles.subtitle}>
            This Explorer tab focuses on the iOS native SwiftUI sheet demo.
          </ThemedText>

          {canUseSwiftUISheet ? (
            <Pressable
              style={[styles.primaryButton, { backgroundColor: palette.tint }]}
              onPress={() => setIsLiquidSheetPresented(true)}>
              <ThemedText style={styles.primaryButtonText}>Open Native Liquid Glass Sheet</ThemedText>
            </Pressable>
          ) : (
            <ThemedText style={styles.subtitle}>
              Native SwiftUI sheet is unavailable in this installed binary.
            </ThemedText>
          )}
        </ThemedView>
      </ScrollView>

      {canUseSwiftUISheet ? (
        <swiftUI.ui.Host style={styles.sheetHost}>
          <swiftUI.ui.BottomSheet
            isPresented={isLiquidSheetPresented}
            onIsPresentedChange={setIsLiquidSheetPresented}>
            <swiftUI.ui.Group
              modifiers={[
                swiftUI.modifiers.presentationDetents(['medium']),
                swiftUI.modifiers.presentationDragIndicator('visible'),
                swiftUI.modifiers.presentationBackgroundInteraction('enabled'),
                swiftUI.modifiers.padding({ top: 12, bottom: 28, horizontal: 24 }),
              ]}>
              <swiftUI.ui.VStack spacing={16} alignment="center">
                <swiftUI.ui.Text
                  modifiers={[swiftUI.modifiers.font({ size: 24, weight: 'semibold', design: 'rounded' })]}>
                  Liquid Glass
                </swiftUI.ui.Text>
                <swiftUI.ui.Text modifiers={[swiftUI.modifiers.foregroundStyle('#6B7280')]}>
                  Native SwiftUI BottomSheet from @expo/ui.
                </swiftUI.ui.Text>
                <swiftUI.ui.Button
                  label="Close"
                  onPress={() => setIsLiquidSheetPresented(false)}
                  modifiers={[swiftUI.modifiers.buttonStyle('glassProminent')]}
                />
              </swiftUI.ui.VStack>
            </swiftUI.ui.Group>
          </swiftUI.ui.BottomSheet>
        </swiftUI.ui.Host>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingTop: 28,
    paddingBottom: 40,
  },
  heroCard: {
    padding: 24,
    borderRadius: 20,
    gap: 14,
  },
  subtitle: {
    lineHeight: 22,
  },
  primaryButton: {
    marginTop: 10,
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  sheetHost: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
