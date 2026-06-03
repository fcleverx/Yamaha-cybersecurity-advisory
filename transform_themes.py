#!/usr/bin/env python3
"""
Transform HTML template files from dark theme to light theme.
Replaces dark backgrounds with white/light, white text on those backgrounds with dark text,
while preserving Yamaha blue accents and colored banners.
"""
import re
import os
import glob

DIRS = [
    "/Users/mayank/Downloads/awareness/templates/imported-standalone",
    "/Users/mayank/Downloads/awareness/templates/imported-email-safe",
]

# Yamaha blue / accent colors that should keep white text
ACCENT_BG_COLORS = ["#0001A0", "#0002D7", "#2627E0", "#000180", "#0002D7", 
                    "#E74C3C", "#C0392B", "#27AE60", "#8A7010"]

# rgba(255,255,255,.X) -> rgba(0,0,0,.Y) mappings (exact tokens, no spaces)
RGBA_MAP = {
    "rgba(255,255,255,.05)": "rgba(0,0,0,.03)",
    "rgba(255,255,255,.07)": "rgba(0,0,0,.05)",
    "rgba(255,255,255,.08)": "rgba(0,0,0,.06)",
    "rgba(255,255,255,.09)": "rgba(0,0,0,.07)",
    "rgba(255,255,255,.1)": "rgba(0,0,0,.08)",
    "rgba(255,255,255,.12)": "rgba(0,0,0,.09)",
    "rgba(255,255,255,.14)": "rgba(0,0,0,.10)",
    "rgba(255,255,255,.15)": "rgba(0,0,0,.11)",
    "rgba(255,255,255,.17)": "rgba(0,0,0,.13)",
    "rgba(255,255,255,.18)": "rgba(0,0,0,.14)",
    "rgba(255,255,255,.2)": "rgba(0,0,0,.15)",
    "rgba(255,255,255,.22)": "rgba(0,0,0,.18)",
    "rgba(255,255,255,.25)": "rgba(0,0,0,.20)",
    "rgba(255,255,255,.3)": "rgba(0,0,0,.25)",
    "rgba(255,255,255,.35)": "rgba(0,0,0,.28)",
    "rgba(255,255,255,.36)": "rgba(0,0,0,.30)",
    "rgba(255,255,255,.4)": "rgba(0,0,0,.32)",
    "rgba(255,255,255,.45)": "rgba(0,0,0,.36)",
    "rgba(255,255,255,.5)": "rgba(0,0,0,.40)",
    "rgba(255,255,255,.55)": "rgba(0,0,0,.44)",
    "rgba(255,255,255,.6)": "rgba(0,0,0,.48)",
    "rgba(255,255,255,.75)": "rgba(0,0,0,.60)",
}

# rgba with spaces: "rgba(255, 255, 255, .XX)"
RGBA_SPACED_PAT = re.compile(r'rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(\.\d+)\s*\)')

def map_rgba_alpha(alpha_str):
    """Map the alpha value from white to black equivalent."""
    alpha = float(alpha_str)
    mapping = {
        0.05: 0.03, 0.07: 0.05, 0.08: 0.06, 0.09: 0.07,
        0.1: 0.08, 0.12: 0.09, 0.14: 0.10, 0.15: 0.11,
        0.17: 0.13, 0.18: 0.14, 0.2: 0.15, 0.22: 0.18,
        0.25: 0.20, 0.3: 0.25, 0.35: 0.28, 0.36: 0.30,
        0.4: 0.32, 0.45: 0.36, 0.5: 0.40, 0.55: 0.44,
        0.6: 0.48, 0.75: 0.60,
    }
    new_alpha = mapping.get(alpha, alpha * 0.8)
    return f"rgba(0, 0, 0, {new_alpha:.2f})"


def has_accent_bg(style_str):
    """Check if style contains background with an accent color."""
    for color in ACCENT_BG_COLORS:
        if f"background:{color}" in style_str:
            return True
        if f"background-color:{color}" in style_str:
            return True
    return False

