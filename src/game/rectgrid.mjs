// Reusable screen-space rectangle index for the see-through sprite compositor.
// Buckets are retained between frames; only cells touched by the prior frame are cleared.
export class RectGrid {
  constructor(cols = 32, rows = 32) {
    this.cols = cols; this.rows = rows;
    this.cells = Array.from({ length: cols * rows }, () => []);
    this.used = [];
    this.seen = new Uint32Array(8192);
    this.stamp = 0;
    this.cellW = 1; this.cellH = 1;
    this.rangeOut = [0, 0, 0, 0];
  }

  reset(width, height) {
    for (const index of this.used) this.cells[index].length = 0;
    this.used.length = 0;
    this.cellW = Math.max(1, width / this.cols);
    this.cellH = Math.max(1, height / this.rows);
  }

  range(x0, y0, x1, y1) {
    const out = this.rangeOut;
    out[0] = Math.max(0, Math.floor(x0 / this.cellW));
    out[1] = Math.max(0, Math.floor(y0 / this.cellH));
    out[2] = Math.min(this.cols - 1, Math.floor(x1 / this.cellW));
    out[3] = Math.min(this.rows - 1, Math.floor(y1 / this.cellH));
    return out[0] <= out[2] && out[1] <= out[3];
  }

  insert(id, flatRects, offset = 0) {
    if (!this.range(flatRects[offset], flatRects[offset + 1], flatRects[offset + 2], flatRects[offset + 3])) return;
    const range = this.rangeOut;
    const [x0, y0, x1, y1] = range;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const index = y * this.cols + x, cell = this.cells[index];
      if (!cell.length) this.used.push(index);
      cell.push(id);
    }
  }

  overlapsAny(rect, flatRects) {
    if (!this.range(rect[0], rect[1], rect[2], rect[3])) return false;
    const range = this.rangeOut;
    let stamp = ++this.stamp;
    if (!stamp) { this.seen.fill(0); stamp = this.stamp = 1; }
    const [x0, y0, x1, y1] = range;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = this.cells[y * this.cols + x];
      for (let i = 0; i < cell.length; i++) {
        const id = cell[i];
        if (id >= this.seen.length) {
          const grown = new Uint32Array(Math.max(id + 1, this.seen.length * 2));
          grown.set(this.seen); this.seen = grown;
        }
        if (this.seen[id] === stamp) continue;
        this.seen[id] = stamp;
        const at = id * 4;
        if (rect[0] < flatRects[at + 2] && rect[2] > flatRects[at] &&
            rect[1] < flatRects[at + 3] && rect[3] > flatRects[at + 1]) return true;
      }
    }
    return false;
  }
}
