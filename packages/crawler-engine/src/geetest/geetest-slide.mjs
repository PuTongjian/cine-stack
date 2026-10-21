import { PNG } from 'pngjs';

export function findSlideOffset(background, slice, ypos) {
  const bg = PNG.sync.read(background);
  const piece = PNG.sync.read(slice);
  if (!Number.isInteger(ypos) || ypos < 0 || ypos + piece.height > bg.height) {
    throw new Error('Invalid slide image geometry.');
  }
  const alpha = (x, y) => x < 0 || y < 0 || x >= piece.width || y >= piece.height
    ? 0 : piece.data[(y * piece.width + x) * 4 + 3];
  const border = [];
  for (let y = 3; y < piece.height - 3; y++) {
    for (let x = 3; x < piece.width - 3; x++) {
      if (alpha(x, y) < 200) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (alpha(x + dx * 3, y + dy * 3) < 30 && alpha(x - dx * 2, y - dy * 2) > 200) {
          border.push([x, y, dx, dy]);
        }
      }
    }
  }
  if (border.length < 20) throw new Error('The slide image has no usable alpha boundary.');
  const brightness = (x, y) => {
    const i = (y * bg.width + x) * 4;
    return (bg.data[i] + bg.data[i + 1] + bg.data[i + 2]) / 3;
  };
  let best = { offset: 0, score: -Infinity, width: bg.width };
  for (let offset = 30; offset <= bg.width - piece.width; offset++) {
    let score = 0;
    for (const [x, y, dx, dy] of border) {
      score += brightness(offset + x + dx * 3, ypos + y + dy * 3)
        - brightness(offset + x - dx * 2, ypos + y - dy * 2);
    }
    score /= border.length;
    if (score > best.score) best = { offset, score, width: bg.width };
  }
  if (best.score < 5) throw new Error('No confident slide gap match was found.');
  return best;
}
