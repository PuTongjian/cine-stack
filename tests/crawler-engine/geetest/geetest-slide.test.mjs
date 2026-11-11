import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { test } from 'vitest'
import { findSlideOffset } from '../../../packages/crawler-engine/src/geetest/geetest-slide.mjs'

function fixture(withGap = true) {
  const bg = new PNG({ width: 180, height: 60 })
  bg.data.fill(240)
  const piece = new PNG({ width: 20, height: 20 })
  piece.data.fill(0)
  for (let y = 4; y <= 15; y++) {
    for (let x = 4; x <= 15; x++) {
      piece.data[(y * 20 + x) * 4 + 3] = 255
      if (withGap) {
        const i = ((5 + y) * 180 + 100 + x) * 4
        bg.data[i] = bg.data[i + 1] = bg.data[i + 2] = 20
      }
    }
  }
  return [PNG.sync.write(bg), PNG.sync.write(piece), 5]
}

test('finds a known alpha-shaped gap at a fixed offset', () => {
  const match = findSlideOffset(...fixture())
  assert.ok(Math.abs(match.offset - 100) <= 1)
  assert.equal(match.width, 180)
  assert.ok(match.score > 100)
})

test('rejects a flat image instead of guessing a drag distance', () => {
  assert.throws(() => findSlideOffset(...fixture(false)), /No confident/)
})

test('rejects impossible vertical image geometry', () => {
  const [bg, piece] = fixture()
  assert.throws(
    () => findSlideOffset(bg, piece, 50),
    /Invalid slide image geometry/
  )
})
