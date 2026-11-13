import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Animated, AppState, Linking, Platform } from 'react-native';
import notifee from 'react-native-notify-kit';
import App from '../App';

// These tests verify wiring and actual React tree replacement. Animated progress
// and onLayout are injected explicitly; they are NOT Android runtime evidence.
test('deep link drives native-animation config, replaces source children, settles once and repeats without rebuild', async () => {
  jest.useFakeTimers();
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;
  const originalState = AppState.currentState;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 37 });
  AppState.currentState = 'active';
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  const request = jest
    .spyOn(notifee, 'requestPermission')
    .mockResolvedValue({ authorizationStatus: 0 } as never);
  jest
    .spyOn(notifee, 'getNotificationSettings')
    .mockResolvedValue({ authorizationStatus: 0 } as never);
  jest.spyOn(notifee, 'shouldShowRequestPermissionRationale').mockResolvedValue(false);
  let progress!: (value: { value: number }) => void;
  let end!: (state: { finished: boolean }) => void;
  const add = jest.spyOn(Animated.Value.prototype, 'addListener').mockImplementation(callback => {
    progress = callback;
    return 'r5-listener';
  });
  const remove = jest
    .spyOn(Animated.Value.prototype, 'removeListener')
    .mockImplementation(() => undefined);
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockImplementation((_value, _config) => ({
    start: callback => {
      end = callback!;
    },
    stop,
    reset: jest.fn(),
  }));
  let tree!: ReactTestRenderer.ReactTestRenderer;
  const handle = (url: string) =>
    (
      globalThis as typeof globalThis & {
        __NOTIFEE_SMOKE_HANDLE_URL__: (url: string) => Promise<void>;
      }
    ).__NOTIFEE_SMOKE_HANDLE_URL__(url);
  try {
    await act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    expect(request).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
    await act(async () => {
      await handle('notifykit://smoke/run/issue92-r5?id=screen-1');
    });
    const source = tree.root.findByProps({ testID: 'r5-source-page' });
    const destination = tree.root.findByProps({ testID: 'r5-destination-page' });
    expect(source.props.collapsable).toBe(false);
    expect(destination.props.collapsable).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'r5-source-details' }).length).toBeGreaterThan(0);
    expect(timing).not.toHaveBeenCalled();
    await act(async () => {
      source.props.onLayout();
      destination.props.onLayout();
    });
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({
      useNativeDriver: true,
      duration: 1200,
      toValue: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(16);
      progress({ value: 0.02 });
    });
    expect(tree.root.findAllByProps({ testID: 'r5-source-details' })).toHaveLength(0);
    await act(async () => {
      tree.root.findByProps({ testID: 'r5-departure' }).props.onLayout();
      jest.advanceTimersByTime(160);
      progress({ value: 0.15 });
      jest.advanceTimersByTime(40);
    });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(984);
      end({ finished: true });
    });
    expect(tree.root.findAllByProps({ testID: 'r5-source-page' })).toHaveLength(0);
    const results = log.mock.calls
      .flat()
      .filter(value => typeof value === 'string' && value.startsWith('SMOKE:RESULT '));
    expect(results).toHaveLength(1);
    expect(JSON.parse(String(results[0]).slice('SMOKE:RESULT '.length))).toMatchObject({
      scenario: 'issue92-r5',
      id: 'screen-1',
      status: 'PASS',
    });
    await act(async () => {
      await handle('notifykit://smoke/run/issue92-r5?id=screen-2');
    });
    expect(tree.root.findAllByProps({ testID: 'r5-source-details' }).length).toBeGreaterThan(0);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1); // No double-remove on completed screen unmount.
    expect(stop).toHaveBeenCalledTimes(1);
  } finally {
    if (tree) await act(async () => tree.unmount());
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS });
    Object.defineProperty(Platform, 'Version', { value: originalVersion });
    AppState.currentState = originalState;
    jest.useRealTimers();
  }
});

test('F03: a pending manual permission request excludes automated R5 admission', async () => {
  jest.useFakeTimers();
  const os = Platform.OS;
  const version = Platform.Version;
  const state = AppState.currentState;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 37 });
  AppState.currentState = 'active';
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  let resolve!: (value: never) => void;
  const pending = new Promise<never>(yes => {
    resolve = yes;
  });
  const request = jest.spyOn(notifee, 'requestPermission').mockReturnValue(pending);
  request.mockClear();
  const timing = jest.spyOn(Animated, 'timing');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    const button = tree.root.findAll(
      node => typeof node.type === 'string' && node.props.children === 'requestPermission',
    )[0];
    let pressable = button.parent;
    while (pressable && typeof pressable.props.onPress !== 'function') pressable = pressable.parent;
    expect(pressable).not.toBeNull();
    await act(async () => {
      pressable!.props.onPress();
    });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      await (
        globalThis as typeof globalThis & {
          __NOTIFEE_SMOKE_HANDLE_URL__: (url: string) => Promise<void>;
        }
      ).__NOTIFEE_SMOKE_HANDLE_URL__('notifykit://smoke/run/issue92-r5?id=manual-overlap');
    });
    expect(tree.root.findAllByProps({ testID: 'issue92-r5-screen' })).toHaveLength(0);
    expect(timing).not.toHaveBeenCalled();
  } finally {
    resolve({ authorizationStatus: 0 } as never);
    await act(async () => {
      await pending;
      tree?.unmount();
    });
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { value: os });
    Object.defineProperty(Platform, 'Version', { value: version });
    AppState.currentState = state;
    jest.useRealTimers();
  }
});
