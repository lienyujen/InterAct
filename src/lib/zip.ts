// A store-only ZIP writer, so 下載全部 does not cost a dependency.
//
// Nothing here compresses: what students upload is photographs and PDFs, which
// are already compressed, so deflating them would burn CPU on thirty files to
// save a percent or two. Store-only ZIP is a short, fully specified format —
// local header, bytes, central directory, end record — and every unzip tool
// reads it, including Windows Explorer's built-in one.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// MS-DOS date and time, which is what the format stores. Seconds have one bit
// less than they need, hence the halving.
function dosStamp(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2))
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export type ZipEntry = { name: string; data: Uint8Array }

export function createZip(entries: ZipEntry[], now = new Date()): Blob {
  const encoder = new TextEncoder()
  const { time, day } = dosStamp(now)
  const locals: Array<ArrayBuffer | Uint8Array> = []
  const central: Array<ArrayBuffer | Uint8Array> = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    // Bit 11 says the name is UTF-8; without it a Chinese filename is read as
    // the reader's local code page and comes out as mojibake.
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 0, true) // stored, not deflated
    local.setUint16(10, time, true)
    local.setUint16(12, day, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, entry.data.length, true)
    local.setUint32(22, entry.data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true) // no extra field
    locals.push(local.buffer, name, entry.data)

    const directory = new DataView(new ArrayBuffer(46))
    directory.setUint32(0, 0x02014b50, true)
    directory.setUint16(4, 20, true) // version made by
    directory.setUint16(6, 20, true) // version needed
    directory.setUint16(8, 0x0800, true)
    directory.setUint16(10, 0, true)
    directory.setUint16(12, time, true)
    directory.setUint16(14, day, true)
    directory.setUint32(16, crc, true)
    directory.setUint32(20, entry.data.length, true)
    directory.setUint32(24, entry.data.length, true)
    directory.setUint16(28, name.length, true)
    directory.setUint16(30, 0, true) // extra
    directory.setUint16(32, 0, true) // comment
    directory.setUint16(34, 0, true) // disk number
    directory.setUint16(36, 0, true) // internal attributes
    directory.setUint32(38, 0, true) // external attributes
    directory.setUint32(42, offset, true)
    central.push(directory.buffer, name)

    offset += 30 + name.length + entry.data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  end.setUint16(20, 0, true) // no comment

  // One cast at the boundary rather than copying every file: a Uint8Array over
  // a plain ArrayBuffer is a valid BlobPart, but the type cannot say so without
  // ruling out SharedArrayBuffer, which nothing here produces.
  return new Blob([...locals, ...central, end.buffer] as BlobPart[], { type: 'application/zip' })
}

// Two students called 王小明 both uploading 作業.jpg would otherwise collapse
// into one entry, and the second would silently win.
export function uniqueName(taken: Set<string>, name: string) {
  if (!taken.has(name)) {
    taken.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 2; ; index += 1) {
    const candidate = `${stem} (${index})${extension}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
}

// Windows rejects these outright, and a stray slash would silently create a
// folder inside the archive.
export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file'
}
