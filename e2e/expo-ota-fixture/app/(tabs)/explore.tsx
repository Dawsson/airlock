import { Image } from 'expo-image';
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
  glassEffect,
  padding,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { Collapsible } from '@/components/ui/collapsible';
import { ExternalLink } from '@/components/external-link';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts } from '@/constants/theme';

export default function TabTwoScreen() {
  const [isLiquidSheetPresented, setIsLiquidSheetPresented] = useState(false);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText
          type="title"
          style={{
            fontFamily: Fonts.rounded,
          }}>
          Explore
        </ThemedText>
      </ThemedView>
      <ThemedText>This app includes example code to help you get started.</ThemedText>
      <Collapsible title="Native SwiftUI Liquid Glass sheet (iOS)">
        {Platform.OS === 'ios' ? (
          <Host style={styles.swiftUIHost}>
            <SwiftButton
              label="Open Native Liquid Glass Sheet"
              onPress={() => setIsLiquidSheetPresented(true)}
              modifiers={[buttonStyle('glassProminent')]}
            />
            <BottomSheet
              isPresented={isLiquidSheetPresented}
              onIsPresentedChange={setIsLiquidSheetPresented}
              fitToContents>
              <Group
                modifiers={[
                  presentationDetents([{ fraction: 0.35 }, 'medium', 'large']),
                  presentationDragIndicator('visible'),
                  padding({ all: 16 }),
                  glassEffect({
                    glass: {
                      variant: 'regular',
                      interactive: true,
                    },
                    shape: 'roundedRectangle',
                    cornerRadius: 24,
                  }),
                ]}>
                <VStack spacing={12} alignment="leading">
                  <SwiftText modifiers={[font({ size: 20, weight: 'semibold', design: 'rounded' })]}>
                    Liquid Glass Sheet
                  </SwiftText>
                  <SwiftText modifiers={[foregroundStyle('#6B7280')]}>
                    This sheet is rendered natively in SwiftUI via @expo/ui.
                  </SwiftText>
                  <SwiftButton
                    label="Close"
                    onPress={() => setIsLiquidSheetPresented(false)}
                    modifiers={[buttonStyle('glass')]}
                  />
                </VStack>
              </Group>
            </BottomSheet>
          </Host>
        ) : (
          <ThemedText>
            This demo uses SwiftUI primitives and runs on iOS builds.
          </ThemedText>
        )}
      </Collapsible>
      <Collapsible title="File-based routing">
        <ThemedText>
          This app has two screens:{' '}
          <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText> and{' '}
          <ThemedText type="defaultSemiBold">app/(tabs)/explore.tsx</ThemedText>
        </ThemedText>
        <ThemedText>
          The layout file in <ThemedText type="defaultSemiBold">app/(tabs)/_layout.tsx</ThemedText>{' '}
          sets up the tab navigator.
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/router/introduction">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Android, iOS, and web support">
        <ThemedText>
          You can open this project on Android, iOS, and the web. To open the web version, press{' '}
          <ThemedText type="defaultSemiBold">w</ThemedText> in the terminal running this project.
        </ThemedText>
      </Collapsible>
      <Collapsible title="Images">
        <ThemedText>
          For static images, you can use the <ThemedText type="defaultSemiBold">@2x</ThemedText> and{' '}
          <ThemedText type="defaultSemiBold">@3x</ThemedText> suffixes to provide files for
          different screen densities
        </ThemedText>
        <Image
          source={require('@/assets/images/react-logo.png')}
          style={{ width: 100, height: 100, alignSelf: 'center' }}
        />
        <ExternalLink href="https://reactnative.dev/docs/images">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Light and dark mode components">
        <ThemedText>
          This template has light and dark mode support. The{' '}
          <ThemedText type="defaultSemiBold">useColorScheme()</ThemedText> hook lets you inspect
          what the user&apos;s current color scheme is, and so you can adjust UI colors accordingly.
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/develop/user-interface/color-themes/">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Animations">
        <ThemedText>
          This template includes an example of an animated component. The{' '}
          <ThemedText type="defaultSemiBold">components/HelloWave.tsx</ThemedText> component uses
          the powerful{' '}
          <ThemedText type="defaultSemiBold" style={{ fontFamily: Fonts.mono }}>
            react-native-reanimated
          </ThemedText>{' '}
          library to create a waving hand animation.
        </ThemedText>
        {Platform.select({
          ios: (
            <ThemedText>
              The <ThemedText type="defaultSemiBold">components/ParallaxScrollView.tsx</ThemedText>{' '}
              component provides a parallax effect for the header image.
            </ThemedText>
          ),
        })}
      </Collapsible>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  swiftUIHost: {
    width: '100%',
    gap: 12,
  },
});
