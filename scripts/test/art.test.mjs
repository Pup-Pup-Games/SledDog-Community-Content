import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  AI_SOURCE_TYPE,
  inspectImage,
  isProvenanceOnlyXmp,
  provenanceXmp,
  pngChunks,
  stripPng,
} from "../lib/art.mjs";
import { optimizePng } from "../optimize-art.mjs";
import { MIDJOURNEY_XMP, chunk, iTXt, midjourneyChunks, png, tEXt } from "./fixtures.mjs";

test("a PNG with no metadata is clean", () => {
  assert.deepEqual(inspectImage(png(), ".png"), { problems: [], sourceType: null });
});

test("Midjourney's text chunks and XMP are all refused", () => {
  const { problems } = inspectImage(png({ extra: midjourneyChunks() }), ".png");
  assert.equal(problems.length, 4);
  assert.match(problems.join(" "), /Author/);
  assert.match(problems.join(" "), /Description/);
  assert.match(problems.join(" "), /Creation Time/);
  assert.match(problems.join(" "), /XMP carries more than an AI-provenance label/);
});

test("eXIf, tIME and private chunks are refused", () => {
  const { problems } = inspectImage(
    png({ extra: [chunk("eXIf", Buffer.from("MM\0*")), chunk("tIME", Buffer.alloc(7)), chunk("prVt", Buffer.from("x"))] }),
    ".png",
  );
  assert.deepEqual(problems, ["`eXIf` chunk", "`tIME` chunk", "`prVt` chunk"]);
});

test("display chunks such as pHYs and sRGB are allowed", () => {
  const phys = Buffer.alloc(9);
  assert.deepEqual(inspectImage(png({ extra: [chunk("pHYs", phys), chunk("sRGB", Buffer.from([0]))] }), ".png").problems, []);
});

test("a provenance-only XMP is allowed and reported, in tEXt or iTXt", () => {
  for (const c of [tEXt("XML:com.adobe.xmp", provenanceXmp()), iTXt("XML:com.adobe.xmp", provenanceXmp())]) {
    assert.deepEqual(inspectImage(png({ extra: [c] }), ".png"), { problems: [], sourceType: AI_SOURCE_TYPE });
  }
});

test("XMP is allowed only when DigitalSourceType is its sole property", () => {
  assert.equal(isProvenanceOnlyXmp(provenanceXmp()), true);
  assert.equal(isProvenanceOnlyXmp(MIDJOURNEY_XMP), false, "DigImageGUID is the job id");
  assert.equal(
    isProvenanceOnlyXmp(MIDJOURNEY_XMP.replace(/\s*iptcExt:DigImageGUID="[^"]*"/, "")),
    false,
    "only the exact packet the tools write passes; anything else is rewritten by art:optimize",
  );
  const withCreator = provenanceXmp().replace("<rdf:Description", '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="someone"');
  assert.equal(isProvenanceOnlyXmp(withCreator), false);
  const asElement = provenanceXmp().replace("/></rdf:RDF>", "><dc:title>Secret</dc:title></rdf:Description></rdf:RDF>");
  assert.equal(isProvenanceOnlyXmp(asElement), false);
  assert.equal(isProvenanceOnlyXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'), false, "an empty packet is not provenance");
});

test("XMP smuggling shapes are refused", () => {
  const base = provenanceXmp();
  for (const smuggled of [
    base.replace("<rdf:Description", '<rdf:Description Author="someone"'),
    base.replace('rdf:about=""', 'rdf:about="someone"'),
    base.replace("</rdf:RDF>", "<!-- someone --></rdf:RDF>"),
    base.replace("</rdf:RDF>", "<![CDATA[someone]]></rdf:RDF>"),
    base + "someone",
    provenanceXmp("http://cv.iptc.org/newscodes/digitalsourcetype/someone prompt text"),
  ]) {
    assert.equal(isProvenanceOnlyXmp(smuggled), false, smuggled);
  }
});

test("XMP side channels are refused: iTXt language tag, data after the zlib stream, non-vocabulary labels", async () => {
  const { deflateSync } = await import("node:zlib");
  const packet = Buffer.from(provenanceXmp(), "utf8");
  const lang = chunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0someone\0\0"), packet]));
  assert.notDeepEqual(inspectImage(png({ extra: [lang] }), ".png").problems, []);
  const trailing = chunk("zTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0"), deflateSync(packet), Buffer.from("someone")]));
  assert.notDeepEqual(inspectImage(png({ extra: [trailing] }), ".png").problems, []);
  const clean = chunk("zTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0"), deflateSync(packet)]));
  assert.deepEqual(inspectImage(png({ extra: [clean] }), ".png").problems, []);
  const fake = provenanceXmp("http://cv.iptc.org/newscodes/digitalsourcetype/someoneJobIdDeadbeef");
  assert.equal(isProvenanceOnlyXmp(fake), false);
});

