/**
 * Image-file inspection shared by the validator and the art optimizer.
 *
 * Gallery art is served publicly from GitHub raw, pinned to a commit, so
 * whatever metadata a file carries is published permanently. Generators embed
 * a lot: Midjourney writes the author handle, the full prompt (style-reference
 * link and profile code included), the job id and a creation time. None of that
 * belongs in a public file.
 *
 * One piece of metadata is kept on purpose: the IPTC `DigitalSourceType` that
 * marks an image as AI-generated. That label is disclosure, not identification,
 * so an XMP packet carrying ONLY that property is allowed and everything else is
 * refused.
 */
import { inflateSync } from "node:zlib";

/** Largest gallery image accepted, in bytes. Every card is fetched from GitHub
 *  raw by Sled Dog's image optimizer, and GMs open the gallery on phones. */
export const MAX_ART_BYTES = 2 * 1024 * 1024;

export const XMP_KEYWORD = "XML:com.adobe.xmp";
export const IPTC_EXT_NS = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/";
export const AI_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG chunks that describe pixels or display, never people. Anything else —
 *  tEXt, zTXt, iTXt (other than a provenance-only XMP), eXIf, tIME, private
 *  chunks — is refused. */
const PNG_ALLOWED_CHUNKS = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD",
]);

/** The XMP packet the optimizer writes: provenance and nothing else. */
export function provenanceXmp(sourceType = AI_SOURCE_TYPE) {
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="${IPTC_EXT_NS}" Iptc4xmpExt:DigitalSourceType="${sourceType}"/>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end="r"?>`
  );
}

/** The DigitalSourceType value in an XMP packet, or null. Any namespace prefix
 *  bound to the IPTC extension namespace counts (Midjourney uses `iptcExt:`). */
export function digitalSourceType(xml) {
  const prefixes = [...xml.matchAll(/xmlns:([\w.-]+)\s*=\s*"([^"]*)"/g)]
    .filter((m) => m[2] === IPTC_EXT_NS)
    .map((m) => m[1]);
  for (const p of prefixes) {
    const esc = p.replace(/[.-]/g, "\\$&");
    const attr = xml.match(new RegExp(`${esc}:DigitalSourceType\\s*=\\s*"([^"]*)"`));
    if (attr) return attr[1];
    const el = xml.match(new RegExp(`<${esc}:DigitalSourceType>([^<]*)</${esc}:DigitalSourceType>`));
    if (el) return el[1].trim();
  }
  return null;
}

/**
 * True when an XMP packet carries nothing but a DigitalSourceType. Checked by
 * allow-list: every qualified element and attribute name must be structural
 * XMP/RDF, a namespace declaration, or the provenance property itself.
 */
export function isProvenanceOnlyXmp(xml) {
  const iptcPrefixes = new Set(
    [...xml.matchAll(/xmlns:([\w.-]+)\s*=\s*"([^"]*)"/g)].filter((m) => m[2] === IPTC_EXT_NS).map((m) => m[1]),
  );
  // Text content between tags is a value — only the provenance element may have one.
  const body = xml.replace(/<\?xpacket[^>]*\?>/g, "");
  for (const m of body.matchAll(/>([^<]*)</g)) {
    if (m[1].trim() && digitalSourceType(xml) !== m[1].trim()) return false;
  }
  for (const m of body.matchAll(/<\/?([\w.-]+:[\w.-]+)|\s([\w.-]+:[\w.-]+)\s*=/g)) {
    const name = m[1] ?? m[2];
    const [prefix, local] = name.split(":");
    if (prefix === "xmlns") continue;
    if (name === "x:xmpmeta" || name === "x:xmptk") continue;
    if (name === "rdf:RDF" || name === "rdf:Description" || name === "rdf:about") continue;
    if (iptcPrefixes.has(prefix) && local === "DigitalSourceType") continue;
    return false;
  }
  return digitalSourceType(xml) !== null;
}

