#!/usr/bin/env node
import fs from 'fs';

const fp = 'js/newsletter_builder.js';
let s = fs.readFileSync(fp, 'utf8');
const orig = s;

const DARK_BG = /background(?:-color)?:\s*#(0001A0|0002D7|2627E0|C0392B|E74C3C|000180|1a1a1a|0A0A0A)/i;

function chunkAt(offset, len = 280) {
  return s.slice(Math.max(0, offset - len), offset + len);
}

// White translucent text -> black (bullets, footers on white)
s = s.replace(/color:\s*rgba\(255,\s*255,\s*255,\s*[0-9.]+\)/gi, 'color:#000000');

// Gray / near-black body text -> black
const grayPatterns = [
  /color:\s*#1A1A1A\b/gi,
  /color:\s*#333333\b/gi,
  /color:\s*#333\b/gi,
  /color:\s*#444444\b/gi,
  /color:\s*#444\b/gi,
  /color:\s*#555555\b/gi,
  /color:\s*#555\b/gi,
  /color:\s*#666666\b/gi,
  /color:\s*#666\b/gi,
  /color:\s*#888888\b/gi,
  /color:\s*#888\b/gi,
  /color:\s*rgba\(0,\s*0,\s*0,\s*0?\.[0-9]+\)/gi,
];

for (const re of grayPatterns) {
  s = s.replace(re, (match, offset) => {
    const c = chunkAt(offset);
    if (DARK_BG.test(c) && /background-color:\s*#1a1a1a/i.test(c)) {
      return 'color:#FFFFFF';
    }
    return 'color:#000000';
  });
}

// Restore white text on explicit dark CTA / bar cells
s = s.replace(
  /(background(?:-color)?:\s*#(?:0001A0|0002D7|2627E0|C0392B|E74C3C|000180)[^;]*;[^"]*?)color:\s*#000000/gi,
  '$1color:#FFFFFF'
);
s = s.replace(
  /(bgcolor="#(?:0001A0|0002D7|2627E0|C0392B)[^"]*"[^>]*style="[^"]*?)color:\s*#000000/gi,
  '$1color:#FFFFFF'
);

// Dark filled buttons (report CTA on #1a1a1a)
s = s.replace(
  /background-color:\s*#1a1a1a;\s*color:\s*#000000/gi,
  'background-color:#1a1a1a;color:#FFFFFF'
);

if (s !== orig) {
  fs.writeFileSync(fp, s);
  console.log('Updated', fp);
} else {
  console.log('No changes');
}
