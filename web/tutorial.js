/* On-demand guides shared by the scanner, studio, and home page. */
(() => {
  'use strict';
  if (window.openOptiframeTutorial) return;
  // Higgsfield gpt_image_2_5, job 33f53d52-678f-4cfa-abe3-b2f032d35564.
  // Editorial illustration only; measured contours and assembly instructions remain separate.
  const frameGuidePhoto = 'https://d8j0ntlcm91z4.cloudfront.net/user_3KA92iU6u67O0dIGe7uHUkaeji3/hf_20261004_020137_33f53d52-678f-4cfa-abe3-b2f032d35564.png';

  // Captured contours from gpu/fixtures/scanned-lens-outlines.json, rounded to 0.01.
  const leftContour = 'M-29.18,-12.68 L-29.94,-10.86 L-29.96,-10.07 L-30.2,-9.81 L-30.23,-8.5 L-30.47,-8.25 L-30.53,-4.85 L-30.3,-4.58 L-30.33,-2.5 L-30.1,-2.24 L-29.89,-0.16 L-29.2,1.41 L-29.21,1.93 L-28.98,2.19 L-28.76,3.49 L-28.3,4.27 L-28.31,4.79 L-26.91,7.13 L-26.7,8.16 L-26.23,8.69 L-26.24,9.2 L-25.31,10.25 L-24.39,12.06 L-22.06,14.67 L-21.83,14.68 L-19.73,16.77 L-15.51,19.17 L-15.03,19.19 L-13.39,20 L-12.43,20.03 L-12.2,20.29 L-11.01,20.33 L-10.78,20.59 L-9.59,20.63 L-9.36,20.89 L-7.45,20.96 L-7.22,21.22 L-5.07,21.29 L-4.84,21.55 L3.78,21.84 L4.03,21.6 L5.95,21.67 L6.2,21.42 L8.61,21.5 L8.86,21.26 L11.03,21.33 L11.28,21.09 L13.69,21.17 L13.94,20.93 L14.91,20.96 L15.9,20.49 L17.35,20.54 L18.35,20.06 L19.07,20.09 L19.59,19.6 L20.81,19.39 L21.33,18.9 L21.81,18.91 L23.11,17.68 L23.35,17.69 L25.72,14.96 L25.75,14.45 L26.53,13.7 L26.58,12.94 L27.1,12.44 L27.14,11.92 L27.68,11.17 L27.71,10.65 L28.27,9.64 L28.32,8.86 L28.58,8.61 L28.64,7.84 L28.9,7.59 L28.95,6.81 L29.21,6.56 L29.65,3.71 L29.92,3.45 L30.22,-0.99 L30.48,-1.25 L30.53,-2.04 L30.3,-2.31 L30.52,-5.48 L30.29,-5.75 L30.2,-8.14 L29.97,-8.41 L29.61,-10.56 L28.51,-12.73 L25.94,-15.48 L24.49,-16.32 L24.02,-16.88 L23.52,-16.89 L21.84,-18.01 L21.34,-18.02 L18.91,-19.17 L15.94,-19.78 L15.71,-20.06 L14.71,-20.08 L14.47,-20.36 L12.73,-20.4 L12.49,-20.68 L9.77,-21.02 L9.53,-21.29 L9.02,-21.04 L8.78,-21.31 L6.54,-21.37 L6.31,-21.64 L-1.64,-21.84 L-1.9,-21.58 L-7.11,-21.44 L-7.36,-21.18 L-8.6,-21.21 L-8.86,-20.95 L-10.58,-20.99 L-10.84,-20.73 L-12.07,-20.76 L-12.33,-20.5 L-13.31,-20.52 L-13.57,-20.26 L-14.8,-20.29 L-15.05,-20.03 L-16.78,-19.81 L-17.78,-19.29 L-18.52,-19.31 L-18.77,-19.05 L-21.49,-18.32 L-24.21,-17.06 L-24.71,-16.54 L-25.2,-16.55 L-25.95,-15.77 L-27.19,-15.01 Z';
  const rightContour = 'M-16.1,-16.02 L-16.11,-15.81 L-16.49,-15.61 L-18.63,-13.17 L-19.79,-11.54 L-20.37,-10.33 L-20.94,-9.73 L-21.14,-8.92 L-21.71,-8.12 L-21.72,-7.71 L-22.48,-6.32 L-22.68,-5.32 L-23.25,-4.33 L-23.26,-3.73 L-23.64,-2.94 L-23.85,-0.37 L-24.04,-0.18 L-23.86,0.22 L-24.04,0.41 L-24.05,1.2 L-23.87,1.4 L-24.06,1.59 L-24.07,2.38 L-23.89,2.58 L-24.08,3.35 L-23.9,3.55 L-23.91,4.72 L-23.73,4.92 L-23.74,5.89 L-23.38,6.48 L-23.39,7.06 L-22.68,8.23 L-22.68,8.61 L-22.15,9.01 L-21.8,10.17 L-20.92,11.53 L-18.43,14.08 L-17.54,14.67 L-17.37,15.06 L-16.13,15.85 L-15.6,16.43 L-15.24,16.44 L-14.71,17.02 L-14.17,17.04 L-14,17.42 L-12.58,18.22 L-12.22,18.23 L-10.63,19.22 L-9.55,19.45 L-9.21,19.83 L-8.32,20.23 L-7.78,20.25 L-7.07,20.65 L-6.17,20.68 L-4.74,21.29 L-3.3,21.34 L-2.23,21.76 L1.57,22.08 L1.74,22.27 L1.93,22.09 L2.66,22.12 L2.83,22.31 L3.75,22.16 L4.09,22.54 L4.66,22.19 L5.2,22.4 L5.76,22.23 L8.5,22.33 L8.69,22.15 L11.09,22.05 L11.85,21.71 L12.4,21.73 L12.98,21.37 L13.53,21.39 L15.23,20.89 L15.63,20.53 L17.56,19.65 L17.57,19.46 L18.34,19.11 L19.17,18.19 L19.74,18.02 L20.18,17.27 L20.99,16.53 L21.03,16.15 L22.1,14.65 L22.17,13.87 L22.8,13.12 L22.91,11.96 L23.11,11.77 L23.24,10.41 L23.44,10.22 L23.57,8.85 L23.39,8.65 L23.6,8.45 L24.03,5.89 L23.85,5.69 L24.07,3.3 L23.9,3.1 L24.02,1.69 L23.85,1.49 L24.08,1.09 L23.9,0.88 L23.91,-1.34 L23.73,-1.55 L23.65,-2.78 L23.12,-3.4 L23.18,-4.02 L21.65,-8.8 L21.11,-9.44 L20.81,-10.49 L19.76,-11.97 L19.44,-12.82 L19.06,-13.04 L17.11,-15.61 L12.66,-19.31 L11.69,-19.54 L10.95,-20.19 L9.62,-20.86 L8.06,-21.1 L6.53,-21.77 L5.36,-21.79 L5.17,-22 L3.03,-22.25 L2.85,-22.47 L-1.83,-22.54 L-2.04,-22.33 L-4.38,-22.16 L-5.17,-21.74 L-5.94,-21.75 L-6.54,-21.34 L-8.49,-20.94 L-10.26,-19.91 L-11.03,-19.71 L-12.02,-18.88 L-12.99,-18.48 L-15.53,-16.22 Z';
  const lens = (side, x, y, scale = 2, extra = '') => `<path class="oft-lens ${extra}" d="${side === 'right' ? rightContour : leftContour}" transform="translate(${x} ${y}) scale(${scale})"/>`;
  const text = (x, y, label, extra = '') => `<text class="oft-diagram-label ${extra}" x="${x}" y="${y}" text-anchor="middle">${label}</text>`;
  const cross = (x, y) => `<path class="oft-accent" d="M${x - 7} ${y}h14 M${x} ${y - 7}v14"/>`;
  const sheet = (withLens = true) => `<rect class="oft-paper" x="59" y="23" width="242" height="187" rx="2"/><path class="oft-grid" d="M80 48H280V188H80Z M100 48V188 M120 48V188 M140 48V188 M160 48V188 M180 48V188 M200 48V188 M220 48V188 M240 48V188 M260 48V188 M80 68H280 M80 88H280 M80 108H280 M80 128H280 M80 148H280 M80 168H280"/>${[[80,48],[280,48],[280,188],[80,188]].map(([x,y],i)=>`<rect fill="#151719" x="${x-6}" y="${y-6}" width="12" height="12"/><circle fill="#fff" cx="${x}" cy="${y}" r="1.6"/>${text(x+(i===0||i===3?-13:13),y+4,String(i+1),'oft-ink')}`).join('')}${withLens ? lens('left',180,118,2,'oft-on-paper') : ''}`;
  const pair = () => `${lens('left',105,116,1.7)}${lens('right',258,116,1.7)}${text(105,187,'LEFT')}${text(258,187,'RIGHT')}`;
  const illustrations = {
    sheet: () => `${sheet(false)}<rect class="oft-paper" x="104" y="77" width="152" height="84" rx="4"/>${text(180,98,'100%','oft-ink oft-scale-label')}<path class="oft-ink-stroke" d="M130 123H230 M130 116V130 M230 116V130"/>${text(180,146,'50 mm','oft-ink')}`,
    place: () => `${sheet()}<path class="oft-accent oft-brackets" d="M65 59V33H91 M269 33H295V59 M295 177V203H269 M91 203H65V177"/>`,
    light: () => `${sheet()}<path class="oft-reflection" d="M151 85L190 151 M164 85L203 151"/><path class="oft-accent" d="M19 86V15H92 M268 15H341V86 M341 153V224H268 M92 224H19V153"/>`,
    confirm: () => `${pair()}<path class="oft-accent" d="M92 48l8 8 16-16 M245 48l8 8 16-16"/>`,
    measure: () => `${lens('left',180,110,2.3)}<path class="oft-accent" d="M110 182H250 M110 176V188 M250 176V188 M277 61V160 M271 61H283 M271 160H283"/><path class="oft-muted-stroke" d="M110 163V172 M250 163V172 M257 61H265 M257 160H265"/>${text(180,205,'CHECK WIDTH')}${text(180,29,'CHECK HEIGHT')}`,
    marks: () => `${lens('left',180,122,2.6)}${cross(164,112)}<path class="oft-accent" d="M180 46V22 m-5 5 5-5 5 5"/><path class="oft-muted-stroke" d="M157 106L101 57H55"/>${text(80,46,'OPTICAL CENTRE')}${text(180,212,'PROVIDER-MARKED TOP + CENTRE')}`,
    fit: () => `${pair()}${cross(110,105)}${cross(252,116)}<path class="oft-muted-stroke" d="M180 35V154"/><path class="oft-accent" d="M110 68H175 M185 68H252 M110 62V74 M252 62V74"/>${text(143,49,'LEFT PD')}${text(219,49,'RIGHT PD')}`,
    preview: () => `<g class="oft-frame-preview">${pair()}<path class="oft-accent" d="M155 100Q180 81 219 100"/>${lens('left',105,116,1.88,'oft-rim')}${lens('right',258,116,1.9,'oft-rim')}<path class="oft-accent" d="M47 101H30V76 M304 101H330V76"/></g>`,
    kit: () => `<rect class="oft-muted-stroke" x="28" y="19" width="304" height="207" rx="3"/>${lens('left',122,77,1.25)}${lens('right',229,77,1.25)}<path class="oft-accent" d="M160 65Q179 51 199 65"/>${lens('left',122,153,1.25)}${lens('right',229,153,1.25)}<path class="oft-accent" d="M48 45v142q0 12 13 12 M312 45v142q0 12-13 12"/>${text(180,211,'FRONT · 2 RETAINERS · 2 TEMPLES')}`,
    slice: () => `<path class="oft-muted-stroke" d="M66 50H294V203H66Z M80 185H280"/><g class="oft-slice-lines"><path class="oft-accent" d="M100 143H260 M100 137H260 M100 131H260 M100 125H260 M100 119H260 M100 113H260"/></g><path class="oft-white-stroke" d="M159 50V75L174 94H186L201 75V50"/>${text(180,173,'mm · 100%')}`,
    assembly: () => `${pair()}<path class="oft-accent" d="M155 100Q180 81 219 100"/><g class="oft-white-stroke"><path d="M90 32h30 M96 32v22h18V32 M242 32h30 M248 32v22h18V32"/></g><path class="oft-muted-stroke" d="M105 57V70 M258 57V70"/>${text(180,219,'CHECK FIT BEFORE WEAR')}`,
  };

  const guides = {
    capture: {
      name: 'Capture guide', done: 'Done',
      steps: [
        ['Print at 100%', 'Turn off “fit to page”. Check that the printed bar measures 50 mm.', 'sheet', 'Print sheet'],
        ['Place one lens', 'Flatten the sheet on a matte surface. Keep the lens inside all four dots.', 'place'],
        ['Keep the rim clear', 'Use soft, even light. Move closer with all four dots visible and reflections off the edge.', 'light'],
        ['Capture each lens', 'Hold still, check the outline, then confirm. Swap lenses; tap “Second lens placed” if asked.', 'confirm'],
        ['Verify the size', 'Compare width and height with a ruler or calipers. Check a separate capture before printing.', 'measure'],
      ],
    },
    printing: {
      name: 'Printing guide', done: 'Done',
      steps: [
        ['Mark the optical centres', 'Ask an eye-care provider to check the prescription and mark each lens’s top and optical centre—not its geometric centre.', 'marks'],
        ['Measure each side', 'Enter each pupil distance and lens edge thickness. Check height offsets, temple length and printer bed size.', 'fit'],
        ['Inspect the frame', 'Rotate the preview. Check seats, retainers and hinges; confirm lens orientation and wearer fit with the provider.', 'preview'],
        ['Download the parts', 'One front, two retainers and two temples. Download separate STLs or the arranged plate.', 'kit'],
        ['Print at actual size', 'Import in millimetres at 100%. Choose your printer and material profile; check orientation and supports.', 'slice'],
        ['Assemble and check', 'Use eight M2 retainer fasteners, two M2 hinge screws and matching nuts. Check lengths, clearances and lens fit. Have the provider verify alignment before wear.', 'assembly'],
      ],
    },
  };

  let dialog, topic = 'capture', step = 0, returnFocus;
  const get = (selector) => dialog.querySelector(selector);
  function render() {
    const guide = guides[topic];
    const [title, description, illustration, link] = guide.steps[step];
    get('.oft-guide-name').textContent = guide.name;
    get('.oft-count').textContent = `${step + 1} / ${guide.steps.length}`;
    get('.oft-title').textContent = title;
    get('.oft-description').textContent = description;
    get('.oft-visual').innerHTML = `<svg viewBox="0 0 360 240" aria-hidden="true" focusable="false">${illustrations[illustration]()}</svg>`;
    if (illustration === 'preview') {
      const visual = get('.oft-visual');
      const diagram = visual.querySelector('svg');
      const photo = document.createElement('img');
      photo.className = 'oft-photo';
      photo.alt = 'Illustrative asymmetric frame with separate lenses and temples; not the patient’s generated frame';
      photo.width = 1024; photo.height = 688;
      photo.decoding = 'async'; photo.hidden = true;
      photo.addEventListener('load', () => { photo.hidden = false; diagram.style.display = 'none'; });
      photo.addEventListener('error', () => photo.remove());
      visual.append(photo);
      photo.src = frameGuidePhoto;
    }
    get('.oft-sheet-link').hidden = !link;
    get('.oft-back').hidden = step === 0;
    get('.oft-next').textContent = step === guide.steps.length - 1 ? guide.done : 'Next';
  }
  function move(delta) {
    const target = step + delta;
    if (target < 0 || target >= guides[topic].steps.length) return;
    step = target;
    render();
    get('.oft-title').focus({ preventScroll: true });
  }
  function create() {
    dialog = document.createElement('dialog');
    dialog.className = 'oft-dialog';
    dialog.setAttribute('aria-labelledby', 'oft-title');
    dialog.setAttribute('aria-describedby', 'oft-description');
    dialog.innerHTML = `<div class="oft-shell">
      <header class="oft-header"><span class="oft-guide-name"></span><span class="oft-count" aria-label="Step progress"></span><button type="button" class="oft-close" aria-label="Close guide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12 M6 18 18 6"/></svg></button></header>
      <div class="oft-visual"></div>
      <div class="oft-copy"><h2 id="oft-title" class="oft-title" tabindex="-1"></h2><p id="oft-description" class="oft-description"></p><a class="oft-sheet-link" href="/calibration-sheet.svg" target="_blank" rel="noopener">Print sheet</a></div>
      <footer class="oft-footer"><div class="oft-actions"><button type="button" class="oft-back">Back</button><button type="button" class="oft-next">Next</button></div></footer>
    </div>`;
    document.body.append(dialog);
    get('.oft-close').addEventListener('click', () => dialog.close());
    get('.oft-back').addEventListener('click', () => move(-1));
    get('.oft-next').addEventListener('click', () => step === guides[topic].steps.length - 1 ? dialog.close() : move(1));
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('oft-guide-open');
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        move(event.key === 'ArrowRight' ? 1 : -1);
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href]:not([hidden])')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      const activeIndex = controls.indexOf(document.activeElement);
      if (event.shiftKey && (activeIndex === 0 || activeIndex === -1)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && activeIndex === controls.length - 1) { event.preventDefault(); first.focus(); }
    });
  }
  window.openOptiframeTutorial = (requestedTopic = 'capture') => {
    if (!dialog) create();
    if (!dialog.open) returnFocus = document.activeElement;
    topic = Object.hasOwn(guides, requestedTopic) ? requestedTopic : 'capture';
    step = 0;
    render();
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add('oft-guide-open');
    get('.oft-title').focus({ preventScroll: true });
  };
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-tutorial]');
    if (!trigger) return;
    event.preventDefault();
    window.openOptiframeTutorial(trigger.dataset.tutorial);
  });
})();
