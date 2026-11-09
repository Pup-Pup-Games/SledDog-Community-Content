import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  AI_SOURCE_TYPE,
  inspectImage,
  isProvenanceOnlyXmp,
  provenanceXmp,
  pngChunks,
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
  assert.equal(isProvenanceOnlyXmp(MIDJOURNEY_XMP.replace(/\s*iptcExt:DigImageGUID="[^"]*"/, "")), true, "any IPTC prefix works");
  const withCreator = provenanceXmp().replace("<rdf:Description", '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="someone"');
  assert.equal(isProvenanceOnlyXmp(withCreator), false);
  const asElement = provenanceXmp().replace("/></rdf:RDF>", "><dc:title>Secret</dc:title></rdf:Description></rdf:RDF>");
  assert.equal(isProvenanceOnlyXmp(asElement), false);
  assert.equal(isProvenanceOnlyXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'), false, "an empty packet is not provenance");
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
  const xmp = seg(0xe1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0"), Buffer.from(provenanceXmp())]));
  assert.deepEqual(inspectImage(jpeg(xmp), ".jpg"), { problems: [], sourceType: AI_SOURCE_TYPE });
});

test("WebP EXIF is refused", () => {
  const exif = Buffer.concat([Buffer.from("EXIF"), Buffer.from([4, 0, 0, 0]), Buffer.from("MM\0*")]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + exif.length);
  const webp = Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), exif]);
  assert.deepEqual(inspectImage(webp, ".webp").problems, ["EXIF metadata"]);
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

test("optimizePng drops an all-opaque alpha channel but keeps real transparency", async () => {
  const opaque = await sharp(await optimizePng(png(), null)).metadata();
  assert.equal(opaque.channels, 3);
  const translucent = await sharp(await optimizePng(png({ alpha: 128 }), null)).metadata();
  assert.equal(translucent.channels, 4);
});

test("optimizePng without a label writes no metadata at all", async () => {
  const out = await optimizePng(png({ extra: midjourneyChunks() }), null);
  const types = pngChunks(out).map((c) => c.type).filter((t) => t !== "IDAT");
  assert.deepEqual(types.filter((t) => !["IHDR", "IEND", "pHYs"].includes(t)), []);
});
