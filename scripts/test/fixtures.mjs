/** Build tiny, valid image files in memory so the tests own every byte. */
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export const tEXt = (keyword, text) => chunk("tEXt", Buffer.from(`${keyword}\0${text}`, "latin1"));
export const iTXt = (keyword, text) =>
  chunk("iTXt", Buffer.concat([Buffer.from(`${keyword}\0\0\0\0\0`, "latin1"), Buffer.from(text, "utf8")]));

/** A 2×2 RGBA PNG. `alpha` sets every pixel's alpha; `extra` chunks go before IDAT. */
export function png({ extra = [], alpha = 255 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = (r, g) => [0, r, g, 40, alpha, g, r, 80, alpha];
  const raw = Buffer.from([...row(200, 10), ...row(30, 220)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Midjourney's actual XMP shape: provenance plus the job id as DigImageGUID. */
export const MIDJOURNEY_XMP =
  `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
  `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 4.4.0-Exiv2">\n` +
  ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
  `  <rdf:Description rdf:about=""\n` +
  `    xmlns:iptcExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"\n` +
  `   iptcExt:DigImageGUID="aadc9b89-9175-440d-954f-3f9992c7c434"\n` +
  `   iptcExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>\n` +
  ` </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;

/** The tEXt chunks Midjourney writes alongside its XMP. */
export function midjourneyChunks() {
  return [
    tEXt("Creation Time", "Fri, 24 Jul 2026 02:41:12 GMT"),
    tEXt("Author", "someone"),
    tEXt("Description", "https://s.mj.run/abc a portrait --sref https://s.mj.run/xyz --profile abc123 Job ID: 1234"),
    tEXt("XML:com.adobe.xmp", MIDJOURNEY_XMP),
  ];
}
