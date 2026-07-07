import { AppState, PermissionsAndroid, Platform } from 'react-native';
import notifee, {
  AndroidForegroundServiceType,
  AndroidImportance,
} from 'react-native-notify-kit';
import { logSmokeResult, smokeErrorReason } from './smokeAutomation';

const ISSUE44_PREFIX = 'notifykit://issue44/fgs-stop';
const ISSUE44_SCENARIO = 'issue44-fgs-stop';
const CHANNEL_ID = 'issue44_fgs_stop';
const NOTIFICATION_ID = 'issue44-fgs-stop';
const BACKGROUND_TIMEOUT_MS = 45000;
const STOP_DELAY_MS = 750;

type Issue44SupportedType = 'microphone' | 'dataSync';

export type Issue44FgsStopRequest = {
  types: Issue44SupportedType[];
  rawTypes: string;
};

type Issue44Global = typeof globalThis & {
  __NOTIFEE_ISSUE44_FGS_RUNNER__?: {
    notificationId: string;
    resolved: boolean;
    resolve?: () => void;
  };
  __NOTIFEE_ISSUE44_RUNNING__?: boolean;
};

function issue44Global(): Issue44Global {
  return globalThis as Issue44Global;
}

function logIssue44(marker: string, payload: Record<string, unknown> = {}): void {
  console.log(`ISSUE44:${marker} ${JSON.stringify({ loggedAt: Date.now(), ...payload })}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseIssue44Query(queryString: string): Record<string, string> {
  if (queryString.length === 0) {
    return {};
  }

  return queryString.split('&').reduce<Record<string, string>>((query, part) => {
    if (part.length === 0) {
      return query;
    }

    const separatorIndex = part.indexOf('=');
    const rawKey = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? '' : part.slice(separatorIndex + 1);

    try {
      query[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      query[rawKey] = rawValue;
    }

    return query;
  }, {});
}

function normalizeIssue44Type(type: string): Issue44SupportedType | null {
  const normalized = type.trim().toLowerCase().replace(/[-_]/g, '');

  switch (normalized) {
    case 'microphone':
      return 'microphone';
    case 'datasync':
      return 'dataSync';
    default:
      return null;
  }
}

function parseIssue44Types(rawTypes: string): Issue44SupportedType[] | null {
  const parsedTypes = rawTypes
    .split(/[|,]/)
    .map(normalizeIssue44Type)
    .filter((type): type is Issue44SupportedType => type != null);
  const uniqueTypes = Array.from(new Set(parsedTypes));

  if (uniqueTypes.length !== 2) {
    return null;
  }

  if (!uniqueTypes.includes('microphone') || !uniqueTypes.includes('dataSync')) {
    return null;
  }

  return uniqueTypes;
}

function foregroundServiceTypesFor(
  types: Issue44SupportedType[],
): AndroidForegroundServiceType[] {
  return types.map(type => {
    switch (type) {
      case 'microphone':
        return AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE;
      case 'dataSync':
        return AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
    }
  });
}

function platformApiLevel(): number | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  const version = Number(Platform.Version);
  return Number.isFinite(version) ? version : null;
}

function extractIssue44Query(url: string): Record<string, string> | null {
  if (!url.startsWith(ISSUE44_PREFIX)) {
    return null;
  }

  const rawPath = url.slice(ISSUE44_PREFIX.length).split('#')[0];
  if (rawPath.length > 0 && !rawPath.startsWith('?')) {
    return null;
  }

  return parseIssue44Query(rawPath.startsWith('?') ? rawPath.slice(1) : '');
}

export function extractIssue44FgsStopDeepLink(url: string): Issue44FgsStopRequest | null {
  const query = extractIssue44Query(url);
  if (query == null) {
    return null;
  }

  const rawTypes = query.types ?? 'microphone,dataSync';
  const types = parseIssue44Types(rawTypes);

  if (types == null) {
    return {
      types: [],
      rawTypes,
    };
  }

  return {
    types,
    rawTypes,
  };
}

async function ensureRecordAudioPermission(types: Issue44SupportedType[]): Promise<boolean> {
  if (!types.includes('microphone')) {
    return true;
  }

  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    logIssue44('RECORD_AUDIO_GRANTED', { source: 'check' });
    return true;
  }

  logIssue44('RECORD_AUDIO_REQUEST', {});
  const result = await PermissionsAndroid.request(permission);
  const granted = result === PermissionsAndroid.RESULTS.GRANTED;
  logIssue44(granted ? 'RECORD_AUDIO_GRANTED' : 'RECORD_AUDIO_DENIED', { result });
  return granted;
}

function installIssue44ForegroundServiceRunner(notificationId: string): void {
  const state = {
    notificationId,
    resolved: false,
    resolve: undefined as (() => void) | undefined,
  };

  issue44Global().__NOTIFEE_ISSUE44_FGS_RUNNER__ = state;

  notifee.registerForegroundService(notification => {
    const activeState = issue44Global().__NOTIFEE_ISSUE44_FGS_RUNNER__;
    const activeNotificationId =
      typeof notification.id === 'string' && notification.id.length > 0
        ? notification.id
        : null;

    logIssue44('FGS_RUNNER_STARTED', {
      notificationId: activeNotificationId,
      expectedNotificationId: notificationId,
    });

    if (activeState !== state || activeNotificationId !== notificationId) {
      logIssue44('FGS_RUNNER_IGNORED', {
        notificationId: activeNotificationId,
        expectedNotificationId: notificationId,
      });
      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      state.resolve = () => {
        logIssue44('FGS_RUNNER_RESOLVED', { notificationId });
        resolve();
      };

      if (state.resolved) {
        state.resolve();
      }
    });
  });
}

function resolveIssue44ForegroundServiceRunner(notificationId: string): void {
  const state = issue44Global().__NOTIFEE_ISSUE44_FGS_RUNNER__;
  if (state == null || state.notificationId !== notificationId || state.resolved) {
    return;
  }

  state.resolved = true;
  state.resolve?.();
}

function waitForBackground(): Promise<string> {
  if (AppState.currentState === 'background') {
    return Promise.resolve('background');
  }

  return new Promise((resolve, reject) => {
    let subscription: ReturnType<typeof AppState.addEventListener> | null = null;
    const timeout = setTimeout(() => {
      subscription?.remove();
      reject(new Error('background_timeout'));
    }, BACKGROUND_TIMEOUT_MS);

    subscription = AppState.addEventListener('change', nextState => {
      logIssue44('APP_STATE', { state: nextState });
      if (nextState !== 'background') {
        return;
      }

      clearTimeout(timeout);
      subscription?.remove();
      resolve(nextState);
    });
  });
}

function failIssue44(reason: string, extra: Record<string, unknown> = {}): void {
  logIssue44('FAIL', { reason, ...extra });
  logSmokeResult({
    scenario: ISSUE44_SCENARIO,
    status: 'FAIL',
    reason,
    ...extra,
  });
}

export async function executeIssue44FgsStopDeepLink(
  request: Issue44FgsStopRequest,
): Promise<void> {
  const globals = issue44Global();

  if (globals.__NOTIFEE_ISSUE44_RUNNING__) {
    failIssue44('scenario_already_running');
    return;
  }

  globals.__NOTIFEE_ISSUE44_RUNNING__ = true;

  try {
    if (Platform.OS !== 'android') {
      failIssue44('android_only');
      return;
    }

    const apiLevel = platformApiLevel();
    if (apiLevel != null && apiLevel < 34) {
      failIssue44('api_level_below_34', { apiLevel });
      return;
    }

    if (request.types.length === 0) {
      failIssue44('unsupported_types', { rawTypes: request.rawTypes });
      return;
    }

    const recordAudioGranted = await ensureRecordAudioPermission(request.types);
    if (!recordAudioGranted) {
      failIssue44('record_audio_permission_denied', { rawTypes: request.rawTypes });
      return;
    }

    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Issue 44 FGS stop',
      importance: AndroidImportance.HIGH,
    });

    installIssue44ForegroundServiceRunner(NOTIFICATION_ID);

    await notifee.displayNotification({
      id: NOTIFICATION_ID,
      title: 'Issue 44 FGS stop',
      body: `Running as ${request.types.join('|')}`,
      data: {
        smokeScenario: ISSUE44_SCENARIO,
        foregroundServiceTypes: request.types.join(','),
      },
      android: {
        channelId: CHANNEL_ID,
        ongoing: true,
        asForegroundService: true,
        foregroundServiceTypes: foregroundServiceTypesFor(request.types),
      },
    });

    logIssue44('READY_FOR_BACKGROUND', {
      apiLevel,
      notificationId: NOTIFICATION_ID,
      types: request.types,
    });

    const backgroundState = await waitForBackground();
    logIssue44('BACKGROUND', { state: backgroundState });
    await sleep(STOP_DELAY_MS);

    try {
      await notifee.stopForegroundService();
      logIssue44('STOP_RESOLVED', {
        notificationId: NOTIFICATION_ID,
        types: request.types,
      });
      logSmokeResult({
        scenario: ISSUE44_SCENARIO,
        status: 'PASS',
        notificationId: NOTIFICATION_ID,
        types: request.types,
      });
    } catch (error: unknown) {
      const reason = smokeErrorReason(error);
      logIssue44('STOP_REJECTED', {
        notificationId: NOTIFICATION_ID,
        reason,
      });
      logSmokeResult({
        scenario: ISSUE44_SCENARIO,
        status: 'FAIL',
        reason,
        notificationId: NOTIFICATION_ID,
        types: request.types,
      });
    } finally {
      resolveIssue44ForegroundServiceRunner(NOTIFICATION_ID);
    }
  } catch (error: unknown) {
    failIssue44(smokeErrorReason(error), { rawTypes: request.rawTypes });
    resolveIssue44ForegroundServiceRunner(NOTIFICATION_ID);
  } finally {
    globals.__NOTIFEE_ISSUE44_RUNNING__ = false;
  }
}
