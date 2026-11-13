import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { R5_DURATION_MS, type Issue92Run } from './issue92PermissionRace';

// A custom RN screen transition, NOT React Navigation. Both pages are real,
// non-collapsible views. React replaces the source details during the slide.
// onLayout only observes layout calculation; native mounting needs R5Native receipts.
export function Issue92PermissionRaceScreen({
  run,
  onBack,
}: {
  run: Issue92Run;
  onBack: () => void;
}) {
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const [departed, setDeparted] = useState(false);
  const [sourceRemoved, setSourceRemoved] = useState(false);

  useEffect(() => {
    let live = true;
    let departureRequested = false;
    let animation: Animated.CompositeAnimation | undefined;
    const listener = progress.addListener(({ value }) => {
      if (!live) return;
      run.progress(value);
      if (value > 0 && !departureRequested) {
        departureRequested = true;
        setDeparted(true);
      }
    });
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      progress.removeListener(listener);
      animation?.stop();
    };
    run.attach(() => {
      animation = Animated.timing(progress, {
        toValue: 1,
        duration: R5_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      run.dispatched();
      animation.start(({ finished }) => {
        if (!live) return;
        if (finished) setSourceRemoved(true);
        run.transitionEnded(finished);
      });
    }, stop);
    return () => {
      live = false;
      run.cancel();
      stop();
    };
  }, [progress, run]);

  return (
    <View style={styles.root} testID="issue92-r5-screen">
      <View collapsable={false} testID={`r5-run:${run.id}`} />
      <Text style={styles.header}>Issue #92 · R5 · {run.id}</Text>
      <Text>
        Slide: 1200 ms. Request: ~200 ms after JS progress. Native timing requires R5Native logs.
      </Text>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
        <Text>Back (available after settlement; use a new ID to repeat)</Text>
      </Pressable>
      <View style={styles.viewport}>
        {!sourceRemoved && (
          <Animated.View
            collapsable={false}
            testID="r5-source-page"
            onLayout={() => run.layout('source')}
            style={[
              styles.page,
              styles.source,
              {
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -width],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.title}>Source screen · {run.id}</Text>
            {departed ? (
              <View
                key="departure"
                collapsable={false}
                testID="r5-departure"
                onLayout={() => run.departureLayoutObserved()}
              >
                <Text>Source replacement requested during transition</Text>
              </View>
            ) : (
              <View key="details" collapsable={false} testID="r5-source-details">
                {Array.from({ length: 12 }, (_, index) => (
                  <View key={index} collapsable={false} style={styles.row}>
                    <Text>Source detail {index + 1}</Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>
        )}
        <Animated.View
          collapsable={false}
          testID="r5-destination-page"
          onLayout={() => run.layout('destination')}
          style={[
            styles.page,
            styles.destination,
            {
              transform: [
                {
                  translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.title}>Destination screen · {run.id}</Text>
          <Text>Record whether the Android permission dialog actually appears.</Text>
          <Text>
            ALLOW or DENY are valid settlements. An already decided state is a separate lane.
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff', paddingTop: 48 },
  header: { fontSize: 20, fontWeight: 'bold', padding: 12 },
  back: { padding: 16, backgroundColor: '#dddddd' },
  viewport: { flex: 1, overflow: 'hidden' },
  page: { ...StyleSheet.absoluteFill, padding: 20 },
  source: { backgroundColor: '#d6e9ff' },
  destination: { backgroundColor: '#d9f5df' },
  title: { fontSize: 24, marginBottom: 16 },
  row: { padding: 8, borderBottomWidth: 1, borderBottomColor: '#8899aa' },
});
