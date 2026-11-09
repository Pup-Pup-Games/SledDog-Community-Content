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
export const PNG_ALLOWED_CHUNKS = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD",
  "acTL", "fcTL", "fdAT", // APNG animation frames
]);

/** Largest legitimate body for each fixed-format display chunk. */
const PNG_CHUNK_MAX = { IHDR: 13, PLTE: 768, tRNS: 256, gAMA: 4, cHRM: 32, sRGB: 1, sBIT: 4, pHYs: 9, bKGD: 6, acTL: 8, fcTL: 26 };

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

/** The IPTC Digital Source Type vocabulary (cv.iptc.org/newscodes/digitalsourcetype).
 *  A closed list, so the label cannot carry arbitrary text. */
export const SOURCE_TYPE_TERMS = new Set([
  "digitalCapture", "computationalCapture", "negativeFilm", "positiveFilm", "print",
  "humanEdits", "minorHumanEdits", "compositeCapture", "algorithmicallyEnhanced",
  "digitalCreation", "dataDrivenMedia", "digitalArt", "virtualRecording", "compositeSynthetic",
  "trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia", "algorithmicMedia",
  "screenCapture", "softwareImage",
]);
const SOURCE_TYPE_PREFIX = "http://cv.iptc.org/newscodes/digitalsourcetype/";
const isSourceType = (v) => v.startsWith(SOURCE_TYPE_PREFIX) && SOURCE_TYPE_TERMS.has(v.slice(SOURCE_TYPE_PREFIX.length));

/** The DigitalSourceType value in an XMP packet, or null. Any namespace prefix
 *  bound to the IPTC extension namespace counts (Midjourney uses `iptcExt:`).
 *  Only a value from the IPTC vocabulary is returned — this is what the optimizer
 *  carries forward, so free text cannot ride along in it. */
export function digitalSourceType(xml) {
  const prefixes = [...xml.matchAll(/xmlns:([\w.-]+)\s*=\s*"([^"]*)"/g)]
    .filter((m) => m[2] === IPTC_EXT_NS)
    .map((m) => m[1]);
  for (const p of prefixes) {
    const esc = p.replace(/[.-]/g, "\\$&");
    const m =
      xml.match(new RegExp(`${esc}:DigitalSourceType\\s*=\\s*"([^"]*)"`)) ??
      xml.match(new RegExp(`<${esc}:DigitalSourceType>([^<]*)</${esc}:DigitalSourceType>`));
    if (m && isSourceType(m[1].trim())) return m[1].trim();
  }
  return null;
}

/**
 * True when an XMP packet is exactly the provenance packet the tools write
 * (`provenanceXmp`, here and in Content-Forge's art_clean.py). Matching the
 * whole packet, rather than allow-listing names inside it, leaves no corner —
 * comments, CDATA, unprefixed attributes, rdf:about values — for text to hide in.
 * Anything else is refused, and `npm run art:optimize` rewrites it.
 */
export function isProvenanceOnlyXmp(xml) {
  const type = digitalSourceType(xml);
  return type !== null && xml === provenanceXmp(type);
}

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

/** Serialize one PNG chunk. */
export function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Rebuild a PNG keeping only pixel and display chunks, plus a provenance XMP
 * when `sourceType` is given. Works on whole chunks — IDAT is copied byte for
 * byte — so it is lossless for every PNG: 16-bit, palette, wide-gamut, animated.
 * This mirrors `strip_png` in Content-Forge's art_clean.py.
 */