def transform_style_block(style_str):
    """Transform a single style attribute value."""
    original = style_str
    
    # 1. Replace dark backgrounds
    #    background:#0A0A0A -> background:#FFFFFF
    #    background-color:#0A0A0A -> background-color:#FFFFFF
    style_str = style_str.replace("background:#0A0A0A;", "background:#FFFFFF;")
    style_str = style_str.replace("background:#0A0A0A ", "background:#FFFFFF ")
    style_str = style_str.replace("background-color:#0A0A0A;", "background-color:#FFFFFF;")
    style_str = style_str.replace("background-color:#0A0A0A ", "background-color:#FFFFFF ")
    
    # 1b. Also handle #1C1C1C
    style_str = style_str.replace("background:#1C1C1C;", "background:#F0F0F3;")
    style_str = style_str.replace("background:#1C1C1C ", "background:#F0F0F3 ")
    style_str = style_str.replace("background-color:#1C1C1C;", "background-color:#F0F0F3;")
    style_str = style_str.replace("background-color:#1C1C1C ", "background-color:#F0F0F3 ")
    
    # 2. Replace exact rgba(255,255,255,.XX) tokens
    for old, new in RGBA_MAP.items():
        style_str = style_str.replace(old, new)
    
    # 3. Replace rgba(255, 255, 255, .XX) patterns (with spaces)
    style_str = RGBA_SPACED_PAT.sub(
        lambda m: map_rgba_alpha(m.group(1)),
        style_str
    )
    
    # 4. Handle color:white
    #    If the style has an accent background color, keep white
    #    Otherwise, change to #1A1A1A if the background was #0A0A0A (now #FFFFFF)
    #    But we also need to handle cases where color:white is on #0A0A0A bg
    
    has_accent = has_accent_bg(style_str)
    
    if not has_accent:
        # Check if this style had a dark background (now white)
        had_dark_bg = ("background:#FFFFFF" in style_str and "background:#FFFFFF" not in original) or \
                      ("background-color:#FFFFFF" in style_str and "background-color:#FFFFFF" not in original)
        
        if had_dark_bg:
            # Change color:white to color:#1A1A1A
            style_str = style_str.replace("color:white;", "color:#1A1A1A;")
            style_str = style_str.replace("color:white ", "color:#1A1A1A ")
            style_str = style_str.replace("color:white}", "color:#1A1A1A}")
    
    # 5. Replace #FFFEFA -> #FFFFFF
    style_str = style_str.replace("#FFFEFA", "#FFFFFF")
    
    # 6. Handle standalone color:#FFF (not background)
    style_str = style_str.replace("color:#FFF;", "color:#1A1A1A;")
    style_str = style_str.replace("color:#fff;", "color:#1A1A1A;")
    style_str = style_str.replace("color:#FFF ", "color:#1A1A1A ")
    style_str = style_str.replace("color:#fff ", "color:#1A1A1A ")
    
    return style_str


def transform_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    
    # 1. Replace bgcolor="#0A0A0A" attribute
    content = content.replace('bgcolor="#0A0A0A"', 'bgcolor="#FFFFFF"')
    
    # 2. Transform style="..." attributes
    def replace_style(match):
        prefix = match.group(1)  # style="
        style_val = match.group(2)  # the value
        suffix = match.group(3)  # closing "
        new_val = transform_style_block(style_val)
        return f'{prefix}{new_val}{suffix}'
    
    # Match style="..." in HTML
    content = re.sub(
        r'(style=")([^"]*)(")',
        replace_style,
        content
    )
    
    # 3. Handle <style> blocks with CSS custom properties
    # Replace --deep: #0A0A0A; with --deep: #FFFFFF;
    content = content.replace("--deep:      #0A0A0A;", "--deep:      #FFFFFF;")
    
    # 4. Handle the fade gradient (from dark header to transparent)
    # Already handled in transform_style_block if it's in a style attr
    # But let's also handle it globally
    content = content.replace(
        "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%)",
        "linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0) 100%)"
    )
    
    # 5. Handle non-style attribute color:white in style attrs that might have been missed
    # (shouldn't be needed since step 2 handles all style attrs, but just in case)
    
    # Write only if changed
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False


def verify_files(all_files):
    """Check for issues in transformed files."""
    issues = []
    for fpath in sorted(all_files):
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        basename = os.path.basename(fpath)
        
        # Check for remaining dark backgrounds in style attributes
        if 'background:#0A0A0A' in content:
            issues.append(f"background:#0A0A0A in {basename}")
        if 'background-color:#0A0A0A' in content:
            issues.append(f"background-color:#0A0A0A in {basename}")
        if 'bgcolor="#0A0A0A"' in content:
            issues.append(f'bgcolor="#0A0A0A" in {basename}')
        if 'background:#1C1C1C' in content:
            issues.append(f"background:#1C1C1C in {basename}")
        
        # Check for potential white-on-white issues
        # color:white on non-accent background
        # (this is harder to catch automatically, just flag it)
    
    return issues


def main():
    all_files = []
    for d in DIRS:
        all_files.extend(glob.glob(os.path.join(d, "*.html")))
    
    print(f"Found {len(all_files)} HTML files to process\n")
    
    changed = 0
    for f in sorted(all_files):
        if transform_file(f):
            changed += 1
            print(f"  CHANGED: {os.path.basename(f)}")
    
    print(f"\nChanged {changed} of {len(all_files)} files")
    
    # Verify
    issues = verify_files(all_files)
    if issues:
        print(f"\n⚠️  Issues found ({len(issues)}):")
        for i in issues:
            print(f"  {i}")
    else:
        print("\n✅ Verification passed - no remaining dark backgrounds!")

if __name__ == "__main__":
    main()