import * as THREE from "three";

/**
 * Procedural canvas textures for the hero fragments.
 *
 * Generated rather than loaded: the hero must not ship image payloads, and
 * these need to read as *categories* of evidence (a frame, a page, a region)
 * rather than as any particular file. Everything is drawn in the palette
 * tokens so the scene cannot drift from the rest of the site.
 */

const INK = "#0B0E13";
const INK_LINE = "#1E242F";

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** A video frame: letterboxed, with a soft subject mass and a tracked region
 *  box. Abstract enough that it is clearly "a frame", not a stock photo. */
export function videoFrameTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 288);

  const bg = ctx.createLinearGradient(0, 0, 512, 288);
  bg.addColorStop(0, "#101822");
  bg.addColorStop(0.55, "#0D131B");
  bg.addColorStop(1, "#0A0E14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 288);

  // Diffuse subject mass, lit from upper left.
  const subject = ctx.createRadialGradient(200, 150, 10, 200, 150, 170);
  subject.addColorStop(0, "rgba(76,155,232,0.20)");
  subject.addColorStop(0.5, "rgba(76,155,232,0.07)");
  subject.addColorStop(1, "rgba(76,155,232,0)");
  ctx.fillStyle = subject;
  ctx.fillRect(0, 0, 512, 288);

  // A schematic on screen — three boxes and connecting arrows, echoing the
  // architecture-diagram idea the product is built around.
  ctx.strokeStyle = "rgba(194,202,214,0.30)";
  ctx.lineWidth = 1.5;
  const boxes = [
    [70, 118, 78, 46],
    [216, 118, 78, 46],
    [362, 118, 78, 46],
  ];
  boxes.forEach(([x, y, w, h]) => ctx.strokeRect(x, y, w, h));
  ctx.beginPath();
  ctx.moveTo(148, 141);
  ctx.lineTo(216, 141);
  ctx.moveTo(294, 141);
  ctx.lineTo(362, 141);
  ctx.stroke();

  // The tracked OCR region — the only saturated element.
  ctx.strokeStyle = "rgba(25,214,196,0.85)";
  ctx.lineWidth = 2;
  ctx.strokeRect(212, 112, 86, 58);
  ctx.fillStyle = "rgba(25,214,196,0.09)";
  ctx.fillRect(212, 112, 86, 58);

  // Corner ticks on the region box.
  ctx.strokeStyle = "rgba(25,214,196,1)";
  ctx.lineWidth = 2.5;
  const corners: [number, number, number, number][] = [
    [212, 112, 12, 0], [212, 112, 0, 12],
    [298, 112, -12, 0], [298, 112, 0, 12],
    [212, 170, 12, 0], [212, 170, 0, -12],
    [298, 170, -12, 0], [298, 170, 0, -12],
  ];
  ctx.beginPath();
  corners.forEach(([x, y, dx, dy]) => {
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
  });
  ctx.stroke();

  // Letterbox bars.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, 512, 16);
  ctx.fillRect(0, 272, 512, 16);

  return finish(canvas);
}

/** A document page: a title block, body lines with realistic rag, a table,
 *  and one highlighted block standing for the cited region. */
export function documentTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(384, 512);

  ctx.fillStyle = "#0F131A";
  ctx.fillRect(0, 0, 384, 512);
  ctx.strokeStyle = INK_LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 382, 510);

  const left = 44;
  const width = 296;

  // Heading rules.
  ctx.fillStyle = "rgba(232,236,242,0.55)";
  ctx.fillRect(left, 56, 160, 9);
  ctx.fillStyle = "rgba(232,236,242,0.22)";
  ctx.fillRect(left, 76, 104, 5);

  // Body — deterministic line widths so the page looks typeset, not random.
  const widths = [1, 0.96, 0.99, 0.87, 1, 0.93, 0.62];
  let y = 108;
  const paragraph = (rows: number, offset: number) => {
    for (let i = 0; i < rows; i += 1) {
      ctx.fillStyle = "rgba(194,202,214,0.20)";
      ctx.fillRect(left, y, width * widths[(i + offset) % widths.length], 4);
      y += 12;
    }
    y += 12;
  };
  paragraph(6, 0);

  // The cited block — clay, matching the document modality colour.
  const blockY = y;
  ctx.fillStyle = "rgba(217,142,106,0.10)";
  ctx.fillRect(left - 10, blockY - 8, width + 20, 74);
  ctx.fillStyle = "rgba(217,142,106,0.85)";
  ctx.fillRect(left - 10, blockY - 8, 2.5, 74);
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = "rgba(217,142,106,0.45)";
    ctx.fillRect(left, y, width * widths[i % widths.length], 4);
    y += 12;
  }
  y += 20;

  paragraph(4, 3);

  // A table — header rule, three rows, right-aligned numeric column.
  const tableY = y;
  ctx.strokeStyle = "rgba(194,202,214,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, tableY);
  ctx.lineTo(left + width, tableY);
  ctx.stroke();
  for (let r = 0; r < 3; r += 1) {
    const ry = tableY + 16 + r * 20;
    ctx.fillStyle = "rgba(194,202,214,0.22)";
    ctx.fillRect(left, ry, 118, 4);
    ctx.fillRect(left + width - 56, ry, 56, 4);
    ctx.beginPath();
    ctx.moveTo(left, ry + 12);
    ctx.lineTo(left + width, ry + 12);
    ctx.stroke();
  }

  // Folio.
  ctx.fillStyle = "rgba(194,202,214,0.30)";
  ctx.fillRect(left + width - 22, 478, 22, 4);

  return finish(canvas);
}

/** A whiteboard/image region: a photographed surface with a marked crop. */
export function imageRegionTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(400, 300);

  const bg = ctx.createLinearGradient(0, 0, 400, 300);
  bg.addColorStop(0, "#141A24");
  bg.addColorStop(1, "#0C1016");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 400, 300);

  // Hand-drawn boxes, deliberately imperfect.
  ctx.strokeStyle = "rgba(148,136,221,0.55)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  const sketch = (x: number, y: number, w: number, h: number, wobble: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y + wobble);
    ctx.lineTo(x + w, y - wobble * 0.6);
    ctx.lineTo(x + w - wobble * 0.4, y + h);
    ctx.lineTo(x - wobble * 0.3, y + h - wobble * 0.5);
    ctx.closePath();
    ctx.stroke();
  };
  sketch(58, 74, 82, 50, 2.4);
  sketch(168, 128, 82, 50, -1.8);
  sketch(278, 74, 76, 50, 2.0);

  ctx.beginPath();
  ctx.moveTo(140, 100);
  ctx.lineTo(168, 148);
  ctx.moveTo(250, 148);
  ctx.lineTo(278, 102);
  ctx.stroke();

  // Circled annotation.
  ctx.strokeStyle = "rgba(148,136,221,0.9)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(209, 213, 62, 24, -0.05, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(148,136,221,0.32)";
  ctx.fillRect(166, 208, 86, 4);
  ctx.fillRect(180, 218, 58, 4);

  return finish(canvas);
}

/** Radial falloff used as an additive sprite — this is the scene's entire
 *  "bloom" budget, applied only to the event core and selected nodes. */
export function glowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.42)");
  g.addColorStop(0.55, "rgba(255,255,255,0.09)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(canvas);
}
