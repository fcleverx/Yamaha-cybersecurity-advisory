#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'templates/imported-standalone');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));

const DARK_BG = /background:\s*#(0001A0|0002D7|2627E0|C0392B|E74C3C|000180|0002D7)/i;

function isWhiteTextOnDark(chunk) {
  return DARK_BG.test(chunk) || /bgcolor="#(0001|0002|2627|C039|E74C)/i.test(chunk);
}

for (const file of files) {
  const fp = path.join(dir, file);
  let s = fs.readFileSync(fp, 'utf8');
  const orig = s;

  if (!file.includes('Template 10')) {
    s = s.replace(/color:\s*rgba\(255,\s*255,\s*255,\s*[0-9.]+\)/gi, 'color:#000000');
  }

  s = s.replace(/color:\s*#FFFFFF\b/gi, (match, offset) => {
    const chunk = s.slice(Math.max(0, offset - 250), offset + 250);
    return isWhiteTextOnDark(chunk) ? match : 'color:#000000';
  });

  if (!file.includes('Template 10')) {
    const grayColors = ['#1A1A1A', '#333', '#444', '#555', '#666', '#888', '#3D3D3D', '#0A0A0A'];
    for (const g of grayColors) {
      const re = new RegExp(`color:\\s*${g.replace('#', '#')}\\b`, 'gi');
      s = s.replace(re, 'color:#000000');
    }
    s = s.replace(/color:\s*rgba\(0,\s*0,\s*0,\s*0?\.[0-9]+\)/gi, 'color:#000000');
  } else {
    s = s.replace(
      /(<td[^>]*style="[^"]*background:\s*#FFFFFF[^"]*"[^>]*>[\s\S]{0,800}?)color:\s*rgba\(255,\s*255,\s*255,\s*0\.55\)/gi,
      '$1color:#000000'
    );
  }

  if (s !== orig) fs.writeFileSync(fp, s);
  console.log(file, s !== orig ? 'updated' : 'unchanged');
}
