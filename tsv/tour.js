'use strict';
(() => {
  const views = {
    overview: {kicker:'THE SPATIAL WORKSPACE', heading:'Keep the information. Keep your surroundings.', description:'Four dedicated HUD regions keep map awareness, primary FPV, enhanced vision and the weapon-camera viewport organized. Bring a view forward when you need it, then return it to the edge.', scene:'THE REAL WORLD STAYS IN VIEW'},
    vision: {kicker:'THERMAL + NIGHT VISION', heading:'Different sensors. A shared perspective.', description:'Overlay heat and low-light imagery on native passthrough. Each physical camera keeps its own orientation and image tuning; saved alignment profiles place the image in your view. Optical alignment depends on the camera mount, working distance and calibration.', scene:'HEAT + LOW LIGHT / REGISTERED OVERLAYS'},
    fpv: {kicker:'PRIMARY FPV + DEDICATED CAMERA', heading:'Bring the remote perspective closer.', description:'Move primary FPV through full, center, narrow mirror, HUD and hidden views. A separate weapon-camera viewport keeps its own source and controls. Compatible transmitters and configured video links are required.', scene:'ONE VIDEO STREAM / FIVE PRESENTATIONS'},
    awareness: {kicker:'MAP + TEAM + RADAR', heading:'Give every signal useful context.', description:'See GPS-backed locations, route markers and Meshtastic team data alongside radar awareness. The LD2450 path tracks up to three contacts; fresh and briefly held returns look different. Radar contacts are reflections, not automatic person identification.', scene:'POSITION / DIRECTION / FRESHNESS'}
  };
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panel = document.getElementById('tour-panel');
  function select(tab, focus = false) {
    const key = tab.dataset.view;
    const view = views[key];
    tabs.forEach(item => {const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;});
    panel.dataset.view = key;
    panel.setAttribute('aria-labelledby', tab.id);
    for (const [id, field] of [['tour-kicker','kicker'],['tour-heading','heading'],['tour-description','description'],['scene-label','scene']]) document.getElementById(id).textContent = view[field];
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {event.preventDefault(); select(tabs[next], true);}
    });
  });
  function revealGuide() {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const section = document.getElementById(id);
    if (section && section.tagName === 'DETAILS') section.open = true;
  }
  window.addEventListener('hashchange', revealGuide);
  document.querySelectorAll('a[href^="#use-"]').forEach(link => link.addEventListener('click', () => {
    const section = document.getElementById(link.getAttribute('href').slice(1));
    if (section) section.open = true;
  }));
  revealGuide();
})();
