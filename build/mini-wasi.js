/* Minimal WASI preview1 runtime for Clustal Omega.
   Only the calls emitted by the wasi-libc build are implemented. */
(function (root) {
  'use strict';

  const ERRNO = {
    SUCCESS: 0,
    BADF: 8,
    EXIST: 20,
    INVAL: 28,
    IO: 29,
    ISDIR: 31,
    NOENT: 44,
    NOSYS: 52,
    NOTDIR: 54,
  };

  const FILETYPE_DIRECTORY = 3;
  const FILETYPE_REGULAR_FILE = 4;

  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }

  function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  class MiniWASI {
    constructor(options = {}) {
      this.args = (options.args || ['clustalo']).slice();
      this.env = options.env || {};
      this.preopens = options.preopens || {};
      this.onStdout = options.onStdout || (() => {});
      this.onStderr = options.onStderr || (() => {});
      this.memory = null;
      this.fds = new Map();
      this.nextFd = 4;
      this.fs = new Map();

      // fd 0-2 are stdin/stdout/stderr; 3 is the first preopen.
      let preopenFd = 3;
      for (const [virtualPath, files] of Object.entries(this.preopens)) {
        this.fs.set(virtualPath, { type: 'dir', data: null });
        this.fds.set(preopenFd++, { type: 'dir', path: virtualPath, offset: 0 });
        for (const [name, content] of Object.entries(files || {})) {
          const p = virtualPath.replace(/\/$/, '') + '/' + name.replace(/^\//, '');
          this.fs.set(p, {
            type: 'file',
            data: typeof content === 'string' ? utf8Encode(content) : new Uint8Array(content),
            offset: 0,
          });
        }
      }
    }

    getImportObject() {
      const self = this;
      return {
        wasi_snapshot_preview1: {
          args_get: (argv, argvBuf) => self.argsGet(argv, argvBuf),
          args_sizes_get: (argc, argvBufSize) => self.argsSizesGet(argc, argvBufSize),
          environ_get: () => 0,
          environ_sizes_get: (count, size) => {
            self.u32(count, 0);
            self.u32(size, 0);
            return 0;
          },
          clock_time_get: (id, precision, out) => self.clockTimeGet(id, precision, out),
          fd_close: (fd) => self.fdClose(fd),
          fd_fdstat_get: (fd, out) => self.fdFdstatGet(fd, out),
          fd_fdstat_set_flags: () => 0,
          fd_prestat_get: (fd, out) => self.fdPrestatGet(fd, out),
          fd_prestat_dir_name: (fd, path, len) => self.fdPrestatDirName(fd, path, len),
          fd_read: (fd, iovs, iovsLen, nread) => self.fdRead(fd, iovs, iovsLen, nread),
          fd_seek: (fd, offset, whence, newoffset) => self.fdSeek(fd, offset, whence, newoffset),
          fd_write: (fd, iovs, iovsLen, nwritten) => self.fdWrite(fd, iovs, iovsLen, nwritten),
          path_open: (dirfd, dirflags, pathPtr, pathLen, oflags, rightsBase, rightsInheriting, fdflags, openedFd) =>
            self.pathOpen(dirfd, pathPtr, pathLen, oflags, openedFd),
          path_remove_directory: (dirfd, pathPtr, pathLen) => self.pathRemove(dirfd, pathPtr, pathLen),
          path_unlink_file: (dirfd, pathPtr, pathLen) => self.pathRemove(dirfd, pathPtr, pathLen),
          proc_exit: (code) => {
            throw { __wasiExit: true, code };
          },
        },
      };
    }

    start(instance) {
      this.memory = instance.exports.memory;
      try {
        instance.exports._start();
      } catch (err) {
        if (err && err.__wasiExit) return err.code;
        throw err;
      }
      return 0;
    }

    mem() {
      return new DataView(this.memory.buffer);
    }

    u8(ptr, value) {
      this.mem().setUint8(ptr, value);
    }

    u16(ptr, value) {
      this.mem().setUint16(ptr, value, true);
    }

    u32(ptr, value) {
      this.mem().setUint32(ptr, value >>> 0, true);
    }

    i64(ptr, value) {
      this.mem().setBigInt64(ptr, BigInt(value), true);
    }

    u64(ptr, value) {
      this.mem().setBigUint64(ptr, BigInt(value), true);
    }

    bytes(ptr, len) {
      return new Uint8Array(this.memory.buffer, ptr, len);
    }

    writeString(ptr, str) {
      const b = utf8Encode(str);
      this.bytes(ptr, b.length).set(b);
      return b.length;
    }

    argsSizesGet(argcPtr, bufSizePtr) {
      const bufSize = this.args.reduce((n, a) => n + utf8Encode(a).length + 1, 0);
      this.u32(argcPtr, this.args.length);
      this.u32(bufSizePtr, bufSize);
      return 0;
    }

    argsGet(argvPtr, argvBufPtr) {
      let cursor = argvBufPtr;
      for (let i = 0; i < this.args.length; i++) {
        const b = utf8Encode(this.args[i]);
        this.u32(argvPtr + i * 4, cursor);
        this.bytes(cursor, b.length).set(b);
        this.u8(cursor + b.length, 0);
        cursor += b.length + 1;
      }
      return 0;
    }

    clockTimeGet(id, precision, outPtr) {
      let nanos;
      if (id === 0) {
        nanos = BigInt(Date.now()) * 1000000n;
      } else if (id === 1 || id === 2 || id === 3) {
        nanos = BigInt(Math.round((typeof performance !== 'undefined' ? performance.now() : 0) * 1e6));
      } else {
        return ERRNO.INVAL;
      }
      this.u64(outPtr, nanos);
      return 0;
    }

    fdClose(fd) {
      if (fd <= 2) return 0;
      this.fds.delete(fd);
      return 0;
    }

    fdFdstatGet(fd, outPtr) {
      const entry = this.fds.get(fd);
      if (!entry) return ERRNO.BADF;
      this.u8(outPtr, entry.type === 'dir' ? FILETYPE_DIRECTORY : FILETYPE_REGULAR_FILE);
      this.u8(outPtr + 1, 0);
      this.u16(outPtr + 2, 0);
      this.u64(outPtr + 8, 0xffffffffffffffffn);
      this.u64(outPtr + 16, 0xffffffffffffffffn);
      return 0;
    }

    fdPrestatGet(fd, outPtr) {
      const entry = this.fds.get(fd);
      if (!entry || entry.type !== 'dir') return ERRNO.BADF;
      this.mem().setUint32(outPtr, 0, true); // preopentype::dir
      this.mem().setUint32(outPtr + 4, utf8Encode(entry.path).length, true);
      return 0;
    }

    fdPrestatDirName(fd, pathPtr, pathLen) {
      const entry = this.fds.get(fd);
      if (!entry || entry.type !== 'dir') return ERRNO.BADF;
      const b = utf8Encode(entry.path);
      const n = Math.min(pathLen, b.length);
      this.bytes(pathPtr, n).set(b.subarray(0, n));
      return 0;
    }

    fdRead(fd, iovsPtr, iovsLen, nreadPtr) {
      if (fd === 0) {
        this.u32(nreadPtr, 0);
        return 0;
      }
      const entry = this.fds.get(fd);
      if (!entry || entry.type === 'dir') return ERRNO.BADF;
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = this.mem().getUint32(iovsPtr + i * 8, true);
        const len = this.mem().getUint32(iovsPtr + i * 8 + 4, true);
        const remaining = entry.data.length - entry.offset;
        const n = Math.max(0, Math.min(len, remaining));
        if (n > 0) {
          this.bytes(ptr, n).set(entry.data.subarray(entry.offset, entry.offset + n));
          entry.offset += n;
          total += n;
        }
        if (n < len) break;
      }
      this.u32(nreadPtr, total);
      return 0;
    }

    fdSeek(fd, offset, whence, newOffsetPtr) {
      const entry = this.fds.get(fd);
      if (!entry || entry.type === 'dir') return ERRNO.BADF;
      const delta = Number(offset);
      let next;
      if (whence === 0) next = delta;
      else if (whence === 1) next = entry.offset + delta;
      else if (whence === 2) next = entry.data.length + delta;
      else return ERRNO.INVAL;
      if (next < 0) return ERRNO.INVAL;
      entry.offset = next;
      this.u64(newOffsetPtr, BigInt(next));
      return 0;
    }

    fdWrite(fd, iovsPtr, iovsLen, nwrittenPtr) {
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = this.mem().getUint32(iovsPtr + i * 8, true);
        const len = this.mem().getUint32(iovsPtr + i * 8 + 4, true);
        if (!len) continue;
        const chunk = this.bytes(ptr, len).slice();
        if (fd === 1) this.onStdout(utf8Decode(chunk));
        else if (fd === 2) this.onStderr(utf8Decode(chunk));
        else {
          const entry = this.fds.get(fd);
          if (!entry || entry.type === 'dir') return ERRNO.BADF;
          const end = entry.offset + chunk.length;
          if (end > entry.data.length) {
            const grown = new Uint8Array(end);
            grown.set(entry.data);
            entry.data = grown;
          }
          entry.data.set(chunk, entry.offset);
          entry.offset = end;
        }
        total += len;
      }
      this.u32(nwrittenPtr, total);
      return 0;
    }

    pathOpen(dirfd, pathPtr, pathLen, oflags, openedFdPtr) {
      const parent = this.fds.get(dirfd);
      if (!parent || parent.type !== 'dir') return ERRNO.BADF;
      let p = utf8Decode(this.bytes(pathPtr, pathLen));
      if (p.startsWith('/')) {
        const roots = Array.from(this.fs.keys()).filter((k) => this.fs.get(k).type === 'dir');
        const root = roots.find((r) => p === r || p.startsWith(r.replace(/\/$/, '') + '/'));
        if (!root) return ERRNO.NOENT;
        p = p.slice(root.length).replace(/^\//, '');
      }
      p = p.replace(/^\.\//, '');
      const full = parent.path.replace(/\/$/, '') + '/' + p;
      let node = this.fs.get(full);
      const isDir = (oflags & 2) !== 0;
      if (!node) {
        if (isDir) {
          node = { type: 'dir' };
          this.fs.set(full, node);
        } else if (oflags & 1) {
          node = { type: 'file', data: new Uint8Array(0), offset: 0 };
          this.fs.set(full, node);
        } else {
          return ERRNO.NOENT;
        }
      }
      if (node.type === 'dir') {
        if (!isDir) return ERRNO.ISDIR;
      } else if (isDir) {
        return ERRNO.NOTDIR;
      }
      if (oflags & 8) node.data = new Uint8Array(0);
      node.offset = 0;
      const fd = this.nextFd++;
      this.fds.set(fd, node);
      this.u32(openedFdPtr, fd);
      return 0;
    }

    pathRemove(dirfd, pathPtr, pathLen) {
      const parent = this.fds.get(dirfd);
      if (!parent || parent.type !== 'dir') return ERRNO.BADF;
      let p = utf8Decode(this.bytes(pathPtr, pathLen));
      if (p.startsWith('/')) {
        const roots = Array.from(this.fs.keys()).filter((k) => this.fs.get(k).type === 'dir');
        const root = roots.find((r) => p === r || p.startsWith(r.replace(/\/$/, '') + '/'));
        if (!root) return ERRNO.NOENT;
        p = p.slice(root.length).replace(/^\//, '');
      }
      const full = parent.path.replace(/\/$/, '') + '/' + p;
      return this.fs.delete(full) ? 0 : ERRNO.NOENT;
    }
  }

  root.MiniWASI = MiniWASI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
