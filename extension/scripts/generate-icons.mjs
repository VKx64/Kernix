import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve(import.meta.dirname, '../public/icons')
mkdirSync(output, { recursive: true })

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

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function inRoundedSquare(x, y, size) {
  const inset = size * .055
  const radius = size * .23
  if (x < inset || y < inset || x > size - inset || y > size - inset) return false
  const closestX = Math.max(inset + radius, Math.min(x, size - inset - radius))
  const closestY = Math.max(inset + radius, Math.min(y, size - inset - radius))
  return (x - closestX) ** 2 + (y - closestY) ** 2 <= radius ** 2
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function iconPixel(x, y, size) {
  const samples = 4
  const total = [0, 0, 0, 0]
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const px = x + (sx + .5) / samples
      const py = y + (sy + .5) / samples
      if (!inRoundedSquare(px, py, size)) continue
      const blend = Math.min(1, Math.max(0, (px + py) / (size * 2)))
      let color = [181 - 68 * blend, 138 - 73 * blend, 255 - 43 * blend]
      const top = size * .24
      const middle = size * .5
      const bottom = size * .76
      const stemLeft = size * .29
      const stemRight = size * .395
      const jointX = size * .36
      const armX = size * .7
      const strokeRadius = size * .052
      const stem = px >= stemLeft && px <= stemRight && py >= top && py <= bottom
      const upperArm = distanceToSegment(px, py, jointX, middle, armX, top) <= strokeRadius
      const lowerArm = distanceToSegment(px, py, jointX, middle, armX, bottom) <= strokeRadius
      const letter = stem || upperArm || lowerArm
      if (letter) color = [255, 255, 255]
      total[0] += color[0]
      total[1] += color[1]
      total[2] += color[2]
      total[3] += 255
    }
  }
  const count = samples * samples
  return total.map((value) => Math.round(value / count))
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const pixel = iconPixel(x, y, size)
      raw.set(pixel, row + 1 + x * 4)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [16, 32, 48, 128]) writeFileSync(resolve(output, `icon-${size}.png`), png(size))