test("JPEG: APP0 must be JFIF, unknown markers and truncation are problems", () => {
  const seg = (marker, body) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
  };
  const jpeg = (...segs) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segs, Buffer.from([0xff, 0xd9])]);
  assert.deepEqual(inspectImage(jpeg(seg(0xe0, Buffer.from("Job ID: someone"))), ".jpg").problems, ["APP0 metadata"]);
  assert.deepEqual(inspectImage(jpeg(seg(0xf5, Buffer.from("someone"))), ".jpg").problems, ["unexpected JPEG marker 0xf5"]);
  assert.match(inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), ".jpg").problems[0], /not a valid JPG/);
  const adobe = seg(0xee, Buffer.from("Adobe\0\x64\0\0\0\0\x02", "latin1"));
  assert.deepEqual(inspectImage(jpeg(adobe), ".jpg").problems, [], "CMYK Adobe APP14");
  assert.deepEqual(inspectImage(Buffer.concat([jpeg(), Buffer.alloc(4)]), ".jpg").problems, [], "zero padding after EOI");
});

test("oversized display chunks are refused", () => {
  assert.deepEqual(inspectImage(png({ extra: [chunk("pHYs", Buffer.alloc(9 + 100))] }), ".png").problems, ["oversized `pHYs` chunk"]);
});

test("a malformed PNG is a problem, not a crash", () => {
  assert.match(inspectImage(Buffer.from("not a png"), ".png").problems[0], /not a valid PNG/);
  const truncated = png().subarray(0, 40);
  assert.match(inspectImage(truncated, ".png").problems[0], /not a valid PNG/);
  const trailing = Buffer.concat([png(), Buffer.from("smuggled")]);
  assert.match(inspectImage(trailing, ".png").problems[0], /data after IEND/);
});

test("JPEG EXIF and comments are refused; provenance XMP is allowed", () => {
  const seg = (marker, body) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
  };
  const jpeg = (...segs) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segs, Buffer.from([0xff, 0xd9])]);
  assert.deepEqual(inspectImage(jpeg(seg(0xe1, Buffer.from("Exif\0\0MM"))), ".jpg").problems, ["EXIF metadata"]);
  assert.deepEqual(inspectImage(jpeg(seg(0xfe, Buffer.from("hi"))), ".jpeg").problems, ["JPEG comment"]);
  assert.deepEqual(inspectImage(jpeg(seg(0xeb, Buffer.from("JPc2pa"))), ".jpg").problems, ["APP11 metadata"], "C2PA");
  assert.deepEqual(inspectImage(jpeg(seg(0xe2, Buffer.from("MPF\0"))), ".jpg").problems, ["APP2 metadata"], "MPF");
  assert.deepEqual(inspectImage(jpeg(seg(0xe0, Buffer.from("JFIF\0")), seg(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01"))), ".jpg").problems, []);
  const scan = Buffer.concat([seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56])]);
  assert.deepEqual(inspectImage(jpeg(scan), ".jpg").problems, [], "entropy data with stuffing and restarts");
  const trailer = Buffer.concat([jpeg(scan), Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from("Exif GPS")]);
  assert.deepEqual(inspectImage(trailer, ".jpg").problems, ["data after the end of the image"], "a second image after EOI");
  const xmp = seg(0xe1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0"), Buffer.from(provenanceXmp())]));
  assert.deepEqual(inspectImage(jpeg(xmp), ".jpg"), { problems: [], sourceType: AI_SOURCE_TYPE });
});

test("WebP EXIF is refused", () => {
  const exif = Buffer.concat([Buffer.from("EXIF"), Buffer.from([4, 0, 0, 0]), Buffer.from("MM\0*")]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + exif.length);
  const webp = Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), exif]);
  assert.deepEqual(inspectImage(webp, ".webp").problems, ["EXIF metadata"]);
  const c2pa = Buffer.concat([Buffer.from("C2PA"), Buffer.from([2, 0, 0, 0]), Buffer.from("hi")]);
  size.writeUInt32LE(4 + c2pa.length);
  assert.deepEqual(inspectImage(Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), c2pa]), ".webp").problems, ["`C2PA` chunk"]);
  assert.deepEqual(
    inspectImage(Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), c2pa, Buffer.from("trailer")]), ".webp").problems,
    ["data after the end of the image", "`C2PA` chunk"],
  );
});

test("unsupported image types are refused", () => {
  assert.match(inspectImage(Buffer.from("GIF89a"), ".gif").problems[0], /unsupported image type/);
});

