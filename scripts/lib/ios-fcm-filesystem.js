/* eslint-disable no-bitwise -- POSIX file flags and permission masks. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fail } = require('./ios-fcm-qualification');

const owners = new WeakMap();
const temporaryRoot = fs.realpathSync('/tmp');
const stamp = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid });
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid;
const violation = () =>
  fail(
    'PATH_CONFINEMENT_VIOLATION',
    'Qualification output ownership or physical confinement is unproven.',
  );
function physical(filename) {
  const full = path.resolve(filename);
  // /tmp is the system alias; no other symlink is an authority shortcut.
  return full === '/tmp' || full.startsWith('/tmp' + path.sep)
    ? path.join(temporaryRoot, path.relative('/tmp', full))
    : full;
}
function metadata(filename) {
  try {
    return fs.lstatSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}
function checkDirectory(filename, expected, device) {
  const stat = metadata(filename);
  if (
    !stat?.isDirectory() ||
    stat.isSymbolicLink() ||
    (filename !== temporaryRoot && stat.uid !== process.getuid()) ||
    (device !== undefined && stat.dev !== device) ||
    (expected && !same(stamp(stat), expected))
  )
    violation();
  return stamp(stat);
}
function createOwnedRoot(filename, { create = false, empty = false, requirePrivate = true } = {}) {
  const root = physical(filename);
  if (root === temporaryRoot || !inside(temporaryRoot, root)) violation();
  const approved = new Map([[temporaryRoot, checkDirectory(temporaryRoot)]]);
  let current = temporaryRoot;
  for (const name of path.relative(temporaryRoot, root).split(path.sep)) {
    current = path.join(current, name);
    if (!metadata(current)) {
      if (!create) violation();
      recheckEntries(approved);
      fs.mkdirSync(current, { mode: 0o700 });
    }
    approved.set(current, checkDirectory(current));
  }
  const stat = fs.lstatSync(root);
  if ((requirePrivate && (stat.mode & 0o077) !== 0) || (empty && fs.readdirSync(root).length))
    violation();
  const owner = Object.freeze({ root });
  owners.set(owner, { approved, anchors: new Map(approved), identity: stamp(stat) });
  return owner;
}
function recheckEntries(entries) {
  for (const [filename, expected] of entries) checkDirectory(filename, expected);
}
function rootState(owner) {
  const state = owners.get(owner);
  if (!state) violation();
  recheckEntries(state.anchors);
  return state;
}
function parents(owner, filename, create) {
  const state = rootState(owner);
  const full = physical(filename);
  if (!inside(owner.root, full)) violation();
  const chain = new Map(state.anchors);
  let current = owner.root;
  const parent = path.dirname(full);
  if (full !== owner.root) {
    for (const name of path.relative(owner.root, parent).split(path.sep).filter(Boolean)) {
      current = path.join(current, name);
      if (!metadata(current)) {
        if (!create) violation();
        recheckEntries(chain);
        fs.mkdirSync(current, { mode: 0o700 });
      }
      const entry = checkDirectory(current, state.approved.get(current), state.identity.dev);
      state.approved.set(current, entry);
      chain.set(current, entry);
    }
  }
  return { full, chain, state };
}
function finalFile(full) {
  const stat = metadata(full);
  if (
    stat &&
    (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.nlink !== 1)
  )
    violation();
  return stat;
}
function assertOwnedPath(owner, filename, { createParents = false, directory = false } = {}) {
  const approval = parents(owner, filename, createParents);
  if (directory) {
    const stat = metadata(approval.full);
    if (stat) {
      const entry = checkDirectory(
        approval.full,
        approval.state.approved.get(approval.full),
        approval.state.identity.dev,
      );
      approval.state.approved.set(approval.full, entry);
      approval.chain.set(approval.full, entry);
    }
  } else finalFile(approval.full);
  return approval;
}
function ensureOwnedDirectory(owner, filename) {
  const approval = assertOwnedPath(owner, filename, { createParents: true, directory: true });
  if (!metadata(approval.full)) {
    recheckEntries(approval.chain);
    fs.mkdirSync(approval.full, { mode: 0o700 });
    approval.state.approved.set(
      approval.full,
      checkDirectory(approval.full, undefined, approval.state.identity.dev),
    );
  }
  return approval.full;
}
function writeOwnedFile(owner, filename, bytes, { mode = 0o600, flag } = {}) {
  const approval = assertOwnedPath(owner, filename, { createParents: true });
  const existing = finalFile(approval.full);
  if (flag === 'wx' && existing) {
    const error = new Error('Owned output exists');
    error.code = 'EEXIST';
    throw error;
  }
  const temporary = path.join(
    path.dirname(approval.full),
    '.' + path.basename(approval.full) + '.qualification-' + crypto.randomUUID() + '.tmp',
  );
  let fd, temporaryIdentity;
  try {
    recheckEntries(approval.chain);
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    temporaryIdentity = stamp(fs.fstatSync(fd));
    if (temporaryIdentity.dev !== approval.state.identity.dev) violation();
    recheckEntries(approval.chain);
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, mode);
    fs.closeSync(fd);
    fd = undefined;
    recheckEntries(approval.chain);
    const final = finalFile(approval.full);
    if (!!existing !== !!final || (existing && !same(stamp(existing), stamp(final)))) violation();
    const temporaryStat = metadata(temporary);
    if (!temporaryStat || !same(stamp(temporaryStat), temporaryIdentity)) violation();
    // Required publication boundary: synchronous identity recheck of ALL
    // approved parents/root, immediately adjacent to the local rename.
    recheckEntries(approval.chain);
    fs.renameSync(temporary, approval.full);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    // A substituted parent cannot grant authority to unlink its contents.
    try {
      recheckEntries(approval.chain);
      const stat = metadata(temporary);
      if (
        stat &&
        temporaryIdentity &&
        same(stamp(stat), temporaryIdentity) &&
        !stat.isSymbolicLink()
      )
        fs.unlinkSync(temporary);
    } catch {
      /* Leave unproven entries for owned-root cleanup, never chase a link. */
    }
  }
}
function openOwnedLog(owner, filename) {
  const approval = assertOwnedPath(owner, filename, { createParents: true });
  const existing = finalFile(approval.full);
  const fd = fs.openSync(
    approval.full,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== approval.state.identity.dev ||
      (existing && !same(stamp(stat), stamp(existing)))
    )
      violation();
    recheckEntries(approval.chain);
    fs.ftruncateSync(fd, 0);
    fs.fchmodSync(fd, 0o600);
    return fs.createWriteStream(approval.full, { fd, autoClose: true });
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
function assertOwnedTree(owner, filename) {
  const approval = assertOwnedPath(owner, filename, { directory: true, createParents: true });
  if (!metadata(approval.full)) return;
  const visit = (directory, chain) => {
    for (const name of fs.readdirSync(directory)) {
      recheckEntries(chain);
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        const next = new Map(chain);
        next.set(file, checkDirectory(file, undefined, approval.state.identity.dev));
        visit(file, next);
      } else finalFile(file);
    }
  };
  visit(approval.full, approval.chain);
}
function copyOwnedFile(owner, from, to, options = {}) {
  writeOwnedFile(owner, to, fs.readFileSync(from), options);
}
function copyOwnedTree(owner, from, to) {
  const stat = fs.lstatSync(from);
  if (stat.isDirectory()) {
    ensureOwnedDirectory(owner, to);
    for (const name of fs.readdirSync(from))
      copyOwnedTree(owner, path.join(from, name), path.join(to, name));
    const approval = assertOwnedPath(owner, to, { directory: true });
    const fd = fs.openSync(approval.full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!same(stamp(fs.fstatSync(fd)), stamp(fs.lstatSync(approval.full)))) violation();
      recheckEntries(approval.chain);
      fs.fchmodSync(fd, stat.mode & 0o777);
    } finally {
      fs.closeSync(fd);
    }
  } else if (stat.isSymbolicLink()) {
    const approval = parents(owner, to, true);
    if (metadata(approval.full)) violation();
    const link = fs.readlinkSync(from);
    if (!inside(owner.root, physical(path.resolve(path.dirname(to), link)))) violation();
    recheckEntries(approval.chain);
    fs.symlinkSync(link, approval.full);
  } else if (stat.isFile()) copyOwnedFile(owner, from, to, { mode: stat.mode & 0o777 });
  else violation();
}
function assertRootAbsent(owner, state) {
  const ancestors = new Map(state.anchors);
  ancestors.delete(owner.root);
  recheckEntries(ancestors);
  // lstat distinguishes ENOENT from a dangling link or any replacement.
  if (metadata(owner.root)) violation();
}
function isOwnedRootRemoved(owner) {
  const state = owners.get(owner);
  if (!state) violation();
  if (!state.removed) return false;
  assertRootAbsent(owner, state);
  return true;
}
function removeOwnedRoot(owner) {
  if (isOwnedRootRemoved(owner)) return;
  const state = rootState(owner);
  // fs.rm unlinks symlink entries; it never resolves their target. Only the
  // registered root (not realpath of a replacement) grants removal authority.
  fs.rmSync(owner.root, { recursive: true });
  assertRootAbsent(owner, state);
  // Only successful removal and verified absence mint this same-run proof.
  state.removed = true;
}

module.exports = {
  createOwnedRoot,
  assertOwnedPath,
  ensureOwnedDirectory,
  writeOwnedFile,
  openOwnedLog,
  assertOwnedTree,
  copyOwnedFile,
  copyOwnedTree,
  isOwnedRootRemoved,
  removeOwnedRoot,
};
