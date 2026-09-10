/**
 * Zips `dist/` into a loadable extension archive for a GitHub Release.
 *
 * `dist/` is deliberately not committed: it is generated, and a checked-in copy
 * goes stale the moment someone edits source without rebuilding, leaving
 * cloners running code that does not match the repository. A release artifact
 * is built from a known commit and never drifts.
 *
 * Written against zlib rather than pulling in an archiver dependency, to keep
 * the dependency surface (and its audit surface) where it is.
 */
import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full, base)
      : [{ name: path.relative(base, full).split(path.sep).join('/'), full }];
  });
}

/** Fixed timestamp so an identical build produces an identical archive. */
const DOS_TIME = 0;
const DOS_DATE = 0x2821;

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = readFileSync(file.full);
    const deflated = deflateRawSync(raw, { level: 9 });
    // Storing is smaller than deflating for already-compressed data like PNGs.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(useDeflate ? 8 : 0, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(0, 42);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const distDir = path.join(root, 'dist');

if (!existsSync(path.join(distDir, 'manifest.json'))) {
  console.error('No dist/manifest.json — run `npm run build` first.');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = walk(distDir);
const archive = zip(files);
const out = path.join(root, `verdct-${version}.zip`);
writeFileSync(out, archive);

console.log(
  JSON.stringify(
    { archive: path.basename(out), files: files.length, bytes: archive.length },
    null,
    2,
  ),
);