export function stripPng(buf, sourceType) {
  const out = [buf.subarray(0, 8)];
  for (const { type, data } of pngChunks(buf)) {
    if (!PNG_ALLOWED_CHUNKS.has(type)) continue;
    out.push(pngChunk(type, data));
    if (type === "IHDR" && sourceType) {
      const itxt = Buffer.concat([Buffer.from(`${XMP_KEYWORD}\0\0\0\0\0`, "latin1"), Buffer.from(provenanceXmp(sourceType), "utf8")]);
      out.push(pngChunk("iTXt", itxt));
    }
  }
  return Buffer.concat(out);
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

/** Inflate, refusing anything after the end of the zlib stream. */
function inflateExact(buf) {
  const { buffer, engine } = inflateSync(buf, { info: true });
  if (engine.bytesWritten !== buf.length) throw new Error("data after the compressed stream");
  return buffer;
}

/** Decode a PNG text chunk into { keyword, text }. An iTXt XMP chunk must leave
 *  its language tag and translated keyword empty — they are free text too. */
function pngText(type, data) {
  const nul = data.indexOf(0);
  const keyword = data.toString("latin1", 0, nul);
  // XMP is UTF-8 by spec, whichever chunk type carries it; other text is Latin-1.
  const enc = keyword === XMP_KEYWORD ? "utf8" : "latin1";
  if (type === "tEXt") return { keyword, text: data.toString(enc, nul + 1) };
  if (type === "zTXt") return { keyword, text: inflateExact(data.subarray(nul + 2)).toString(enc) };
  // iTXt: keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
  const compressed = data[nul + 1] === 1;
  const langEnd = data.indexOf(0, nul + 3);
  const tkeyEnd = data.indexOf(0, langEnd + 1);
  if (langEnd < 0 || tkeyEnd < 0) throw new Error("malformed iTXt");
  if (keyword === XMP_KEYWORD && (langEnd !== nul + 3 || tkeyEnd !== langEnd + 1)) {
    throw new Error("XMP iTXt carries a language tag or translated keyword");
  }
  const raw = data.subarray(tkeyEnd + 1);
  return { keyword, text: (compressed ? inflateExact(raw) : raw).toString("utf8") };
}

/** The AI-provenance label in a PNG's XMP, whatever tool wrote the packet —
 *  Midjourney's carries a job id beside it. Only a vocabulary value is returned,
 *  so this is what the optimizer can safely carry into a clean packet. */
export function pngSourceType(buf) {
  for (const { type, data } of pngChunks(buf)) {
    if (type !== "tEXt" && type !== "zTXt" && type !== "iTXt") continue;
    if (data.toString("latin1", 0, data.indexOf(0)) !== XMP_KEYWORD) continue;
    try {
      const type_ = digitalSourceType(pngTextLenient(type, data));
      if (type_) return type_;
    } catch {
      // unreadable XMP carries no label we can trust
    }
  }
  return null;
}

/** pngText without the strictness checks — for reading a label, never for passing a file. */
function pngTextLenient(type, data) {
  const nul = data.indexOf(0);
  if (type === "tEXt") return data.toString("utf8", nul + 1);
  if (type === "zTXt") return inflateSync(data.subarray(nul + 2)).toString("utf8");
  const compressed = data[nul + 1] === 1;
  const tkeyEnd = data.indexOf(0, data.indexOf(0, nul + 3) + 1);
  const raw = data.subarray(tkeyEnd + 1);
  return (compressed ? inflateSync(raw) : raw).toString("utf8");
}

/**
 * Inspect an image's metadata. Returns { problems: string[], sourceType } where
 * `problems` lists each identifying field found (empty means clean) and
 * `sourceType` is the provenance label the file carries, if any.
 */
export function inspectImage(buf, ext) {
  ext = ext.toLowerCase();
  const inspect = { ".png": inspectPng, ".jpg": inspectJpeg, ".jpeg": inspectJpeg, ".webp": inspectWebp }[ext];
  if (inspect) {
    try {
      return inspect(buf);
    } catch (e) {
      return { problems: [`not a valid ${ext.slice(1).toUpperCase()}: ${e.message}`], sourceType: null };
    }
  }
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
    if (PNG_ALLOWED_CHUNKS.has(type)) {
      // Display chunks have small, fixed sizes; an oversized one is a hiding place.
      const max = PNG_CHUNK_MAX[type];
      if (max !== undefined && data.length > max) problems.push(`oversized \`${type}\` chunk`);
      continue;
    }
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

/**
 * JPEG: walk every marker segment, through each scan, to the first EOI. Allowed:
 * APP0 (JFIF), APP2 ICC_PROFILE, and a provenance-only APP1 XMP. Refused: EXIF,
 * every other APPn (C2PA in APP11, MPF in APP2, vendor blocks), comments, and any
 * bytes after EOI — where phones append a second image with its own EXIF and GPS.
 */
function inspectJpeg(buf) {
  const problems = [];
  let sourceType = null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return { problems: ["not a valid JPEG"], sourceType };
  const xmpHeader = "http://ns.adobe.com/xap/1.0/\0";
  let i = 2;
  for (;;) {
    if (i + 2 > buf.length || buf[i] !== 0xff) return { problems: [...problems, "not a valid JPEG: truncated"], sourceType };
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9) { i += 2; break; } // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
    if (i + 4 > buf.length) throw new Error("truncated segment");
    const len = buf.readUInt16BE(i + 2);
    if (2 + len > buf.length - i) throw new Error("truncated segment");
    const seg = buf.subarray(i + 4, i + 2 + len);
    if (marker === 0xe0) {
      // JFIF: identifier, version, density, then a thumbnail of exactly
      // Xthumb × Ythumb RGB pixels — any other length is extra payload. JFXX
      // extension thumbnails are refused outright.
      const jfif = seg.toString("latin1", 0, 5) === "JFIF\0" && seg.length >= 14 && seg.length === 14 + 3 * seg[12] * seg[13];
      if (!jfif) problems.push("APP0 metadata");
    } else if ((marker === 0xdd || marker === 0xdc) && seg.length !== 2) {
      problems.push(`malformed JPEG marker 0x${marker.toString(16)}`); // DRI / DNL bodies are 2 bytes
    } else if (marker === 0xe1) {
      if (seg.toString("latin1", 0, xmpHeader.length) === xmpHeader) {
        const xml = seg.subarray(xmpHeader.length).toString("utf8");
        if (isProvenanceOnlyXmp(xml)) sourceType = digitalSourceType(xml);
        else problems.push("XMP carries more than an AI-provenance label");
      } else problems.push(seg.toString("latin1", 0, 4) === "Exif" ? "EXIF metadata" : "APP1 metadata");
    } else if (marker === 0xe2 && seg.toString("latin1", 0, 12) === "ICC_PROFILE\0") {
      // colour profile
    } else if (marker === 0xee && seg.length === 12 && seg.toString("latin1", 0, 5) === "Adobe") {
      // Adobe colour-transform flags (every CMYK JPEG) — no free text.
    } else if (marker >= 0xe0 && marker <= 0xef) {
      problems.push(`APP${marker - 0xe0} metadata`);
    } else if (marker === 0xfe) {
      problems.push("JPEG comment");
    } else if (!JPEG_IMAGE_MARKERS.has(marker)) {
      problems.push(`unexpected JPEG marker 0x${marker.toString(16)}`);
    }
    i += 2 + len;
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not stuffing (FF00) or a restart.
      while (i + 1 < buf.length && !(buf[i] === 0xff && buf[i + 1] !== 0x00 && !(buf[i + 1] >= 0xd0 && buf[i + 1] <= 0xd7))) i++;
    }
  }
  if (buf.subarray(i).some((b) => b !== 0)) problems.push("data after the end of the image");
  return { problems, sourceType };
}

/** JPEG segments that are image data: SOFn, DHT, DAC, SOS, DQT, DNL, DRI, DHP, EXP. */
const JPEG_IMAGE_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf,
  0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
]);

/** WebP chunks that are image data, never people. */
const WEBP_ALLOWED_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);

function inspectWebp(buf) {
  const problems = [];
  let sourceType = null;
  if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") {
    return { problems: ["not a valid WebP"], sourceType };
  }
  const end = 8 + buf.readUInt32LE(4);
  if (end !== buf.length) problems.push("data after the end of the image");
  let i = 12;
  while (i + 8 <= Math.min(end, buf.length)) {
    const type = buf.toString("latin1", i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "XMP ") {
      const xml = data.toString("utf8");
      if (isProvenanceOnlyXmp(xml)) sourceType = digitalSourceType(xml);
      else problems.push("XMP carries more than an AI-provenance label");
    } else if (type === "EXIF") problems.push("EXIF metadata");
    else if (!WEBP_ALLOWED_CHUNKS.has(type)) problems.push(`\`${type.trim()}\` chunk`);
    i += 8 + len + (len % 2);
  }
  return { problems, sourceType };
}
