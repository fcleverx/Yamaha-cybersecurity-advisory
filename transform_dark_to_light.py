#!/usr/bin/env python3
"""Transform dark-themed inline HTML in JS files to light/white theme."""

import re
import sys

def transform_newsletter_builder(content):
    """Apply dark-to-light theme transformations to newsletter_builder.js"""
    
    # ─────────────────────────────────────────────────────────
    # Phase 1: rgba(255,255,255,...) → rgba(0,0,0,...)
    # These are all on dark backgrounds; map opacity
    # ─────────────────────────────────────────────────────────
    rgba_map = {
        'rgba(255,255,255,0.03)': 'rgba(0,0,0,0.02)',
        'rgba(255,255,255,0.04)': 'rgba(0,0,0,0.03)',
        'rgba(255,255,255,0.06)': 'rgba(0,0,0,0.045)',
        'rgba(255,255,255,0.07)': 'rgba(0,0,0,0.05)',
        'rgba(255,255,255,0.08)': 'rgba(0,0,0,0.06)',
        'rgba(255,255,255,.18)': 'rgba(0,0,0,.14)',
        'rgba(255,255,255,.22)': 'rgba(0,0,0,.17)',
        'rgba(255,255,255,.28)': 'rgba(0,0,0,.21)',
        'rgba(255,255,255,0.28)': 'rgba(0,0,0,0.21)',
        'rgba(255,255,255,0.32)': 'rgba(0,0,0,0.25)',
        'rgba(255,255,255,.32)': 'rgba(0,0,0,.25)',
        'rgba(255,255,255,0.4)': 'rgba(0,0,0,0.32)',
        'rgba(255,255,255,.4)': 'rgba(0,0,0,.32)',
        'rgba(255,255,255,0.42)': 'rgba(0,0,0,0.34)',
        'rgba(255,255,255,.42)': 'rgba(0,0,0,.34)',
        'rgba(255,255,255,0.45)': 'rgba(0,0,0,0.36)',
        'rgba(255,255,255,.45)': 'rgba(0,0,0,.36)',
        'rgba(255,255,255,.5)': 'rgba(0,0,0,.40)',
        'rgba(255,255,255,0.5)': 'rgba(0,0,0,0.40)',
        'rgba(255,255,255,.55)': 'rgba(0,0,0,.44)',
        'rgba(255,255,255,0.55)': 'rgba(0,0,0,0.44)',
        'rgba(255,255,255,0.58)': 'rgba(0,0,0,0.47)',
        'rgba(255,255,255,0.6)': 'rgba(0,0,0,0.48)',
        'rgba(255,255,255,.6)': 'rgba(0,0,0,.48)',
        'rgba(255,255,255,0.62)': 'rgba(0,0,0,0.50)',
        'rgba(255,255,255,.62)': 'rgba(0,0,0,.50)',
        'rgba(255,255,255,0.65)': 'rgba(0,0,0,0.52)',
        'rgba(255,255,255,.65)': 'rgba(0,0,0,.52)',
        'rgba(255,255,255,0.68)': 'rgba(0,0,0,0.55)',
        'rgba(255,255,255,0.7)': 'rgba(0,0,0,0.56)',
        'rgba(255,255,255,.7)': 'rgba(0,0,0,.56)',
        'rgba(255,255,255,0.75)': 'rgba(0,0,0,0.60)',
        'rgba(255,255,255,.75)': 'rgba(0,0,0,.60)',
        'rgba(255,255,255,0.78)': 'rgba(0,0,0,0.63)',
        'rgba(255,255,255,0.8)': 'rgba(0,0,0,0.64)',
        'rgba(255,255,255,.86)': 'rgba(0,0,0,.69)',
        'rgba(255,255,255,0.86)': 'rgba(0,0,0,0.69)',
        'rgba(255,255,255,0.85)': 'rgba(0,0,0,0.68)',
        'rgba(255,255,255,0.92)': 'rgba(0,0,0,0.74)',
    }
    
    for old, new in rgba_map.items():
        content = content.replace(old, new)
    
    # ─────────────────────────────────────────────────────────
    # Phase 2: Dark backgrounds → light backgrounds
    # bgcolor, background-color, style backgrounds, default values
    # ─────────────────────────────────────────────────────────
    
    # #0A0A0A → #FFFFFF when used as background
    bg_patterns = [
        ('bgcolor="#0A0A0A"', 'bgcolor="#FFFFFF"'),
        ("bgcolor='#0A0A0A'", "bgcolor='#FFFFFF'"),
        ('background-color:#0A0A0A', 'background-color:#FFFFFF'),
        ('background:#0A0A0A', 'background:#FFFFFF'),
        ("fill=\"#0A0A0A\"", 'fill="#FFFFFF"'),
        ('fill="#0A0A0A"', 'fill="#FFFFFF"'),  # SVG fills
    ]
    for old, new in bg_patterns:
        content = content.replace(old, new)
    
    # Default sectionBand bg
    content = content.replace("const _bg = bg || '#0A0A0A';", "const _bg = bg || '#FFFFFF';")
    
    # Default editorialDivider fg (stays as #0A0A0A - it's dark text on light bg) — skip
    
    # #171717 → #F5F5F7 (enhanced visual mode badge)
    content = content.replace('#171717', '#F5F5F7')
    
    # #111111 → #F5F5F7 (classification bar channel section)
    content = content.replace('#111111', '#F5F5F7')
    
    # #0F0F0F → #F5F5F7 (training step cards, stat cards)
    content = content.replace('#0F0F0F', '#F5F5F7')
    
    # #141414 → #F0F0F3 (watchout/reminder cards)
    content = content.replace('#141414', '#F0F0F3')
    
    # #0D0D0D → #F8F8FA (corp icon MSO fallback bg)
    content = content.replace('#0D0D0D', '#F8F8FA')
    
    # #3a3a3a (border in enhanced mode) → light gray
    content = content.replace('border:1px solid #3a3a3a', 'border:1px solid #D0D0D3')
    
    # #5C4A10 border (footer top border) → light border
    content = content.replace('border-top:1px solid #5C4A10', 'border-top:1px solid #D0D0D3')
    
    # ─────────────────────────────────────────────────────────
    # Phase 3: #FFFFFF text → #1A1A1A (but only on dark backgrounds)
    # ─────────────────────────────────────────────────────────
    # These are all text colors on dark backgrounds. We change them to dark.
    # But we keep #FFFFFF on colored backgrounds (blue, red, green) and in SVG strokes.
    
    # SVG: keep #FFFFFF in SVG (stroke/fill). These look like fill="none" stroke="#FFFFFF"
    # or in template literals for SVGs. They're on lines 1124-1126.
    # We handle those by NOT replacing those specific lines.
    
    # #FFFFFF as text color on dark backgrounds → #1A1A1A
    text_white_replacements = [
        # footer link text (on #0A0A0A → #FFFFFF bg)
        ("color:#FFFFFF;text-decoration:none;\" target=\"_blank\" rel=\"noopener noreferrer\">${pnameHtml}",
         "color:#1A1A1A;text-decoration:none;\" target=\"_blank\" rel=\"noopener noreferrer\">${pnameHtml}"),
        
        # trainingPackReportCta title text
        ("Don't Click. Don't Reply. Report It.</span><br><br>\n      + `<span style=\"font-size:13px;color:rgba(255,255,255,0.45)",
         "Don't Click. Don't Reply. Report It.</span><br><br>\n      + `<span style=\"font-size:13px;color:rgba(0,0,0,0.36)"),
        # Actually the rgba is already handled above. So just handle the white text.
        
        # But wait - the trainingPackReportCta has color:#FFFFFF on a #0A0A0A background that's now #FFFFFF
        # So white text on white bg → need to change to dark.
        # Let me be more surgical. The `color:#FFFFFF` in these contexts need to change.
    ]
    
    # Actually, let me do targeted replacements for specific color:#FFFFFF on known dark-bg contexts.
    # These are all inside dark background sections that are now light (after Phase 2).
    # 
    # In the footer (line 204): bg was #0A0A0A→#FFFFFF, text was #FFFFFF→#1A1A1A
    # In darkMasthead (line 296): bg was #0A0A0A→#FFFFFF, title color was #FFFFFF→#1A1A1A
    # In intelligenceMasthead (line 359): bg was #0A0A0A→#FFFFFF, title was #FFFFFF→#1A1A1A
    # In corp poster header (line 777): bg was #0A0A0A→#FFFFFF, title was #FFFFFF→#1A1A1A
    # In anatomy masthead (line 932): bg was #0A0A0A→#FFFFFF, title was #FFFFFF→#1A1A1A
    # etc.
    
    # Strategy: Any color:#FFFFFF that appears inside a block that had a dark bg changed 
    # to light should become #1A1A1A. The rgbs were handled. But we still have plain #FFFFFF.
    # 
    # Lines with color:#FFFFFF that need changing:
    # 204, 232, 238, 296, 359, 743, 757, 763, 777, 932, 1016, 1029, 1091, 1109, 1186, 1290, 1837
    # 
    # These are all inside dark bg sections. BUT:
    # - 238, 763 are button text on BLUE (#0001A0) background → KEEP white
    # - 743 is on BLUE (#0001A0) background → KEEP white
    # - 785 is on BLUE (#0001A0) background → KEEP white
    # - 306 is on BLUE (#0001A0) background → KEEP white
    # - 446, 530 are on threat level colored badges → KEEP white
    # - 1245 is on red button bg → KEEP white
    # - 1339, 1342 are on red/green bg → KEEP white
    # - 1526 is on threat level colored badge → KEEP white
    # - 1124, 1125, 1126 are SVG → KEEP white
    
    # So let me do very specific replacements by matching the exact context string.
    
    # The most reliable approach: change color:#FFFFFF that appears near a bgcolor/bg that was dark
    # But actually, the simpler approach is to change specific unique patterns.
    
    # Let me use a line-based approach: change color:#FFFFFF on lines that are in dark-bg headers
    # but NOT on blue/red badges.
    
    content = content.replace(
        "color:#FFFFFF;font-size:12px;font-weight:bold;text-decoration:none;${NLFF}\">Report to ${socShow}",
        "color:#1A1A1A;font-size:12px;font-weight:bold;text-decoration:none;${NLFF}\">Report to ${socShow}")
    
    content = content.replace(
        "color:#FFFFFF;font-weight:bold;font-size:12px;padding:11px 22px;text-decoration:none;${NLFF}\">Report to ${socShow}",
        "color:#1A1A1A;font-weight:bold;font-size:12px;padding:11px 22px;text-decoration:none;${NLFF}\">Report to ${socShow}")
    
    # The rest of the color:#FFFFFF changes are trickier because they share patterns.
    # Let me use a broader approach: change ALL remaining color:#FFFFFF in the file
    # EXCEPT those that are:
    # - In SVG blocks (between <svg and </svg>)
    # - On explicit colored backgrounds (blue #0001A0/#0002D7/#2627E0, red, green, orange, purple)
    # - In classification bars / badges where bg is a threat level color variable
    # 
    # Actually, the safest approach for the remaining #FFFFFF text is to handle them
    # with targeted line-level patches. Let me identify each one.
    
    print(f"Phase 1-2 applied: {content.count('rgba(255,255,255')} rgba(255,255,255) remaining")
    print(f"#0A0A0A remaining: {content.count('#0A0A0A')}")
    
    # Phase 3b: Handle remaining color:#FFFFFF text - these are the ones inside now-light bg sections
    # We need to be surgical.
    
    # darkMasthead title (line 296)
    content = content.replace(
        "color:#FFFFFF;line-height:1.1;${NLFF_SERIF}\">${title}",
        "color:#1A1A1A;line-height:1.1;${NLFF_SERIF}\">${title}")
    
    # intelligenceMasthead title (line 359)
    content = content.replace(
        "color:#FFFFFF;line-height:1.04;${NLFF_SERIF}\">${titleStr}",
        "color:#1A1A1A;line-height:1.04;${NLFF_SERIF}\">${titleStr}")
    
    # footer link (line 204) - unique enough
    # Already partially handled via the very specific pattern above
    
    # trainingPackReportCta title
    content = content.replace(
        "Don't Click. Don't Reply. Report It.</span><br><br>",
        "Don't Click. Don't Reply. Report It.</span><br><br>")
    # This doesn't need the color change since the surrounding text is already handled
    
    # corp report CTA (line 757)
    content = content.replace(
        "color:#FFFFFF;line-height:1.25;${NLFF_SERIF}\">Don't Click. Don't Reply. Report It.",
        "color:#1A1A1A;line-height:1.25;${NLFF_SERIF}\">Don't Click. Don't Reply. Report It.")
    
    # corp poster header title (line 777)
    content = content.replace(
        "color:#FFFFFF;line-height:1.08;${NLFF_SERIF}\">Stay Safe<br>",
        "color:#1A1A1A;line-height:1.08;${NLFF_SERIF}\">Stay Safe<br>")
    
    # stop-look-report title (line 1186)
    content = content.replace(
        "color:#FFFFFF;line-height:1.04;${NLFF_SERIF}\">${escapeHtml(c.title || 'Stop. Look. Report.')}",
        "color:#1A1A1A;line-height:1.04;${NLFF_SERIF}\">${escapeHtml(c.title || 'Stop. Look. Report.')}")
    
    # Signature-based replacements for titles that appear in dark bg sections
    # These are all in templates that start with a dark masthead area
    # Let me match them by the surrounding context
    
    # Anatomy title (line 932)
    content = content.replace(
        "color:#FFFFFF;line-height:1.05;${NLFF_SERIF}\">${escapeHtml(c.title || 'Anatomy of a Phish')}",
        "color:#1A1A1A;line-height:1.05;${NLFF_SERIF}\">${escapeHtml(c.title || 'Anatomy of a Phish')}")
    
    # Quick rules title (line 1029)
    content = content.replace(
        "color:#FFFFFF;line-height:1.05;${NLFF_SERIF}\">${escapeHtml(c.title || 'Quick Safety Rules')}",
        "color:#1A1A1A;line-height:1.05;${NLFF_SERIF}\">${escapeHtml(c.title || 'Quick Safety Rules')}")
    
    # Red flags title (line 1091)
    content = content.replace(
        "color:#FFFFFF;line-height:1.04;${NLFF_SERIF}\">${escapeHtml(c.title || 'Red Flag Checklist')}",
        "color:#1A1A1A;line-height:1.04;${NLFF_SERIF}\">${escapeHtml(c.title || 'Red Flag Checklist')}")
    
    # Red flags warning line (line 1109) - on dark bg
    content = content.replace(
        'font-weight:bold;color:#FFFFFF;line-height:1.35;${NLFF_SERIF}\">If any indicator is present',
        'font-weight:bold;color:#1A1A1A;line-height:1.35;${NLFF_SERIF}\">If any indicator is present')
    
    # Email dissect title (line 1290)
    content = content.replace(
        "color:#FFFFFF;line-height:1.04;${NLFF_SERIF}\">${escapeHtml(c.title || 'How to Read a Phish')}",
        "color:#1A1A1A;line-height:1.04;${NLFF_SERIF}\">${escapeHtml(c.title || 'How to Read a Phish')}")
    
    # Quick rules brief article title (line 1016) - on #141414 bg
    content = content.replace(
        "color:#FFFFFF;line-height:1.3;${NLFF_SERIF}\">${escapeHtml(a.title || '')}",
        "color:#1A1A1A;line-height:1.3;${NLFF_SERIF}\">${escapeHtml(a.title || '')}")
    
    # Testbrief (later in file) num text
    content = content.replace(
        "color:#FFFFFF;line-height:1;${NLFF_SERIF}\">${num}",
        "color:#1A1A1A;line-height:1;${NLFF_SERIF}\">${num}")
    
    # ─────────────────────────────────────────────────────────
    # Phase 4: Light text on darkish backgrounds that became light
    # #BBBBBB → #555555 (lighter text was on #0A0A0A bg)
    # ─────────────────────────────────────────────────────────
    content = content.replace('color:#BBBBBB', 'color:#555555')
    
    # ─────────────────────────────────────────────────────────
    # Phase 5: gradientFade - was dark-to-transparent on dark bg
    # Now should be white-to-transparent on white bg (or just removed)
    # ─────────────────────────────────────────────────────────
    content = content.replace(
        "background:linear-gradient(to bottom,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0) 100%);background-color:#FFFFFF;",
        "background:linear-gradient(to bottom,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0) 100%);background-color:#FFFFFF;")
    
    # ─────────────────────────────────────────────────────────
    # Phase 6: Special handling for SVG elements
    # Keep #FFFFFF in SVG but change #0A0A0A fills
    # ─────────────────────────────────────────────────────────
    # SVG fills of #0A0A0A were already changed above
    # But SVGs also have other dark colors that need changing:
    content = content.replace('#0b0b0b', '#333333')  # cybertimes SVG border/text
    
    # ─────────────────────────────────────────────────────────
    # Phase 7: Various misc changes
    # ─────────────────────────────────────────────────────────
    # #6A5010 (dark gold border in dossier template) → light gray
    content = content.replace('#6A5010', '#D0D0D3')
    
    # #2E2E2E (people SVG) → light gray
    # used in people thumbnail svg - keep as it's on dark bg within SVG
    
    # ─────────────────────────────────────────────────────────
    # Phase 8: Report remaining issues
    # ─────────────────────────────────────────────────────────
    remaining_rgba = content.count('rgba(255,255,255')
    remaining_0a0a = content.count('#0A0A0A')
    remaining_fff_text = content.count('color:#FFFFFF')
    remaining_fff_bg = content.count('bgcolor="#FFFFFF"') + content.count('background-color:#FFFFFF')
    print(f"After all phases:")
    print(f"  rgba(255,255,255) remaining: {remaining_rgba}")
    print(f"  #0A0A0A remaining: {remaining_0a0a}")
    print(f"  color:#FFFFFF remaining: {remaining_fff_text}")
    print(f"  #FFFFFF backgrounds: ~{remaining_fff_bg}")
    
    return content

def main():
    filepath = sys.argv[1] if len(sys.argv) > 1 else '/Users/mayank/Downloads/awareness/js/newsletter_builder.js'
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    content = transform_newsletter_builder(content)
    
    with open(filepath, 'w') as f:
        f.write(content)
    
    print(f"\nTransformed: {filepath}")

if __name__ == '__main__':
    main()