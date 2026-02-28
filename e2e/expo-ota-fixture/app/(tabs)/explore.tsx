import {
  BottomSheet,
  Button as SwiftButton,
  Group,
  Host,
  Text as SwiftText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  padding,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ExploreScreen() {
  const [isLiquidSheetPresented, setIsLiquidSheetPresented] = useState(false);
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedView style={styles.heroCard}>
          <ThemedText type="title">Native Liquid Glass Sheet</ThemedText>
          <ThemedText style={styles.subtitle}>
            This Explorer tab now focuses on the iOS native SwiftUI sheet demo.
          </ThemedText>

          {Platform.OS === 'ios' ? (
            <Pressable
              style={[styles.primaryButton, { backgroundColor: palette.tint }]}
              onPress={() => setIsLiquidSheetPresented(true)}>
              <ThemedText style={styles.primaryButtonText}>Open Native Liquid Glass Sheet</ThemedText>
            </Pressable>
          ) : (
            <ThemedText style={styles.subtitle}>
              This button opens a native SwiftUI sheet and is available on iOS builds.
            </ThemedText>
          )}
        </ThemedView>
      </ScrollView>

      {Platform.OS === 'ios' ? (
        <Host style={styles.sheetHost}>
          <BottomSheet
            isPresented={isLiquidSheetPresented}
            onIsPresentedChange={setIsLiquidSheetPresented}>
            <Group
              modifiers={[
                presentationDetents(['medium']),
                presentationDragIndicator('visible'),
                presentationBackgroundInteraction('enabled'),
                padding({ top: 12, bottom: 28, horizontal: 24 }),
              ]}>
              <VStack spacing={16} alignment="center">
                <SwiftText modifiers={[font({ size: 24, weight: 'semibold', design: 'rounded' })]}>
                  Liquid Glass
                </SwiftText>
                <SwiftText modifiers={[foregroundStyle('#6B7280')]}>
                  Native SwiftUI BottomSheet from @expo/ui.
                </SwiftText>
                <SwiftButton
                  label="Close"
                  onPress={() => setIsLiquidSheetPresented(false)}
                  modifiers={[buttonStyle('glassProminent')]}
                />
              </VStack>
            </Group>
          </BottomSheet>
        </Host>
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