test("optimizePng strips identifying metadata, keeps the AI label, and keeps every pixel", async () => {
  const src = png({ extra: midjourneyChunks() });
  const out = await optimizePng(src, AI_SOURCE_TYPE);
  assert.deepEqual(inspectImage(out, ".png"), { problems: [], sourceType: AI_SOURCE_TYPE });
  assert.ok(!out.includes("s.mj.run") && !out.includes("someone"), "no prompt or author bytes survive");
  const [a, b] = await Promise.all([sharp(src).ensureAlpha().raw().toBuffer(), sharp(out).ensureAlpha().raw().toBuffer()]);
  assert.ok(a.equals(b));
});

/** An uncompressed 64×64 RGBA gradient — big enough that recompression wins. */
async function gradient(alpha = 255) {
  const raw = Buffer.alloc(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) raw.set([i % 64 * 4, (i >> 6) * 4, 128, alpha], i * 4);
  return sharp(raw, { raw: { width: 64, height: 64, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
}

test("optimizePng drops an all-opaque alpha channel but keeps real transparency", async () => {
  const opaque = await sharp(await optimizePng(await gradient(), null)).metadata();
  assert.equal(opaque.channels, 3);
  const translucent = await sharp(await optimizePng(await gradient(128), null)).metadata();
  assert.equal(translucent.channels, 4);
});

test("optimizePng never makes a file bigger than stripping alone", async () => {
  for (const src of [png({ extra: midjourneyChunks() }), await gradient()]) {
    assert.ok((await optimizePng(src, null)).length <= stripPng(src, null).length);
  }
});

test("16-bit, palette, wide-gamut and animated PNGs are stripped without re-encoding", async () => {
  const idat = (buf) => Buffer.concat(pngChunks(buf).filter((c) => c.type === "IDAT").map((c) => c.data));
  const sixteen = await sharp(Buffer.alloc(8 * 8 * 6, 0x5a), { raw: { width: 8, height: 8, channels: 3 } })
    .toColourspace("rgb16").png().toBuffer();
  const palette = await sharp(await gradient()).png({ palette: true, colours: 16 }).toBuffer();
  const withIcc = png({ extra: [chunk("iCCP", Buffer.from("WideGamut\0\0junk")), ...midjourneyChunks()] });
  const animated = png({ extra: [chunk("acTL", Buffer.alloc(8)), chunk("fcTL", Buffer.alloc(26)), ...midjourneyChunks()] });
  for (const src of [sixteen, palette, withIcc, animated]) {
    const out = await optimizePng(src, AI_SOURCE_TYPE);
    assert.deepEqual(inspectImage(out, ".png").problems, []);
    assert.ok(idat(out).equals(idat(src)), "pixel data copied byte for byte");
  }
  const kept = (buf) => pngChunks(buf).map((c) => c.type);
  assert.ok(kept(await optimizePng(withIcc, null)).includes("iCCP"), "colour profile kept");
  assert.ok(kept(await optimizePng(animated, null)).includes("acTL"), "animation kept");
});

test("a generator's own AI label survives optimizing without --ai", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "art-label-"));
  try {
    const f = join(dir, "mj.png");
    writeFileSync(f, png({ extra: midjourneyChunks() }));
    execFileSync(process.execPath, [new URL("../optimize-art.mjs", import.meta.url).pathname, f], { stdio: "ignore" });
    assert.deepEqual(inspectImage(readFileSync(f), ".png"), { problems: [], sourceType: AI_SOURCE_TYPE });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gamma and colour chunks are never dropped by recompression", async () => {
  const src = await gradient();
  const withGama = stripPng(src, null);
  const gama = Buffer.concat([withGama.subarray(0, 33), chunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])), withGama.subarray(33)]);
  assert.ok(pngChunks(await optimizePng(gama, null)).some((c) => c.type === "gAMA"));
});

test("optimizePng without a label writes no metadata at all", async () => {
  const out = await optimizePng(png({ extra: midjourneyChunks() }), null);
  const types = pngChunks(out).map((c) => c.type).filter((t) => t !== "IDAT");
  assert.deepEqual(types.filter((t) => !["IHDR", "IEND", "pHYs"].includes(t)), []);
});

test("real encoder output parses clean, and real EXIF is caught", async () => {
  const base = sharp(png());
  for (const [ext, enc] of [[".jpg", (s) => s.jpeg()], [".jpg", (s) => s.jpeg({ progressive: true })], [".webp", (s) => s.webp()], [".webp", (s) => s.webp({ lossless: true })]]) {
    const clean = await enc(base.clone()).toBuffer();
    assert.deepEqual(inspectImage(clean, ext).problems, [], `clean ${ext}`);
    const tagged = await enc(base.clone().withExif({ IFD0: { Artist: "someone" } })).toBuffer();
    assert.ok(inspectImage(tagged, ext).problems.includes("EXIF metadata"), `EXIF ${ext}`);
  }
});
