const { spawn } = require('node:child_process');
const { QualificationError } = require('./ios-fcm-qualification');

// Private to qualification tooling. A process is settled only after its leader
// and its owned process group are absent, not merely after a Promise resolves.
function runBounded(command, args, options = {}) {
  const {
    timeoutMs = 30000,
    graceMs = 3000,
    settleMs = 1000,
    timeoutCode = 'QUALIFICATION_TOOLING_FAILURE',
    spawnImpl = spawn,
    killImpl = process.kill.bind(process),
  } = options;
  for (const [name, value] of Object.entries({ timeoutMs, graceMs, settleMs }))
    if (!Number.isFinite(value) || value < 0 || (name !== 'timeoutMs' && !value))
      throw new QualificationError('QUALIFICATION_TOOLING_FAILURE', 'Invalid subprocess deadline.');
  return new Promise((resolve, reject) => {
    const evidence = {
      pid: null,
      timeout: false,
      signals: [],
      exitCode: null,
      exitSignal: null,
      settled: false,
      closed: false,
    };
    let child, deadline, grace, settlement, drain, poll;
    let exited = false,
      stopping = false,
      finished = false,
      failure;
    let stdout = '',
      stderr = '',
      bytes = 0;
    const clear = () => {
      for (const timer of [deadline, grace, settlement, drain, poll]) clearTimeout(timer);
    };
    const groupAbsent = () => {
      if (!child?.pid) return true;
      try {
        killImpl(-child.pid, 0);
        return false;
      } catch (error) {
        return error.code === 'ESRCH';
      }
    };
    const finish = unproven => {
      if (finished) return;
      finished = true;
      clear();
      evidence.settled = !unproven && (exited || !child?.pid) && groupAbsent();
      if (!evidence.settled) {
        failure = new QualificationError(
          'PROCESS_SETTLEMENT_UNPROVEN',
          'Owned subprocess termination could not be proven within its settlement deadline.',
        );
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.stdin?.destroy();
        child?.unref?.();
      } else if (evidence.timeout) {
        failure = new QualificationError(
          timeoutCode,
          'Owned subprocess exceeded its finite deadline and was terminated.',
        );
      } else if (
        !failure &&
        (evidence.exitCode !== 0 || evidence.exitSignal) &&
        !(stopping && options.acceptStopped)
      ) {
        failure = new QualificationError(
          'QUALIFICATION_BUILD_FAILURE',
          'Owned subprocess exited unsuccessfully.',
        );
      }
      if (failure) {
        failure.process = Object.freeze({ ...evidence, signals: [...evidence.signals] });
        reject(failure);
      } else
        resolve({
          stdout,
          stderr,
          process: Object.freeze({ ...evidence, signals: [...evidence.signals] }),
        });
    };
    const tryFinish = () => {
      if (finished) return;
      if ((exited || !child?.pid) && evidence.closed && groupAbsent()) finish(false);
    };
    const signal = value => {
      if (!child?.pid) return;
      evidence.signals.push(value);
      try {
        killImpl(-child.pid, value);
      } catch (error) {
        if (error.code !== 'ESRCH') failure ??= error;
      }
    };
    const stop = reason => {
      if (finished || stopping) return;
      stopping = true;
      evidence.timeout = reason === 'timeout';
      clearTimeout(deadline);
      // Install timers before signalling: test adapters and short-lived tools
      // can emit exit/close synchronously from kill().
      grace = setTimeout(() => {
        settlement = setTimeout(() => finish(true), settleMs);
        signal('SIGKILL');
        const check = () => {
          tryFinish();
          if (!finished) poll = setTimeout(check, 20);
        };
        check();
      }, graceMs);
      signal('SIGTERM');
      tryFinish();
    };
    const consume = (kind, chunk) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > (options.maxBuffer ?? 16 * 1024 * 1024)) {
        failure ??= new QualificationError(
          'QUALIFICATION_TOOLING_FAILURE',
          'Owned subprocess output exceeded its bounded buffer.',
        );
        stop('buffer');
        return;
      }
      if (options.capture !== false) {
        if (kind === 'stdout') stdout += chunk.toString();
        else stderr += chunk.toString();
      }
      try {
        options[kind === 'stdout' ? 'onStdout' : 'onStderr']?.(chunk);
      } catch (error) {
        failure ??= error;
        stop('consumer');
      }
    };
    try {
      child = spawnImpl(command, args, {
        cwd: options.cwd,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: options.env ?? {
          ...process.env,
          IOS_FCM_TOKEN: '',
          FCM_TOKEN: '',
          ANDROID_FCM_TOKEN: '',
        },
      });
    } catch (error) {
      failure = error;
      evidence.closed = true;
      finish(false);
      return;
    }
    evidence.pid = child.pid ?? null;
    child.stdout?.on('data', chunk => consume('stdout', chunk));
    child.stderr?.on('data', chunk => consume('stderr', chunk));
    child.stdin?.on('error', error => {
      if (error.code !== 'EPIPE') {
        failure ??= error;
        stop('stdin');
      }
    });
    child.on('error', error => {
      failure ??= error;
      if (!child.pid) {
        evidence.closed = true;
        finish(false);
      } else stop('error');
    });
    child.on('exit', (code, value) => {
      exited = true;
      evidence.exitCode = code;
      evidence.exitSignal = value;
      if (!groupAbsent()) stop('descendants');
      // Even an escaped descendant retaining a pipe cannot block collection.
      drain = setTimeout(() => finish(true), graceMs + settleMs);
      tryFinish();
    });
    child.on('close', (code, value) => {
      exited = true;
      evidence.closed = true;
      evidence.exitCode = code;
      evidence.exitSignal = value;
      if (!groupAbsent()) stop('descendants');
      tryFinish();
    });
    if (timeoutMs) deadline = setTimeout(() => stop('timeout'), timeoutMs);
    try {
      options.onSpawn?.(child, { stop: () => stop('cancel') });
      child.stdin?.end(options.input);
    } catch (error) {
      failure ??= error;
      stop('setup');
    }
  });
}

module.exports = { runBounded };
