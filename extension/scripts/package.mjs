import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const artifacts = resolve(root, 'artifacts')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
mkdirSync(artifacts, { recursive: true })

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let i = 0; i < 8; i++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

function dosDateTime(date = new Date('2026-01-01T00:00:00Z')) {
  const year = Math.max(1980, date.getUTCFullYear())
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

const localParts = []
const centralParts = []
let offset = 0
const timestamp = dosDateTime()
for (const file of files(dist).sort()) {
  const name = relative(dist, file).replaceAll('\\', '/')
  const nameBuffer = Buffer.from(name)
  const data = readFileSync(file)
  const checksum = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt16LE(timestamp.time, 10)
  local.writeUInt16LE(timestamp.date, 12)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuffer.length, 26)
  localParts.push(local, nameBuffer, data)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt16LE(timestamp.time, 12)
  central.writeUInt16LE(timestamp.date, 14)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuffer.length, 28)
  central.writeUInt32LE(offset, 42)
  centralParts.push(central, nameBuffer)
  offset += local.length + nameBuffer.length + data.length
}

const centralDirectory = Buffer.concat(centralParts)
const end = Buffer.alloc(22)
const count = centralParts.length / 2
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(count, 8)
end.writeUInt16LE(count, 10)
end.writeUInt32LE(centralDirectory.length, 12)
end.writeUInt32LE(offset, 16)

const target = resolve(artifacts, `${basename(packageJson.name)}-chromium-v${packageJson.version}.zip`)
writeFileSync(target, Buffer.concat([...localParts, centralDirectory, end]))
console.log(target)