/** Parse a PNG into its chunks: [{ type, data }]. Throws on a malformed file. */
export function pngChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG file");
  const chunks = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    if (i + 12 + len > buf.length) throw new Error(`truncated ${type} chunk`);
    chunks.push({ type, data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === "IEND") break;
  }
  if (chunks.at(-1)?.type !== "IEND") throw new Error("missing IEND chunk");
  if (i !== buf.length) throw new Error("data after IEND");
  return chunks;
}

/** Decode a PNG text chunk into { keyword, text }. */
function pngText(type, data) {
  const nul = data.indexOf(0);
  const keyword = data.toString("latin1", 0, nul);
  if (type === "tEXt") return { keyword, text: data.toString("latin1", nul + 1) };
  if (type === "zTXt") return { keyword, text: inflateSync(data.subarray(nul + 2)).toString("latin1") };
  // iTXt: keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
  const compressed = data[nul + 1] === 1;
  let j = data.indexOf(0, nul + 3);
  j = data.indexOf(0, j + 1);
  const raw = data.subarray(j + 1);
  return { keyword, text: (compressed ? inflateSync(raw) : raw).toString("utf8") };
}

/**
 * Inspect an image's metadata. Returns { problems: string[], sourceType } where
 * `problems` lists each identifying field found (empty means clean) and
 * `sourceType` is the provenance label the file carries, if any.
 */
export function inspectImage(buf, ext) {
  ext = ext.toLowerCase();
  if (ext === ".png") return inspectPng(buf);
  if (ext === ".jpg" || ext === ".jpeg") return inspectJpeg(buf);
  if (ext === ".webp") return inspectWebp(buf);
  return { problems: [`unsupported image type \`${ext}\` (use .png, .jpg or .webp)`], sourceType: null };
}

function inspectPng(buf) {
  const problems = [];
  let sourceType = null;
  let chunks;
  try {
    chunks = pngChunks(buf);
  } catch (e) {
    return { problems: [`not a valid PNG: ${e.message}`], sourceType };
  }
  for (const { type, data } of chunks) {
    if (PNG_ALLOWED_CHUNKS.has(type)) continue;
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      let t;
      try {
        t = pngText(type, data);
      } catch {
        problems.push(`unreadable ${type} chunk`);
        continue;
      }
      if (t.keyword === XMP_KEYWORD && isProvenanceOnlyXmp(t.text)) {
        sourceType = digitalSourceType(t.text);
        continue;
      }
      problems.push(t.keyword === XMP_KEYWORD ? "XMP carries more than an AI-provenance label" : `text metadata \`${t.keyword}\``);
      continue;
    }
    problems.push(`\`${type}\` chunk`);
  }
  return { problems, sourceType };
}

function inspectJpeg(buf) {
  const problems = [];
  let sourceType = null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return { problems: ["not a valid JPEG"], sourceType };
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i + 4, i + 2 + len);
    if (marker === 0xe1) {
      const xmpHeader = "http://ns.adobe.com/xap/1.0/\0";
      if (seg.toString("latin1", 0, xmpHeader.length) === xmpHeader) {
        const xml = seg.subarray(xmpHeader.length).toString("utf8");
        if (isProvenanceOnlyXmp(xml)) sourceType = digitalSourceType(xml);
        else problems.push("XMP carries more than an AI-provenance label");
      } else problems.push("EXIF metadata");
    } else if (marker === 0xed) problems.push("IPTC/Photoshop metadata");
    else if (marker === 0xfe) problems.push("JPEG comment");
    i += 2 + len;
  }
  return { problems, sourceType };
}

function inspectWebp(buf) {
  const problems = [];
  let sourceType = null;
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") {
    return { problems: ["not a valid WebP"], sourceType };
  }
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString("latin1", i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "EXIF") problems.push("EXIF metadata");
    else if (type === "XMP ") {
      const xml = data.toString("utf8");
      if (isProvenanceOnlyXmp(xml)) sourceType = digitalSourceType(xml);
      else problems.push("XMP carries more than an AI-provenance label");
    }
    i += 8 + len + (len % 2);
  }
  return { problems, sourceType };
}
