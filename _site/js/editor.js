/* ═══════════════════════════════════════════════════════════
   editor.js — Newsletter Studio Editor Module  v2
   Self-contained: inject CSS + HTML, expose App.Editor API.
   ui_controller.js calls App.Editor.open(opts) with callbacks.
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};
App.Editor = (function () {
  'use strict';

  /* ────────────────────────────────────────────────────────
     PRESET BLOCKS — inserted into the newsletter via Add panel
     ──────────────────────────────────────────────────────── */
  const ELEMS = [
    { icon: 'H',  label: 'Heading',    html: `<div style="font-family:'DM Serif Display',Georgia,serif;font-size:1.4rem;color:#0A0A0A;font-weight:700;line-height:1.2;padding:.3rem 0 .5rem">New Heading</div>` },
    { icon: '¶',  label: 'Paragraph',  html: `<p style="font-size:.86rem;color:#000000;line-height:1.65;margin:.4rem 0">Click to edit this paragraph. Double-click to type.</p>` },
    { icon: '→',  label: 'Button',     html: `<a href="#" style="display:inline-block;background:linear-gradient(135deg,#0001A0,#000180);color:#FFFFFF;font-weight:700;font-size:.78rem;padding:.6rem 1.4rem;border-radius:5px;text-decoration:none;margin:.5rem 0;word-break:break-all;max-width:100%;box-sizing:border-box">Click Here</a>` },
    { icon: '—',  label: 'Divider',    html: `<hr style="border:none;border-top:2px solid #D6DEF0;margin:1.2rem 0">` },
    { icon: '⚠',  label: 'Alert Box',  html: `<div style="background:#FEF3E0;border-left:4px solid #2627E0;padding:1rem 1.2rem;margin:.8rem 0;border-radius:0 6px 6px 0"><div style="font-size:.52rem;letter-spacing:.12em;text-transform:uppercase;color:#0002D7;font-weight:700;margin-bottom:.3rem">Important</div><p style="font-size:.82rem;color:#000000;line-height:1.5;margin:0">Alert message here. Double-click to edit.</p></div>` },
    { icon: '■',  label: 'Dark Box',   html: `<div style="background:#FFFFFF;color:#000000;padding:1.2rem 1.5rem;border-radius:6px;margin:.8rem 0"><div style="font-size:.52rem;letter-spacing:.12em;text-transform:uppercase;color:#2627E0;font-weight:700;margin-bottom:.4rem">Section</div><p style="font-size:.82rem;color:#000000;line-height:1.55;margin:0">Content here.</p></div>` },
    { icon: '•',  label: 'Bullet List',html: `<ul style="list-style:none;margin:.4rem 0;padding:0"><li style="font-size:.84rem;color:#000000;padding:.25rem 0 .25rem 1rem;position:relative;line-height:1.4"><span style="position:absolute;left:0;color:#0002D7;font-weight:700">›</span>First item</li><li style="font-size:.84rem;color:#000000;padding:.25rem 0 .25rem 1rem;position:relative;line-height:1.4"><span style="position:absolute;left:0;color:#0002D7;font-weight:700">›</span>Second item</li></ul>` },
    { icon: '🖼', label: 'Image',      html: `<div style="background:#D6DEF0;border:2px dashed #C8BEA8;border-radius:6px;padding:2.5rem;text-align:center;margin:.6rem 0;color:#000000;font-size:.78rem;font-style:italic">Image placeholder — select and edit src in browser devtools</div>` },
  ];

  const SECTIONS = [
    { icon: '◼', label: 'Dark Header',  html: `<div style="background:#FFFFFF;padding:2rem 2.5rem"><div style="font-size:.52rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(38,39,224,.7);font-weight:700;margin-bottom:.5rem">NEW SECTION</div><div style="font-family:'DM Serif Display',Georgia,serif;font-size:1.8rem;color:#000000;line-height:1.1">Section Heading</div><p style="font-size:.72rem;color:#000000;margin-top:.3rem;line-height:1.5">Supporting subtitle text.</p></div>` },
    { icon: '□', label: 'Light Card',   html: `<div style="background:#F8F5EF;padding:1.5rem 2.2rem;border-bottom:1px solid #D6DEF0"><div style="font-family:'DM Serif Display',Georgia,serif;font-size:1.1rem;color:#000000;margin-bottom:.5rem">Card Title</div><p style="font-size:.84rem;color:#000000;line-height:1.65;margin:0">Card body content. Double-click to edit.</p></div>` },
    { icon: '◈', label: 'Gold Strip',   html: `<div style="background:#0001A0;color:#FFFFFF;text-align:center;padding:.55rem 2rem;font-size:.64rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase">⚠ IMPORTANT NOTICE — CLICK TO EDIT</div>` },
    { icon: '⬡', label: 'Two Columns',  html: `<div style="background:#F8F5EF;padding:1.5rem 2rem;display:flex;gap:1.5rem;flex-wrap:wrap"><div style="flex:1;min-width:160px"><div style="font-size:.52rem;letter-spacing:.1em;text-transform:uppercase;color:#0002D7;font-weight:700;margin-bottom:.3rem">Left Column</div><p style="font-size:.82rem;color:#000000;line-height:1.5;margin:0">Left column content.</p></div><div style="flex:1;min-width:160px"><div style="font-size:.52rem;letter-spacing:.1em;text-transform:uppercase;color:#0002D7;font-weight:700;margin-bottom:.3rem">Right Column</div><p style="font-size:.82rem;color:#000000;line-height:1.5;margin:0">Right column content.</p></div></div>` },
    { icon: '▬', label: 'Red Warning',  html: `<div style="background:#C0392B;color:#1A1A1A;padding:1.2rem 2rem"><div style="font-family:'DM Serif Display',Georgia,serif;font-size:1rem;margin-bottom:.3rem">⚠ Security Warning</div><p style="font-size:.78rem;color:rgba(255,255,255,.8);margin:0;line-height:1.5">Important security notice content here.</p></div>` },
    { icon: '◻', label: 'Quote Block',  html: `<blockquote style="border-left:4px solid #0001A0;margin:1rem 0;padding:.8rem 1.2rem;background:#FAFAF7"><p style="font-family:'DM Serif Display',Georgia,serif;font-size:1rem;color:#000000;font-style:italic;line-height:1.5;margin:0 0 .3rem">"Key insight or important quote goes here."</p><cite style="font-size:.72rem;color:#000000;font-style:normal">— Source</cite></blockquote>` },
  ];

  /* ────────────────────────────────────────────────────────
     CSS — injected into <head> once at init
     ──────────────────────────────────────────────────────── */
  const CSS = `
/* Above App.UXContract .ux-shell (z-index 999) so the editor top bar Save/Export controls stay visible */
#editor-modal{display:none;position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.92)}
#editor-modal.active{display:flex}
.editor-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;background:#0c0c0c}
.ed-topbar{flex-shrink:0;display:flex;align-items:center;gap:.42rem;flex-wrap:wrap;padding:.4rem .75rem;background:#F0F0F3;border-bottom:1px solid rgba(0,0,0,.06)}
.ed-brand{font-size:.6rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#2627E0;white-space:nowrap}
.ed-sep{width:1px;height:16px;background:rgba(255,255,255,.1);flex-shrink:0}
.ed-device-pills{display:flex;gap:.16rem;background:rgba(0,0,0,.035);border:1px solid rgba(0,0,0,.06);border-radius:6px;padding:.14rem}
.ed-dpill{background:transparent;border:none;color:#888;font-family:'DM Sans',sans-serif;font-size:.62rem;padding:.25rem .5rem;border-radius:4px;cursor:pointer;transition:all .14s;white-space:nowrap}
.ed-dpill:hover{color:#1A1A1A;background:rgba(0,0,0,.05)}
.ed-dpill.active{background:rgba(0,2,215,.22);color:#2627E0}
.ed-tbtn{background:transparent;border:1px solid rgba(0,0,0,.09);color:#555;font-family:'DM Sans',sans-serif;font-size:.67rem;padding:.3rem .62rem;border-radius:5px;cursor:pointer;transition:all .14s;white-space:nowrap}
.ed-tbtn:hover{border-color:rgba(0,0,0,.22);color:#1A1A1A}
.ed-tbtn--preview{color:#2627E0;border-color:rgba(0,2,215,.3)}
.ed-tbtn--preview:hover{background:rgba(0,2,215,.1)}
.ed-tbtn--save{background:linear-gradient(135deg,#0001A0,#000180);color:#1A1A1A;border-color:transparent;font-weight:700}
.ed-tbtn--save:hover{background:linear-gradient(135deg,#2627E0,#B88C10)}
.ed-tbtn--close{color:#888}
.ed-tbtn--close:hover{color:#C0392B;border-color:rgba(192,57,43,.4)}
.ed-tbtn--export{color:rgba(255,255,255,.72);border-color:rgba(0,0,0,.10);font-weight:500}
.ed-tbtn--export:hover{border-color:rgba(38,39,224,.4);color:#f0e6cc;background:rgba(38,39,224,.07)}
.ed-tbtn-group{display:inline-flex;flex-wrap:wrap;align-items:stretch;gap:0;border-radius:7px;border:1px solid rgba(255,255,255,.1);overflow:hidden;background:rgba(0,0,0,.025)}
.ed-tbtn-group .ed-tbtn{border-radius:0;border-width:0 1px 0 0;margin:0;padding:.32rem .55rem;font-size:.62rem;min-height:2.05rem;align-items:center;display:inline-flex;justify-content:center}
.ed-tbtn-group .ed-tbtn:first-child{border-top-left-radius:6px;border-bottom-left-radius:6px}
.ed-tbtn-group .ed-tbtn:last-child{border-right-width:0;border-top-right-radius:6px;border-bottom-right-radius:6px}
.ed-status{font-size:.58rem;color:#2627E0;border:1px solid rgba(0,2,215,.28);border-radius:4px;padding:.16rem .38rem;white-space:nowrap}
.ed-spacer{flex:1;min-width:.25rem}
.ed-body{flex:1;display:flex;min-height:0;overflow:hidden}
.ed-nav{width:204px;flex-shrink:0;background:#0e0e0e;border-right:1px solid rgba(0,0,0,.05);display:flex;flex-direction:column;overflow:hidden}
.ed-nav-tabs{display:flex;flex-shrink:0;border-bottom:1px solid rgba(0,0,0,.05)}
.ed-nav-tab{flex:1;padding:.45rem .5rem;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(0,0,0,.30);background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .14s}
.ed-nav-tab:hover{color:rgba(0,0,0,.52)}
.ed-nav-tab.active{color:#2627E0;border-bottom-color:#0001A0}
.ed-nav-pane{flex:1;overflow-y:auto;display:none}
.ed-nav-pane.active{display:block}
.ed-nav-sec-head{padding:.5rem .72rem .2rem;font-size:.46rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(38,39,224,.5);font-weight:700}
.ed-nav-item{padding:.38rem .72rem;font-size:.7rem;color:rgba(255,255,255,.48);cursor:pointer;transition:all .12s;border-left:2px solid transparent;border-bottom:1px solid rgba(0,0,0,.035);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ed-nav-item:hover{color:#1A1A1A;background:rgba(0,0,0,.035);border-left-color:rgba(38,39,224,.4)}
.ed-palette-item{display:flex;align-items:center;gap:.5rem;padding:.38rem .72rem;font-size:.7rem;color:rgba(0,0,0,.44);cursor:pointer;transition:all .12s;border-bottom:1px solid rgba(0,0,0,.035)}
.ed-palette-item:hover{color:#1A1A1A;background:rgba(0,2,215,.1)}
.ed-palette-icon{width:22px;height:22px;background:rgba(0,0,0,.045);border:1px solid rgba(255,255,255,.1);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:.65rem;flex-shrink:0;color:#2627E0}
.ed-canvas-col{flex:1;display:flex;flex-direction:column;min-width:0;background:#141414}
.ed-canvas-hint{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;padding:.32rem .75rem;font-size:.6rem;color:rgba(0,0,0,.25);letter-spacing:.02em;background:rgba(255,255,255,.016);border-bottom:1px solid rgba(0,0,0,.03)}
.ed-canvas-hint-text{flex:1;min-width:12rem;line-height:1.45}
.ed-canvas-hint b{color:rgba(38,39,224,.65);font-weight:600}
.ed-canvas-hint-actions{display:inline-flex;flex-shrink:0;align-items:center;gap:.35rem;flex-wrap:wrap}
.ed-hint-btn{font-family:'DM Sans',sans-serif;font-size:.62rem;font-weight:600;padding:.34rem .72rem;border-radius:5px;cursor:pointer;border:1px solid rgba(0,0,0,.10);background:rgba(0,0,0,.045);color:#e8e4dc;transition:border-color .14s,background .14s,color .14s;white-space:nowrap}
.ed-hint-btn:hover{border-color:rgba(38,39,224,.45);color:#1A1A1A;background:rgba(38,39,224,.12)}
.ed-hint-btn--save{background:linear-gradient(135deg,#0001A0,#000180);border-color:transparent;color:#1A1A1A}
.ed-hint-btn--save:hover{background:linear-gradient(135deg,#2627E0,#B88C10);color:#1A1A1A}
.ed-canvas-scroll{flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:28px 20px}
.ed-canvas-frame{transition:max-width .25s ease;background:#B8C3D4;width:100%;max-width:700px;box-shadow:0 6px 48px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.06);border-radius:3px;overflow:hidden}
#nl-ed-iframe{width:100%;border:0;display:block;min-height:800px}
.ed-panel{width:272px;flex-shrink:0;background:#0e0e0e;border-left:1px solid rgba(0,0,0,.05);overflow-y:auto;display:flex;flex-direction:column}
.ed-panel-idle{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem 1.1rem;color:#888}
.ed-panel-idle-icon{font-size:1.6rem;opacity:.18;margin-bottom:.6rem}
.ed-panel-idle p{font-size:.75rem;margin-bottom:.55rem;line-height:1.55}
.ed-panel-idle ul{list-style:none;font-size:.67rem;color:rgba(255,255,255,.3);line-height:2.1}
.ed-panel-props{display:flex;flex-direction:column}
.ed-panel-tag{font-size:.47rem;letter-spacing:.18em;text-transform:uppercase;color:#2627E0;font-weight:700;padding:.62rem .82rem .06rem}
.ed-panel-text-preview{font-size:.7rem;color:rgba(255,255,255,.42);padding:.06rem .82rem .6rem;border-bottom:1px solid rgba(0,0,0,.045);max-height:3.2rem;overflow:hidden;line-height:1.45}
.ed-prop{padding:.52rem .82rem;border-bottom:1px solid rgba(0,0,0,.03)}
.ed-prop>label{display:block;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(0,0,0,.30);margin-bottom:.36rem;font-weight:600}
.ed-prop-row{display:flex;align-items:center;gap:.38rem;margin-bottom:.18rem}
.ed-prop-row:last-child{margin-bottom:0}
.ed-prop-row input[type="color"]{width:32px;height:25px;border:1px solid rgba(0,0,0,.10);border-radius:4px;padding:2px;background:#1a1a1a;cursor:pointer;flex-shrink:0}
.ed-hex{flex:1;background:rgba(0,0,0,.045);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#eee;font-family:'JetBrains Mono','Consolas',monospace;font-size:.67rem;padding:.27rem .4rem}
.ed-hex:focus{outline:none;border-color:#2627E0}
.ed-num{width:52px;background:rgba(0,0,0,.045);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#eee;font-size:.7rem;padding:.27rem .3rem;text-align:center}
.ed-num:focus{outline:none;border-color:#2627E0}
.ed-num-wide{flex:1;width:auto}
.ed-prop-lbl{font-size:.6rem;color:rgba(255,255,255,.3);width:36px;flex-shrink:0}
.ed-prop-unit{font-size:.6rem;color:rgba(255,255,255,.3)}
.ed-prop input[type="range"]{flex:1;accent-color:#0001A0}
.ed-clr-x{background:transparent;border:1px solid rgba(255,255,255,.1);color:#888;border-radius:3px;padding:.17rem .3rem;cursor:pointer;font-size:.6rem;flex-shrink:0}
.ed-clr-x:hover{border-color:#C0392B;color:#C0392B}
.ed-fmt-row{display:flex;gap:.26rem}
.ed-fmt{flex:1;padding:.4rem;background:rgba(0,0,0,.03);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#555;cursor:pointer;font-size:.76rem;transition:all .12s;font-family:'DM Sans',sans-serif;text-align:center}
.ed-fmt:hover{border-color:rgba(38,39,224,.4);color:#2627E0}
.ed-fmt.on{background:rgba(0,2,215,.2);border-color:#0001A0;color:#2627E0}
.ed-prop-ta{width:100%;background:rgba(0,0,0,.03);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#eee;font-family:'DM Sans',sans-serif;font-size:.74rem;padding:.44rem .54rem;resize:vertical;line-height:1.5;box-sizing:border-box}
.ed-prop-ta:focus{outline:none;border-color:#2627E0}
.ed-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:.32rem}
.ed-act2{display:inline-flex;align-items:center;justify-content:center;gap:.25rem;padding:.44rem .45rem;font-size:.58rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.72);background:rgba(0,0,0,.035);border:1px solid rgba(255,255,255,.11);border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif;transition:border-color .14s,background .14s,color .14s,box-shadow .14s}
.ed-act2:hover{border-color:rgba(38,39,224,.42);color:#f5ecd8;background:rgba(38,39,224,.09);box-shadow:0 1px 0 rgba(0,0,0,.2)}
.ed-act2:focus-visible{outline:2px solid rgba(38,39,224,.55);outline-offset:2px}
.ed-act2--danger{grid-column:1/-1;margin-top:.12rem;color:rgba(248,180,170,.95);border-color:rgba(231,76,60,.38);background:rgba(192,57,43,.1)}
.ed-act2--danger:hover{border-color:rgba(231,76,60,.55);color:#1A1A1A;background:rgba(192,57,43,.2)}
.ed-act2--all-langs{grid-column:1/-1;color:rgba(255,210,190,.95);border-color:rgba(231,76,60,.32);background:rgba(192,57,43,.07)}
.ed-act2--all-langs:hover{border-color:rgba(231,76,60,.48);color:#1A1A1A;background:rgba(192,57,43,.16)}
.ed-act2--wide{grid-column:1/-1}
.ed-desel{width:100%;padding:.44rem;background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#888;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:.65rem;transition:all .12s}
.ed-desel:hover{border-color:rgba(255,255,255,.24);color:#1A1A1A}
.ed-text-sync-note{font-size:.58rem;color:rgba(255,255,255,.38);line-height:1.45;margin:0 0 .42rem}
#ed-text-sync-btn:disabled{opacity:.35;cursor:not-allowed}
.ed-presets{display:grid;grid-template-columns:1fr 1fr;gap:.3rem}
.ed-preset{padding:.35rem .4rem;border:1px solid rgba(0,0,0,.09);background:rgba(0,0,0,.035);color:#444;border-radius:4px;cursor:pointer;font-size:.63rem}
.ed-preset:hover{border-color:rgba(38,39,224,.5);color:#2627E0}
.ed-floatbar{position:fixed;z-index:400;display:none;gap:.25rem;align-items:center;background:#FFFFFF;border:1px solid rgba(38,39,224,.35);border-radius:7px;padding:.22rem;box-shadow:0 8px 20px rgba(0,0,0,.45)}
.ed-floatbar.active{display:flex}
.ed-floatbtn{border:1px solid rgba(0,0,0,.10);background:rgba(0,0,0,.035);color:#444;border-radius:4px;font-size:.66rem;padding:.22rem .42rem;cursor:pointer}
.ed-floatbtn:hover{border-color:rgba(38,39,224,.5);color:#2627E0}
@media (max-width: 1024px){
  .ed-nav{width:176px}
  .ed-panel{width:228px}
}
@media (max-width: 760px){
  .ed-topbar{padding:.35rem .5rem}
  .ed-nav{display:none}
  .ed-panel{position:fixed;right:0;top:44px;bottom:0;z-index:20;width:min(82vw,260px);box-shadow:-8px 0 20px rgba(0,0,0,.35)}
  .ed-canvas-scroll{padding:12px 8px}
  .ed-floatbar{display:none!important}
}
`;

  /* ────────────────────────────────────────────────────────
     HTML — editor modal, built and injected at init
     ──────────────────────────────────────────────────────── */
  function _buildHtml() {
    const elItems = ELEMS.map((e, i) =>
      `<div class="ed-palette-item" onclick="App.Editor._addEl(${i})" title="Insert ${e.label}">` +
      `<div class="ed-palette-icon">${e.icon}</div>${e.label}</div>`).join('');
    const secItems = SECTIONS.map((s, i) =>
      `<div class="ed-palette-item" onclick="App.Editor._addSec(${i})" title="Add: ${s.label}">` +
      `<div class="ed-palette-icon">${s.icon}</div>${s.label}</div>`).join('');

    return `<div id="editor-modal">
  <div class="editor-wrap">
    <div class="ed-topbar">
      <span class="ed-brand" id="editor-lang-label">Newsletter Studio</span>
      <div class="ed-sep"></div>
      <div class="ed-device-pills">
        <button class="ed-dpill" data-w="" onclick="App.Editor._device(this,'')">&#x1F5A5; Full</button>
        <button class="ed-dpill active" data-w="700px" onclick="App.Editor._device(this,'700px')">&#x2709; 700px</button>
        <button class="ed-dpill" data-w="390px" onclick="App.Editor._device(this,'390px')">&#x1F4F1; Mobile</button>
      </div>
      <div class="ed-sep"></div>
      <button class="ed-tbtn" onclick="App.Editor._undo()" title="Undo">&#x21A9; Undo</button>
      <button class="ed-tbtn" onclick="App.Editor._redo()" title="Redo">&#x21AA; Redo</button>
      <button class="ed-tbtn" onclick="App.Editor._reset()" title="Reset to base template">Reset</button>
      <span class="ed-status" id="editor-status">Ready</span>
      <div class="ed-spacer"></div>
      <button type="button" class="ed-tbtn ed-tbtn--preview" onclick="App.Editor._preview()" title="Open read-only preview in a new tab">Preview</button>
      <div class="ed-tbtn-group" role="group" aria-label="Save and download">
        <button type="button" class="ed-tbtn ed-tbtn--save" onclick="void App.Editor.saveToWorkspaceAndProject()" title="Save this language from the canvas to the workspace, then store the full project (every language variant) in IndexedDB">Save</button>
        <button type="button" class="ed-tbtn ed-tbtn--export" onclick="void App.Editor.downloadCurrentLanguage()" title="Save canvas, then download this language as one HTML file">Single file</button>
        <button type="button" class="ed-tbtn ed-tbtn--export" onclick="void App.Editor.downloadAllLanguages()" title="Save canvas, then download ZIP with html/ and svg/ folders">All files</button>
      </div>
      <button type="button" class="ed-tbtn ed-tbtn--close" onclick="App.Editor.close()" title="Close editor">&#x2715;</button>
    </div>
    <div class="ed-body">
      <div class="ed-nav" id="ed-nav">
        <div class="ed-nav-tabs">
          <button class="ed-nav-tab active" onclick="App.Editor._navTab(this,'sections')">Sections</button>
          <button class="ed-nav-tab" onclick="App.Editor._navTab(this,'add')">+ Add</button>
        </div>
        <div class="ed-nav-pane active" id="ed-nav-sections">
          <div id="ed-nav-list"><div class="ed-nav-item" style="opacity:.35;cursor:default;font-size:.65rem;padding:.6rem .72rem">Loading&hellip;</div></div>
        </div>
        <div class="ed-nav-pane" id="ed-nav-add">
          <div class="ed-nav-sec-head">Elements</div>${elItems}
          <div class="ed-nav-sec-head" style="margin-top:.35rem">Sections</div>${secItems}
        </div>
      </div>
      <div class="ed-canvas-col">
        <div class="ed-canvas-hint">
          <span class="ed-canvas-hint-text">
            <b>Click</b> to select &middot; <b>Double-click</b> to edit text &middot;
            <b>Delete</b> key removes &middot; <b>&#x2B; Add</b> panel inserts blocks &middot;
            <b>&#x22EE;&#x22EE; Drag</b> to reorder
          </span>
          <span class="ed-canvas-hint-actions">
            <button type="button" class="ed-hint-btn ed-hint-btn--save" onclick="void App.Editor.saveToWorkspaceAndProject()" title="Save this language to the workspace and store the full project (all languages)">Save changes</button>
          </span>
        </div>
        <div class="ed-canvas-scroll">
          <div class="ed-canvas-frame" id="ed-canvas-frame">
            <iframe id="nl-ed-iframe" sandbox="allow-same-origin allow-scripts" title="Newsletter Editor Canvas"></iframe>
          </div>
        </div>
      </div>
      <div class="ed-panel" id="ed-panel">
        <div class="ed-panel-idle" id="ed-panel-idle">
          <div class="ed-panel-idle-icon">&#x1F446;</div>
          <p>Click any element in the newsletter to select &amp; edit it</p>
          <ul>
            <li>Text &amp; background color</li>
            <li>Font size &amp; style</li>
            <li>Width &amp; padding</li>
            <li>Move, delete, or drag to reorder</li>
          </ul>
        </div>
        <div class="ed-panel-props" id="ed-panel-props" style="display:none">
          <div class="ed-panel-tag" id="ed-el-tag">&mdash;</div>
          <div class="ed-panel-text-preview" id="ed-el-preview">&mdash;</div>

          <div class="ed-prop">
            <label>Element actions</label>
            <div class="ed-action-grid">
              <button type="button" class="ed-act2" onclick="App.Editor._moveUp()" title="Move element up">Up</button>
              <button type="button" class="ed-act2" onclick="App.Editor._moveDown()" title="Move element down">Down</button>
              <button type="button" class="ed-act2" onclick="App.Editor._startDrag()" title="Drag to reorder in the canvas">Drag</button>
              <button type="button" class="ed-act2" onclick="App.Editor._duplicate()" title="Duplicate this block">Duplicate</button>
              <button type="button" class="ed-act2 ed-act2--wide" onclick="App.Editor._lockToggle()" title="Lock or unlock this section">Lock</button>
              <button type="button" class="ed-act2 ed-act2--danger" onclick="App.Editor._delete()" title="Remove this element">Remove</button>
              <button type="button" class="ed-act2 ed-act2--all-langs" onclick="void App.Editor.deleteSelectedInAllLanguages()" title="Remove this block from every language version (same position in each template)">Remove in all languages</button>
            </div>
          </div>

          <div class="ed-prop">
            <label>Text Color</label>
            <div class="ed-prop-row">
              <input type="color" id="prop-color" oninput="App.Editor._prop('color',this.value)">
              <input type="text" class="ed-hex" id="prop-color-hex" maxlength="9" placeholder="#ffffff" oninput="App.Editor._propHex('color',this.value)">
            </div>
          </div>

          <div class="ed-prop">
            <label>Background</label>
            <div class="ed-prop-row">
              <input type="color" id="prop-bg" oninput="App.Editor._prop('bg',this.value)">
              <input type="text" class="ed-hex" id="prop-bg-hex" maxlength="9" placeholder="transparent" oninput="App.Editor._propHex('bg',this.value)">
              <button class="ed-clr-x" onclick="App.Editor._prop('bg','')" title="Clear background">&#x2715;</button>
            </div>
          </div>

          <div class="ed-prop">
            <label>Font Size</label>
            <div class="ed-prop-row">
              <input type="range" id="prop-size-range" min="8" max="80" value="16" oninput="App.Editor._propSize(this.value)">
              <input type="number" class="ed-num" id="prop-size" min="4" max="200" value="16" oninput="App.Editor._propSize(this.value)">
            </div>
          </div>

          <div class="ed-prop">
            <label>Size &amp; Spacing</label>
            <div class="ed-prop-row">
              <span class="ed-prop-lbl">Width</span>
              <input type="number" class="ed-num ed-num-wide" id="prop-width" min="0" max="1200" placeholder="auto" oninput="App.Editor._setWidth(this.value)">
              <span class="ed-prop-unit">px</span>
            </div>
            <div class="ed-prop-row">
              <span class="ed-prop-lbl">Padding</span>
              <input type="number" class="ed-num ed-num-wide" id="prop-padding" min="0" max="200" placeholder="&mdash;" oninput="App.Editor._setPadding(this.value)">
              <span class="ed-prop-unit">px</span>
            </div>
          </div>

          <div class="ed-prop">
            <label>Style</label>
            <div class="ed-fmt-row">
              <button class="ed-fmt" id="fmt-bold" onclick="App.Editor._toggle('bold')" title="Bold"><b>B</b></button>
              <button class="ed-fmt" id="fmt-italic" onclick="App.Editor._toggle('italic')" title="Italic"><i>I</i></button>
              <button class="ed-fmt" id="fmt-underline" onclick="App.Editor._toggle('underline')" title="Underline"><u>U</u></button>
            </div>
          </div>

          <div class="ed-prop">
            <label>Alignment</label>
            <div class="ed-fmt-row">
              <button class="ed-fmt" onclick="App.Editor._prop('align','left')">&#x2261;L</button>
              <button class="ed-fmt" onclick="App.Editor._prop('align','center')">&#x2261;C</button>
              <button class="ed-fmt" onclick="App.Editor._prop('align','right')">&#x2261;R</button>
            </div>
          </div>

          <div class="ed-prop">
            <label>Quick Presets</label>
            <div class="ed-presets">
              <button class="ed-preset" onclick="App.Editor._applyPreset('heading')">Heading</button>
              <button class="ed-preset" onclick="App.Editor._applyPreset('body')">Body</button>
              <button class="ed-preset" onclick="App.Editor._applyPreset('cta')">CTA</button>
              <button class="ed-preset" onclick="App.Editor._applyPreset('accent')">Accent</button>
            </div>
          </div>

          <div class="ed-prop">
            <label>Edit Text <span style="opacity:.4;font-size:.5rem">(or double-click in canvas)</span></label>
            <textarea class="ed-prop-ta" id="prop-text-area" rows="3" placeholder="Type here to edit selected element\u2019s text\u2026" oninput="App.Editor._setText(this.value)"></textarea>
          </div>

          <div class="ed-prop" id="ed-text-sync-row">
            <label>Other languages</label>
            <p class="ed-text-sync-note">After you edit text, this button saves the current language, then translates this block\u2019s text into every other language at the same layout position.</p>
            <button type="button" class="ed-act2 ed-act2--wide" onclick="void App.Editor._syncTextToOtherLanguages()" id="ed-text-sync-btn">Update / translate in all other languages</button>
          </div>

          <div class="ed-prop">
            <button class="ed-desel" onclick="App.Editor._deselect()">Deselect element</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div id="ed-floatbar" class="ed-floatbar">
    <button class="ed-floatbtn" onclick="App.Editor._toggle('bold')"><b>B</b></button>
    <button class="ed-floatbtn" onclick="App.Editor._toggle('italic')"><i>I</i></button>
    <button class="ed-floatbtn" onclick="App.Editor._toggle('underline')"><u>U</u></button>
    <button class="ed-floatbtn" onclick="App.Editor._prop('align','left')">L</button>
    <button class="ed-floatbtn" onclick="App.Editor._prop('align','center')">C</button>
    <button class="ed-floatbtn" onclick="App.Editor._prop('align','right')">R</button>
  </div>
</div>`;
  }

  /* ────────────────────────────────────────────────────────
     IFRAME INJECTED SCRIPT (_nlEdFn)
     Serialised via .toString() — executes inside the iframe.
     No outer-scope references; communicates via postMessage.
     ──────────────────────────────────────────────────────── */
  const _nlEdFn = function () {
    var _sel = null, _edEl = null, _dragEl = null, _dropLine = null, _hoverEl = null, _insideTarget = null;

    function post(t, d) {
      try { parent.postMessage(Object.assign({ _nlEd: true, type: t }, d || {}), '*'); } catch (e) {}
    }

    function rgb2hex(s) {
      if (!s || s === 'transparent' || s.indexOf('rgba(0, 0, 0, 0)') !== -1) return '';
      var m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return s.charAt(0) === '#' ? s : '';
      return '#' + [m[1], m[2], m[3]].map(function (v) { return (+v).toString(16).padStart(2, '0'); }).join('');
    }

    function getProps(el) {
      if (!el) return {};
      var cs = window.getComputedStyle(el);
      var fw = el.style.fontWeight || cs.fontWeight;
      var rect = el.getBoundingClientRect();
      var fullText = el.textContent || '';
      return {
        tag: el.tagName,
        text: fullText.replace(/\s+/g, ' ').trim().slice(0, 100),
        textFull: fullText,
        color: el.style.color || rgb2hex(cs.color) || '',
        bgColor: el.style.backgroundColor || rgb2hex(cs.backgroundColor) || '',
        fontSize: parseInt(el.style.fontSize || cs.fontSize) || 14,
        bold: fw === 'bold' || fw === '700' || +fw >= 600,
        italic: (el.style.fontStyle || cs.fontStyle) === 'italic',
        underline: (el.style.textDecoration || cs.textDecoration || '').indexOf('underline') !== -1,
        align: el.style.textAlign || cs.textAlign || 'left',
        width: parseInt(el.style.width) || 0,
        padding: parseInt(el.style.padding) || 0,
        locked: el.getAttribute('data-nl-lock') === '1',
        rectTop: rect.top, rectLeft: rect.left, rectWidth: rect.width
      };
    }

    // Inject highlight + drag styles (CSS-class approach — never mutates inline style)
    var _hl = document.createElement('style');
    _hl.textContent =
      '[data-nl-sel="1"]{outline:2px solid rgba(38,39,224,.85)!important;outline-offset:2px!important}' +
      '[data-nl-hover="1"]{outline:1px dashed rgba(38,39,224,.5)!important;outline-offset:1px!important}' +
      '[data-nl-drop-inside="1"]{box-shadow:inset 0 0 0 2px rgba(38,39,224,.6)!important}' +
      '[data-nl-lock="1"]{position:relative}' +
      '[data-nl-lock="1"]::after{content:"LOCKED";position:absolute;top:4px;right:4px;font-size:10px;background:#8b6b06;color:#1A1A1A;padding:1px 4px;border-radius:3px;letter-spacing:.06em}' +
      '[contenteditable="true"]{outline:2px solid rgba(38,39,224,.9)!important;caret-color:#2627E0}' +
      '.nl-drag-ghost{opacity:.35!important;pointer-events:none}';
    document.head.appendChild(_hl);

    function setHl(el, on) {
      if (!el) return;
      if (on) el.setAttribute('data-nl-sel', '1');
      else el.removeAttribute('data-nl-sel');
    }

    function computeDomPathForEl(localEl) {
      if (!localEl || localEl === document.body) return { path: null, relPath: null, locked: false };
      if (localEl.getAttribute('data-nl-lock') === '1') return { path: null, relPath: null, locked: true };
      var path = [];
      var n = localEl;
      while (n && n !== document.body) {
        var p = n.parentElement;
        if (!p) { path = null; break; }
        path.unshift(Array.prototype.indexOf.call(p.children, n));
        n = p;
      }
      var tplRoot = document.querySelector('[data-template-id]');
      var relPath = null;
      if (tplRoot && tplRoot !== localEl && tplRoot.contains(localEl)) {
        relPath = [];
        n = localEl;
        while (n && n !== tplRoot) {
          p = n.parentElement;
          if (!p) { relPath = null; break; }
          relPath.unshift(Array.prototype.indexOf.call(p.children, n));
          n = p;
        }
      }
      return { path: path, relPath: relPath, locked: false };
    }

    function doSelect(el) {
      if (_sel === el) return;
      setHl(_sel, false); _sel = el; setHl(_sel, true);
      if (_sel) post('select', getProps(_sel)); else post('deselect');
    }

    function startEdit(el) {
      if (!el || el === document.body) return;
      if (_edEl && _edEl !== el) { _edEl.removeAttribute('contenteditable'); _edEl.style.cursor = ''; }
      _edEl = el; el.contentEditable = 'true'; el.style.cursor = 'text'; el.focus();
      try {
        var r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } catch (e) {}
      post('editing', { tag: el.tagName });
    }

    function stopEdit() {
      if (!_edEl) return;
      var el = _edEl;
      _edEl.removeAttribute('contenteditable'); _edEl.style.cursor = ''; _edEl = null;
      var dp = computeDomPathForEl(el);
      post('editDone', {
        path: dp.path,
        relPath: dp.relPath,
        locked: dp.locked,
        textFull: el.textContent || ''
      });
      if (_sel) post('select', getProps(_sel));
    }

    function doDelete() {
      if (!_sel || _sel === document.body || _sel === document.documentElement) return;
      if (_sel.getAttribute('data-nl-lock') === '1') { post('locked', {}); return; }
      stopEdit();
      _sel.remove(); _sel = null;
      post('deleted', {}); reportHeight();
    }

    function doMove(dir) {
      if (!_sel || _sel === document.body) return;
      if (_sel.getAttribute('data-nl-lock') === '1') { post('locked', {}); return; }
      if (dir === 'up' && _sel.previousElementSibling) {
        _sel.parentNode.insertBefore(_sel, _sel.previousElementSibling);
      } else if (dir === 'down' && _sel.nextElementSibling) {
        _sel.parentNode.insertBefore(_sel.nextElementSibling, _sel);
      }
      _sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      reportHeight(); post('moved', {});
    }

    function doDuplicate() {
      if (!_sel || _sel === document.body) return;
      var copy = _sel.cloneNode(true);
      _sel.parentNode.insertBefore(copy, _sel.nextSibling);
      doSelect(copy);
      reportHeight(); post('added', {});
    }

    function doLockToggle() {
      if (!_sel || _sel === document.body) return;
      if (_sel.getAttribute('data-nl-lock') === '1') _sel.removeAttribute('data-nl-lock');
      else _sel.setAttribute('data-nl-lock', '1');
      post('select', getProps(_sel));
    }

    function doAddEl(html) {
      var tmp = document.createElement('div'); tmp.innerHTML = html;
      var newEl = tmp.firstElementChild || tmp;
      if (_sel && _sel.parentNode) _sel.parentNode.insertBefore(newEl, _sel.nextSibling || null);
      else { var root = document.body.firstElementChild || document.body; root.appendChild(newEl); }
      doSelect(newEl);
      newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      reportHeight(); post('added', {});
    }

    function doAddSec(html) {
      var tmp = document.createElement('div'); tmp.innerHTML = html;
      var newEl = tmp.firstElementChild || tmp;
      var root = document.body.firstElementChild || document.body;
      root.appendChild(newEl);
      doSelect(newEl);
      newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      reportHeight(); post('added', {});
    }

    function setTextPreservingInlineMarkup(el, nextText) {
      if (!el) return;
      var text = String(nextText == null ? '' : nextText);
      if (!el.children || !el.children.length) {
        el.textContent = text;
        return;
      }
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      if (!textNodes.length) {
        el.textContent = text;
        return;
      }
      var remaining = text;
      for (var i = 0; i < textNodes.length; i += 1) {
        var n = textNodes[i];
        if (i === textNodes.length - 1) {
          n.nodeValue = remaining;
          remaining = '';
        } else {
          var curLen = (n.nodeValue || '').length;
          n.nodeValue = remaining.slice(0, curLen);
          remaining = remaining.slice(curLen);
        }
      }
    }

    // ── Drag-to-reorder (HTML5 drag API) ──
    _dropLine = document.createElement('div');
    _dropLine.style.cssText = 'height:3px;background:#2627E0;border-radius:2px;pointer-events:none;display:none;margin:1px 0;box-shadow:0 0 6px rgba(38,39,224,.5)';
    document.body.appendChild(_dropLine);

    document.addEventListener('dragstart', function (e) {
      if (e.target !== _dragEl) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '1');
      setTimeout(function () { if (_dragEl) _dragEl.classList.add('nl-drag-ghost'); }, 0);
      _dropLine.style.display = '';
    });

    document.addEventListener('dragover', function (e) {
      if (!_dragEl) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      var t = e.target;
      while (t && t !== document.body && t === _dragEl) t = t.parentNode;
      if (t && t !== _dragEl && !_dragEl.contains(t)) {
        if (_insideTarget) _insideTarget.removeAttribute('data-nl-drop-inside');
        var rect = t.getBoundingClientRect();
        var zoneTop = rect.top + rect.height * 0.25;
        var zoneBottom = rect.top + rect.height * 0.75;
        if (e.clientY >= zoneTop && e.clientY <= zoneBottom && t !== document.body) {
          _insideTarget = t;
          t.setAttribute('data-nl-drop-inside', '1');
          _dropLine.style.display = 'none';
        } else {
          _insideTarget = null;
          _dropLine.style.display = '';
          if (e.clientY < rect.top + rect.height / 2) t.parentNode.insertBefore(_dropLine, t);
          else t.parentNode.insertBefore(_dropLine, t.nextSibling);
        }
      }
    });

    document.addEventListener('drop', function (e) {
      if (!_dragEl) return;
      e.preventDefault();
      if (_insideTarget && _insideTarget !== _dragEl && !_dragEl.contains(_insideTarget)) {
        _insideTarget.appendChild(_dragEl);
      } else if (_dropLine.parentNode) {
        _dropLine.parentNode.insertBefore(_dragEl, _dropLine);
      }
      if (_insideTarget) _insideTarget.removeAttribute('data-nl-drop-inside');
      _insideTarget = null;
      _dragEl.classList.remove('nl-drag-ghost');
      _dragEl.removeAttribute('draggable');
      _dragEl = null; _dropLine.style.display = 'none';
      reportHeight(); post('moved', {});
    });

    document.addEventListener('dragend', function () {
      if (_dragEl) { _dragEl.classList.remove('nl-drag-ghost'); _dragEl.removeAttribute('draggable'); _dragEl = null; }
      if (_insideTarget) _insideTarget.removeAttribute('data-nl-drop-inside');
      _insideTarget = null;
      _dropLine.style.display = 'none';
    });

    // ── Event listeners ──
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t === document.body || t === document.documentElement) { stopEdit(); doSelect(null); return; }
      if (_edEl && _edEl.contains(t)) return;
      if (_edEl && !_edEl.contains(t)) stopEdit();
      doSelect(t);
    }, true);

    document.addEventListener('dblclick', function (e) {
      var t = e.target;
      if (!t || t === document.body) return;
      if (t.getAttribute('data-nl-lock') === '1') return;
      e.preventDefault(); doSelect(t); startEdit(t);
    }, true);

    document.addEventListener('mousemove', function (e) {
      var t = e.target;
      if (_hoverEl && _hoverEl !== _sel) _hoverEl.removeAttribute('data-nl-hover');
      if (t && t !== document.body && t !== _sel) { t.setAttribute('data-nl-hover', '1'); _hoverEl = t; }
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (_edEl) stopEdit(); else doSelect(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && _sel && !_edEl &&
          document.activeElement === document.body) { e.preventDefault(); doDelete(); }
    });

    document.addEventListener('input', function () { if (_sel) post('update', getProps(_sel)); });

    // ── Auto height reporting ──
    function reportHeight() {
      var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight);
      post('height', { h: h });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { reportHeight(); }).observe(document.body);
    window.addEventListener('load', reportHeight);
    setTimeout(reportHeight, 300); setTimeout(reportHeight, 1200); setTimeout(reportHeight, 3000);

    // ── Message handler (commands from parent) ──
    window.addEventListener('message', function (e) {
      var d = e.data; if (!d || !d._nlEd) return;
      switch (d.cmd) {
        case 'color':    if (_sel) { _sel.style.color = d.v; post('select', getProps(_sel)); } break;
        case 'bg':       if (_sel) { _sel.style.backgroundColor = d.v || ''; post('select', getProps(_sel)); } break;
        case 'size':     if (_sel) { _sel.style.fontSize = d.v + 'px'; post('select', getProps(_sel)); } break;
        case 'bold':     if (_sel) { _sel.style.fontWeight = (_sel.style.fontWeight === 'bold' || _sel.style.fontWeight === '700') ? '' : 'bold'; post('select', getProps(_sel)); } break;
        case 'italic':   if (_sel) { _sel.style.fontStyle = _sel.style.fontStyle === 'italic' ? '' : 'italic'; post('select', getProps(_sel)); } break;
        case 'underline':if (_sel) { var td = _sel.style.textDecoration || ''; _sel.style.textDecoration = td.indexOf('underline') !== -1 ? td.replace('underline', '').trim() : (td ? td + ' underline' : 'underline'); post('select', getProps(_sel)); } break;
        case 'align':    if (_sel) { _sel.style.textAlign = d.v; post('select', getProps(_sel)); } break;
        case 'text':     if (_sel) { setTextPreservingInlineMarkup(_sel, d.v); post('select', getProps(_sel)); reportHeight(); } break;
        case 'width':    if (_sel) { _sel.style.width = d.v ? d.v + 'px' : ''; post('select', getProps(_sel)); reportHeight(); } break;
        case 'padding':  if (_sel) { _sel.style.padding = d.v ? d.v + 'px' : ''; post('select', getProps(_sel)); reportHeight(); } break;
        case 'delete':   doDelete(); break;
        case 'moveUp':   doMove('up'); break;
        case 'moveDown': doMove('down'); break;
        case 'duplicate': doDuplicate(); break;
        case 'lockToggle': doLockToggle(); break;
        case 'addEl':    doAddEl(d.v); break;
        case 'addSec':   doAddSec(d.v); break;
        case 'preset':
          if (_sel) {
            if (d.v === 'heading') { _sel.style.fontFamily = "'DM Serif Display', Georgia, serif"; _sel.style.fontWeight = '700'; _sel.style.fontSize = '28px'; _sel.style.lineHeight = '1.2'; }
            if (d.v === 'body') { _sel.style.fontFamily = "'DM Sans', sans-serif"; _sel.style.fontWeight = '400'; _sel.style.fontSize = '14px'; _sel.style.lineHeight = '1.6'; _sel.style.color = '#333333'; }
            if (d.v === 'cta') { _sel.style.background = 'linear-gradient(135deg,#0001A0,#000180)'; _sel.style.color = '#ffffff'; _sel.style.padding = '10px 20px'; _sel.style.borderRadius = '6px'; _sel.style.display = 'inline-block'; _sel.style.fontWeight = '700'; }
            if (d.v === 'accent') { _sel.style.backgroundColor = '#FEF3E0'; _sel.style.borderLeft = '4px solid #2627E0'; _sel.style.padding = '14px'; _sel.style.borderRadius = '4px'; }
            post('select', getProps(_sel));
          }
          break;
        case 'enableDrag': if (_sel) { _dragEl = _sel; _sel.setAttribute('draggable', 'true'); post('dragReady', {}); } break;
        case 'deselect': stopEdit(); doSelect(null); break;
        case 'getDomPath': {
          if (!_sel || _sel === document.body) { post('domPath', { path: null, relPath: null }); break; }
          var dp = computeDomPathForEl(_sel);
          if (dp.locked) { post('domPath', { path: null, relPath: null, locked: true }); break; }
          post('domPath', { path: dp.path, relPath: dp.relPath });
          break;
        }
        case 'getCleanHtml': {
          var sels = document.querySelectorAll('[data-nl-sel]');
          sels.forEach(function (el) { el.removeAttribute('data-nl-sel'); });
          var savedEdEl = _edEl;
          if (savedEdEl) { savedEdEl.removeAttribute('contenteditable'); savedEdEl.style.cursor = ''; }
          document.querySelectorAll('[style*="cursor: text"]').forEach(function (el) { el.style.cursor = ''; });
          document.querySelectorAll('#nl-qr canvas').forEach(function (el) { el.remove(); });
          post('cleanHtml', { html: document.body.innerHTML });
          sels.forEach(function (el) { el.setAttribute('data-nl-sel', '1'); });
          if (savedEdEl) { savedEdEl.contentEditable = 'true'; savedEdEl.style.cursor = 'text'; }
          break;
        }
      }
    });

    post('ready'); reportHeight();
  };

  /* ────────────────────────────────────────────────────────
     EDITOR STATE
     ──────────────────────────────────────────────────────── */
  let _opts = null;
  let _undoStack = [], _redoStack = [];
  let _dirty = false, _selectedProps = null;
  let _undoTimer = null, _cleanResolve = null, _domPathResolve = null;

  /* ────────────────────────────────────────────────────────
     CORE HELPERS
     ──────────────────────────────────────────────────────── */
  function _ifrm() { return document.getElementById('nl-ed-iframe'); }

  function _post(cmd, v) {
    const f = _ifrm();
    if (f && f.contentWindow) f.contentWindow.postMessage({ _nlEd: true, cmd, v }, '*');
  }

  function _iframeHtml() {
    try { return _ifrm()?.contentDocument?.body?.innerHTML || ''; } catch (e) { return ''; }
  }

  function _iframeCleanHtml() {
    return new Promise(resolve => {
      _cleanResolve = resolve;
      _post('getCleanHtml', null);
      setTimeout(() => { if (_cleanResolve) { _cleanResolve(_iframeHtml()); _cleanResolve = null; } }, 600);
    });
  }

  function _getSelectedBodyChildPath() {
    return new Promise(resolve => {
      _domPathResolve = resolve;
      _post('getDomPath', null);
      setTimeout(() => {
        if (_domPathResolve) {
          _domPathResolve({ path: null, relPath: null });
          _domPathResolve = null;
        }
      }, 550);
    });
  }

  function _reloadIframeFromHtmlCss(html, css) {
    const f = _ifrm();
    if (!f || !_opts) return;
    _undoStack = [];
    _redoStack = [];
    f.style.height = '800px';
    f.srcdoc = _buildSrcdoc(html || '', css || '', _opts.langId || 'en', _opts.portalUrl);
    f.onload = function () { _buildNav(f); _selectedProps = null; _showIdle(); _status('Ready'); };
  }

  async function deleteSelectedInAllLanguages() {
    if (!_opts) return;
    _status('Reading selection...');
    const sel = await _getSelectedBodyChildPath();
    if (sel.locked) { _status('Element is locked'); return; }
    if (!sel.path || !sel.path.length) { _status('Select an element first'); return; }
    if (!confirm('Remove this block from every language version? This cannot be undone.')) return;
    let updated = null;
    if (typeof _opts.onDeleteInAllLanguages === 'function') {
      try {
        updated = await _opts.onDeleteInAllLanguages({ path: sel.path, relPath: sel.relPath });
      } catch (_e) {
        updated = null;
      }
    }
    if (updated && updated.ok && typeof updated.html === 'string') {
      _reloadIframeFromHtmlCss(updated.html, updated.css || '');
      _dirty = false;
      const n = updated.updated;
      _status(typeof n === 'number' && n > 0 ? `Removed from ${n} language(s)` : 'Removed from all languages');
      return;
    }
    _status('Could not remove from all languages');
  }

  async function _syncTextToOtherLanguages() {
    if (!_opts) return;
    _status('Saving\u2026');
    const saved = await saveToWorkspace();
    if (!saved) return;
    _status('Resolving block\u2026');
    const sel = await _getSelectedBodyChildPath();
    if (sel.locked) {
      _status('Element is locked');
      if (window.App?.Utils?.showToast) App.Utils.showToast('Element is locked.', true);
      return;
    }
    if (!sel.path?.length && !sel.relPath?.length) {
      _status('Select a block inside the template');
      if (window.App?.Utils?.showToast) App.Utils.showToast('Select a block inside the newsletter template.', true);
      return;
    }
    const ta = document.getElementById('prop-text-area');
    const text = String(ta?.value || '').trim();
    if (!text) {
      _status('No text to translate');
      if (window.App?.Utils?.showToast) App.Utils.showToast('No text to translate.', true);
      return;
    }
    if (!window.App?.UI?.syncNewsletterElementTextToAllLanguages) {
      _status('Sync unavailable');
      return;
    }
    _status('Translating to other languages\u2026');
    try {
      const r = await App.UI.syncNewsletterElementTextToAllLanguages({
        path: sel.path,
        relPath: sel.relPath,
        text,
        sourceLangId: _opts.langId || 'en'
      });
      _status(`Updated ${r.updated} language(s)`);
      if (window.App?.Utils?.showToast) {
        App.Utils.showToast(
          r.failed
            ? `Other languages: ${r.updated} updated, ${r.failed} could not match structure.`
            : `Updated ${r.updated} other language version(s) with translated text.`
        );
      }
    } catch (err) {
      const msg = err?.message || 'Sync failed';
      _status('Sync failed');
      if (window.App?.Utils?.showToast) App.Utils.showToast(msg, true);
    }
  }

  async function flushOpenEditorToWorkspace() {
    const modal = document.getElementById('editor-modal');
    if (!modal || !modal.classList.contains('active') || !_opts) return;
    await saveToWorkspace();
  }

  function _status(txt) {
    const el = document.getElementById('editor-status');
    if (el) el.textContent = txt;
  }

  function _hexNorm(s) {
    if (!s || s === 'transparent') return '#000000';
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
    return '#000000';
  }

  function _showIdle() {
    const i = document.getElementById('ed-panel-idle'), p = document.getElementById('ed-panel-props');
    if (i) i.style.display = ''; if (p) p.style.display = 'none';
    const fb = document.getElementById('ed-floatbar');
    if (fb) fb.classList.remove('active');
  }

  function _updatePanel(props) {
    if (!props || !props.tag) { _showIdle(); return; }
    const i = document.getElementById('ed-panel-idle'), p = document.getElementById('ed-panel-props');
    if (i) i.style.display = 'none'; if (p) p.style.display = '';
    const tag = document.getElementById('ed-el-tag'), prev = document.getElementById('ed-el-preview');
    if (tag) tag.textContent = props.tag || '—';
    if (prev) prev.textContent = props.text || '—';
    const pCol = document.getElementById('prop-color'), pColH = document.getElementById('prop-color-hex');
    if (props.color) {
      if (pCol) { try { pCol.value = _hexNorm(props.color); } catch(e){} }
      if (pColH) pColH.value = props.color;
    }
    const pBg = document.getElementById('prop-bg'), pBgH = document.getElementById('prop-bg-hex');
    if (props.bgColor) { if (pBg) { try { pBg.value = _hexNorm(props.bgColor); } catch(e){} } }
    if (pBgH) pBgH.value = props.bgColor || '';
    const sz = parseInt(props.fontSize) || 14;
    const pSz = document.getElementById('prop-size'), pSzR = document.getElementById('prop-size-range');
    if (pSz) pSz.value = sz; if (pSzR) pSzR.value = Math.min(sz, 80);
    const pW = document.getElementById('prop-width'), pPad = document.getElementById('prop-padding');
    if (pW) pW.value = props.width || '';
    if (pPad) pPad.value = props.padding || '';
    const fB = document.getElementById('fmt-bold'), fI = document.getElementById('fmt-italic'), fU = document.getElementById('fmt-underline');
    if (fB) fB.classList.toggle('on', !!props.bold);
    if (fI) fI.classList.toggle('on', !!props.italic);
    if (fU) fU.classList.toggle('on', !!props.underline);
    const pTxt = document.getElementById('prop-text-area');
    if (pTxt) pTxt.value = (props.textFull != null ? props.textFull : props.text) || '';
    const syncBtn = document.getElementById('ed-text-sync-btn');
    if (syncBtn) {
      const full = (props.textFull != null ? props.textFull : props.text) || '';
      syncBtn.disabled = props.locked || !String(full).trim();
    }
    const fb = document.getElementById('ed-floatbar');
    if (fb && Number.isFinite(props.rectTop) && Number.isFinite(props.rectLeft)) {
      const ifr = _ifrm();
      const r = ifr?.getBoundingClientRect();
      if (r) {
        const top = Math.max(70, r.top + props.rectTop - 38);
        const left = Math.max(10, Math.min(window.innerWidth - 220, r.left + props.rectLeft + (props.rectWidth || 0) / 2 - 80));
        fb.style.top = `${top}px`;
        fb.style.left = `${left}px`;
        fb.classList.add('active');
      }
    }
  }

  function _pushUndo() {
    const h = _iframeHtml(); if (!h) return;
    _undoStack.push(h); _redoStack = [];
    if (_undoStack.length > 40) _undoStack.shift();
  }

  function _debouncedUndo() {
    clearTimeout(_undoTimer);
    _undoTimer = setTimeout(_pushUndo, 900);
  }

  function _buildNav(f) {
    const list = document.getElementById('ed-nav-list'); if (!list) return;
    try {
      const doc = f.contentDocument; if (!doc || !doc.body) return;
      const seen = new Set(); let html = '';
      // Email-safe templates use data-nl-nav attributes directly (no CSS classes allowed)
      doc.body.querySelectorAll('[data-nl-nav]').forEach(el => {
        const k = el.getAttribute('data-nl-nav');
        if (!k || seen.has(k)) return; seen.add(k);
        html += `<div class="ed-nav-item" onclick="App.Editor._scrollTo('${k.replace(/'/g, "\\'")}')">${k.replace('nl-', '').replace(/-/g, ' ')}</div>`;
      });
      // Legacy screen-only templates use nl-* CSS classes
      doc.body.querySelectorAll('[class*="nl-"]').forEach(el => {
        const k = Array.from(el.classList).find(c => c.startsWith('nl-'));
        if (!k || seen.has(k)) return; seen.add(k);
        el.setAttribute('data-nl-nav', k);
        html += `<div class="ed-nav-item" onclick="App.Editor._scrollTo('${k.replace(/'/g, "\\'")}')">${k.replace('nl-', '').replace(/-/g, ' ')}</div>`;
      });
      list.innerHTML = html || '<div class="ed-nav-item" style="opacity:.35;cursor:default;font-size:.65rem;padding:.6rem .72rem">(scroll to navigate)</div>';
    } catch(e) { list.innerHTML = ''; }
  }

  function _buildSrcdoc(html, css, langId, portalUrl) {
    const fonts = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,700;1,400&family=DM+Serif+Display:ital@0;1&display=swap';
    const inject = `<style data-nl-ed-inject>*{box-sizing:border-box}body{margin:0;padding:24px;background:#B8C3D4;font-family:'DM Sans',sans-serif;overflow-x:hidden}body>div:first-child{max-width:100%!important;overflow-x:hidden}a[href^="mailto:"]{word-break:break-all!important;white-space:normal!important;max-width:100%!important;flex-shrink:1!important}</style>`;
    const qr = `(function(){try{var Q=window.QRCode||(window.parent&&window.parent.QRCode);var el=document.getElementById('nl-qr');if(!el||!Q)return;var holder=document.createElement('div');holder.style.cssText='position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden';document.body.appendChild(holder);try{new Q(holder,{text:${JSON.stringify(portalUrl || 'https://security.example.com')},width:144,height:144,colorDark:'#000',colorLight:'#fff',correctLevel:(Q.CorrectLevel||{H:2}).H});var c=holder.querySelector('canvas');var uri=c?c.toDataURL('image/png'):(holder.querySelector('img')&&holder.querySelector('img').getAttribute('src'))||'';if(uri){el.innerHTML='';var im=document.createElement('img');im.setAttribute('src',uri);im.setAttribute('alt','QR code');im.setAttribute('width','144');im.setAttribute('height','144');im.style.display='block';el.appendChild(im);}}finally{holder.remove();}}catch(e){}})();`;
    const script = '(' + _nlEdFn.toString() + ')();';
    return `<!DOCTYPE html><html lang="${langId}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="${fonts}" rel="stylesheet">${css ? '<style>' + css + '</style>' : ''}${inject}</head><body>${html}<script>${qr}<\/script><script>${script}<\/script></body></html>`;
  }

  /* ────────────────────────────────────────────────────────
     MESSAGE HANDLER
     ──────────────────────────────────────────────────────── */
  function _msgHandler(e) {
    const d = e.data; if (!d || !d._nlEd) return;
    switch (d.type) {
      case 'ready':    _status('Ready'); break;
      case 'height': { const f = _ifrm(); if (f && d.h > 200) f.style.height = Math.ceil(d.h + 16) + 'px'; break; }
      case 'cleanHtml': if (_cleanResolve) { _cleanResolve(d.html || ''); _cleanResolve = null; } break;
      case 'domPath':
        if (_domPathResolve) {
          _domPathResolve({
            path: Array.isArray(d.path) ? d.path : null,
            relPath: Array.isArray(d.relPath) ? d.relPath : null,
            locked: !!d.locked
          });
          _domPathResolve = null;
        }
        break;
      case 'select':   _selectedProps = d; _updatePanel(d); break;
      case 'deselect': _selectedProps = null; _showIdle(); _status('Ready'); break;
      case 'editDone':
        _dirty = true;
        _status('Unsaved changes');
        clearTimeout(_undoTimer);
        _pushUndo();
        if (d.textFull && String(d.textFull).trim() && !d.locked &&
            ((Array.isArray(d.path) && d.path.length) || (Array.isArray(d.relPath) && d.relPath.length))) {
          _status('Tip: sync other languages with the button in the right panel');
        }
        break;
      case 'update':   _dirty = true; _status('Unsaved changes'); if (d.tag) { _selectedProps = d; _updatePanel(d); } _debouncedUndo(); break;
      case 'editing':  _status('Editing text\u2026'); break;
      case 'deleted':  _dirty = true; _status('Unsaved changes'); _selectedProps = null; _showIdle(); _pushUndo(); break;
      case 'moved':    _dirty = true; _status('Unsaved changes'); _pushUndo(); break;
      case 'added':    _dirty = true; _status('Unsaved changes'); _pushUndo(); break;
      case 'dragReady': _status('Drag the element in the canvas \u2014 drop to reorder'); break;
      case 'locked': _status('Element is locked'); break;
    }
  }

  /* ────────────────────────────────────────────────────────
     EDITOR ACTIONS (called from onclick in injected HTML)
     ──────────────────────────────────────────────────────── */
  function _prop(cmd, val) { if (!_selectedProps) return; _pushUndo(); _post(cmd, val); _dirty = true; _status('Unsaved changes'); }

  function _propHex(cmd, val) {
    if (!val || !/^#[0-9a-fA-F]{3,8}$/.test(val)) return;
    _prop(cmd, val);
  }

  function _propSize(val) {
    const sz = parseInt(val); if (!sz || sz < 4) return;
    const ps = document.getElementById('prop-size'), psr = document.getElementById('prop-size-range');
    if (ps) ps.value = sz; if (psr) psr.value = Math.min(sz, 80);
    if (!_selectedProps) return;
    _pushUndo(); _post('size', sz); _dirty = true; _status('Unsaved changes');
  }

  function _toggle(cmd) { if (!_selectedProps) return; _pushUndo(); _post(cmd, null); _dirty = true; _status('Unsaved changes'); }
  function _setText(val) { if (!_selectedProps) return; _post('text', val); _dirty = true; _status('Unsaved changes'); }
  function _deselect() { _post('deselect', null); _selectedProps = null; _showIdle(); }
  function _delete() { _post('delete', null); }
  function _moveUp() { _post('moveUp', null); }
  function _moveDown() { _post('moveDown', null); }
  function _startDrag() { _post('enableDrag', null); }
  function _duplicate() { _post('duplicate', null); }
  function _lockToggle() { _post('lockToggle', null); }
  function _applyPreset(presetId) { _pushUndo(); _post('preset', presetId); _dirty = true; _status('Unsaved changes'); }

  function _setWidth(val) {
    if (!_selectedProps) return;
    _pushUndo(); _post('width', parseInt(val) || 0); _dirty = true; _status('Unsaved changes');
  }

  function _setPadding(val) {
    if (!_selectedProps) return;
    _pushUndo(); _post('padding', parseInt(val) || 0); _dirty = true; _status('Unsaved changes');
  }

  function _addEl(idx) { const p = ELEMS[idx]; if (!p) return; _post('addEl', p.html); }
  function _addSec(idx) { const p = SECTIONS[idx]; if (!p) return; _post('addSec', p.html); }

  function _scrollTo(key) {
    const f = _ifrm(); if (!f || !f.contentDocument) return;
    try { const el = f.contentDocument.querySelector('[data-nl-nav="' + key + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){}
  }

  function _device(btn, w) {
    document.querySelectorAll('.ed-dpill').forEach(b => b.classList.toggle('active', b === btn));
    const frame = document.getElementById('ed-canvas-frame'); if (frame) frame.style.maxWidth = w || '100%';
    _status({ '': 'Desktop', '700px': 'Email 700px', '390px': 'Mobile 390px' }[w] ?? w);
  }

  function _navTab(btn, pane) {
    document.querySelectorAll('.ed-nav-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.ed-nav-pane').forEach(p => p.classList.toggle('active', p.id === 'ed-nav-' + pane));
  }

  function _undo() {
    if (!_undoStack.length) return;
    const cur = _iframeHtml(); if (cur) _redoStack.push(cur);
    const prev = _undoStack.pop(); const f = _ifrm();
    if (f && f.contentDocument && f.contentDocument.body) {
      f.contentDocument.body.innerHTML = prev; _dirty = true; _status('Undo applied'); _selectedProps = null; _showIdle();
    }
  }

  function _redo() {
    if (!_redoStack.length) return;
    const cur = _iframeHtml(); if (cur) _undoStack.push(cur);
    const next = _redoStack.pop(); const f = _ifrm();
    if (f && f.contentDocument && f.contentDocument.body) {
      f.contentDocument.body.innerHTML = next; _dirty = true; _status('Redo applied'); _selectedProps = null; _showIdle();
    }
  }

  function _reset() {
    if (!_opts || !_opts.onGetResetData) return;
    const data = _opts.onGetResetData();
    if (!data) return;
    const f = _ifrm(); if (!f) return;
    _undoStack = []; _redoStack = []; _dirty = false;
    f.style.height = '800px';
    f.srcdoc = _buildSrcdoc(data.html, data.css, _opts.langId, _opts.portalUrl);
    _showIdle(); _status('Reset to base');
  }

  async function _preview() {
    const html = await _iframeCleanHtml(); if (!html) return;
    let css = '';
    try { const f = _ifrm(); if (f && f.contentDocument && f.contentDocument.head) f.contentDocument.head.querySelectorAll('style:not([data-nl-ed-inject])').forEach(st => { css += (st.textContent || '') + '\n'; }); } catch(e){}
    const full = `<!DOCTYPE html><html lang="${_opts.langId}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,700;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet"><style>*{box-sizing:border-box}body{margin:0;background:#B8C3D4;padding:20px}a[href^="mailto:"]{word-break:break-all;white-space:normal;max-width:100%}</style>${css ? '<style>' + css.trim() + '</style>' : ''}</head><body>${html}</body></html>`;
    const url = URL.createObjectURL(new Blob([full], { type: 'text/html;charset=utf-8' }));
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) alert('Allow pop-ups to open the preview tab.');
    setTimeout(() => URL.revokeObjectURL(url), 180000);
  }

  /* ────────────────────────────────────────────────────────
     PUBLIC API
     ──────────────────────────────────────────────────────── */
  function open(opts) {
    _opts = opts;
    const modal = document.getElementById('editor-modal'); if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    const lbl = document.getElementById('editor-lang-label');
    if (lbl) lbl.textContent = 'Newsletter Studio \u2014 ' + (opts.langLabel || opts.langId || '');
    _undoStack = []; _redoStack = []; _dirty = false; _selectedProps = null;
    _showIdle(); _status('Loading\u2026');
    window.removeEventListener('message', _msgHandler);
    window.addEventListener('message', _msgHandler);
    const f = _ifrm(); if (!f) return;
    f.style.height = '800px';
    f.srcdoc = _buildSrcdoc(opts.html || '', opts.css || '', opts.langId || 'en', opts.portalUrl);
    const frame = document.getElementById('ed-canvas-frame');
    if (frame) frame.style.maxWidth = '700px';
    document.querySelectorAll('.ed-dpill').forEach(b => b.classList.toggle('active', b.getAttribute('data-w') === '700px'));
    f.onload = function () { _buildNav(f); _status('Ready'); };
  }

  async function _extractIframeVariant() {
    const html = await _iframeCleanHtml();
    if (!html) return null;
    let css = '';
    try {
      const f = _ifrm();
      if (f && f.contentDocument && f.contentDocument.head) {
        f.contentDocument.head.querySelectorAll('style:not([data-nl-ed-inject])').forEach(st => { css += (st.textContent || '') + '\n'; });
      }
    } catch (e) {}
    return { html, css: css.trim() };
  }

  /** Persist iframe HTML/CSS to the workspace for the open language (does not close the editor). */
  async function saveToWorkspace() {
    if (!_opts) return false;
    _status('Saving\u2026');
    const v = await _extractIframeVariant();
    if (!v) { _status('Error \u2014 no content'); return false; }
    if (_opts.onSave) _opts.onSave({ html: v.html, css: v.css, langId: _opts.langId });
    _dirty = false; _status('Saved');
    return true;
  }

  /** Sync canvas to workspace, then persist a versioned project snapshot (IndexedDB via App.UI). */
  async function saveToWorkspaceAndProject() {
    const ok = await saveToWorkspace();
    if (!ok) return;
    if (!window.App?.UI || typeof App.UI.saveProjectVersion !== 'function') return;
    _status('Saving project\u2026');
    const project = await App.UI.saveProjectVersion();
    const modal = document.getElementById('editor-modal');
    if (modal && modal.classList.contains('active')) {
      _status(project ? 'Saved & stored' : 'Workspace saved');
    }
  }

  async function downloadCurrentLanguage() {
    const ok = await saveToWorkspace();
    if (!ok) return;
    if (window.App && App.UI && typeof App.UI.downloadCurrentHTML === 'function') App.UI.downloadCurrentHTML();
  }

  async function downloadAllLanguages() {
    const ok = await saveToWorkspace();
    if (!ok) return;
    if (window.App && App.UI && typeof App.UI.downloadAllHTML === 'function') await App.UI.downloadAllHTML();
  }

  /** @deprecated Use saveToWorkspace; kept for compatibility (no longer closes the modal). */
  async function save() {
    return saveToWorkspace();
  }

  function close() {
    const modal = document.getElementById('editor-modal');
    if (modal && modal.classList.contains('active') && _dirty) {
      if (!confirm('You have unsaved changes. Close without saving?')) return;
    }
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
    window.removeEventListener('message', _msgHandler);
    const fb = document.getElementById('ed-floatbar');
    if (fb) fb.classList.remove('active');
    _selectedProps = null; _showIdle();
    if (_opts && _opts.onClose) _opts.onClose();
    _opts = null;
  }

  /* ────────────────────────────────────────────────────────
     INIT — inject CSS + HTML once when the script loads
     ──────────────────────────────────────────────────────── */
  (function _init() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = _buildHtml();
    document.body.appendChild(wrap.firstElementChild);
  })();

  return {
    open, save, saveToWorkspace, saveToWorkspaceAndProject, downloadCurrentLanguage, downloadAllLanguages, close,
    deleteSelectedInAllLanguages, flushOpenEditorToWorkspace,
    _syncTextToOtherLanguages,
    // Internal actions bound by onclick in injected HTML
    _prop, _propHex, _propSize, _toggle, _setText, _deselect,
    _delete, _moveUp, _moveDown, _startDrag, _duplicate, _lockToggle, _applyPreset,
    _setWidth, _setPadding,
    _addEl, _addSec,
    _device, _navTab, _scrollTo,
    _undo, _redo, _reset, _preview
  };
})();
