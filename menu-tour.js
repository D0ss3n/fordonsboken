(() => {
  'use strict';

  const SEEN_KEY = 'fordonsmappen.menu-tour.completed.v1';
  const steps = [
    ['Översikt', 'Här ser du en snabb sammanfattning av valt fordon, senaste händelser, kostnader och pågående problem.'],
    ['Historik', 'Här samlas fordonets händelser i datumordning. Sök och filtrera när du vill hitta något särskilt.'],
    ['Problem', 'Följ problem från upptäckt till lösning och spara uppdateringar längs vägen.'],
    ['Kostnader', 'Se vad fordonet kostar, både totalt och uppdelat per år och kategori.'],
    ['Påminnelser', 'Lägg in datum eller miltal så att du kommer ihåg service, besiktning och annat.'],
    ['Dokument', 'Hitta bilder, kvitton och andra filer som hör till fordonets historik.'],
    ['Däck', 'Håll reda på dina däckuppsättningar, mönsterdjup och när de köptes.'],
    ['Profil', 'Välj vad som ska visas i din publika fordonsprofil och hantera delning.'],
    ['Fordon', 'Lägg till och byt mellan fordon. Här hittar du också överlämning till en ny ägare.'],
    ['Inställningar', 'Hantera konto, utseende, pushenheter, export och dina uppgifter.']
  ];
  let active = false;
  let index = 0;
  let card;
  let target;

  function navTarget(name) {
    return Array.from(document.querySelectorAll('.sidebar [data-page]'))
      .find(button => button.dataset.page === name);
  }

  function ensureReplayButton() {
    const settingsActive = document.querySelector('.sidebar [data-page="Inställningar"].active');
    const heading = document.querySelector('.main .page-title');
    if (!settingsActive || !heading || document.querySelector('[data-menu-tour-start]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn outline small menu-tour-replay';
    button.dataset.menuTourStart = '';
    button.textContent = 'Visa menyguide';
    heading.insertAdjacentElement('afterend', button);
  }

  function makeCard() {
    card = document.createElement('section');
    card.className = 'menu-tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'menu-tour-title');
    card.innerHTML = '<div class="menu-tour-progress"></div><button class="menu-tour-close" type="button" data-menu-tour-close aria-label="Stäng guiden">×</button><p class="menu-tour-count"></p><h2 id="menu-tour-title"></h2><p class="menu-tour-description"></p><div class="menu-tour-actions"><button class="btn outline small" type="button" data-menu-tour-skip>Hoppa över</button><button class="btn primary small" type="button" data-menu-tour-next>Nästa</button></div>';
    document.body.appendChild(card);
  }

  function positionCard() {
    if (!card || !target) return;
    const bounds = target.getBoundingClientRect();
    const narrow = window.matchMedia('(max-width: 720px)').matches;
    if (narrow) {
      card.style.left = '12px';
      card.style.right = '12px';
      card.style.top = 'auto';
      card.style.bottom = 'calc(76px + env(safe-area-inset-bottom))';
    } else {
      const left = Math.min(Math.max(250, bounds.right + 18), window.innerWidth - 360);
      const top = Math.min(Math.max(16, bounds.top - 12), window.innerHeight - card.offsetHeight - 16);
      card.style.left = `${left}px`;
      card.style.right = 'auto';
      card.style.top = `${top}px`;
      card.style.bottom = 'auto';
    }
  }

  function showStep() {
    const [name, description] = steps[index];
    target?.classList.remove('menu-tour-highlight');
    target = navTarget(name);
    if (!target) return finish();
    if (window.matchMedia('(max-width: 720px)').matches && !document.querySelector('.app-shell')?.classList.contains('sidebar-open')) {
      document.querySelector('[data-action="toggle-sidebar"]')?.click();
    }
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    target.classList.add('menu-tour-highlight');
    card.querySelector('.menu-tour-count').textContent = `Menyguide · ${index + 1} av ${steps.length}`;
    card.querySelector('#menu-tour-title').textContent = name;
    card.querySelector('.menu-tour-description').textContent = description;
    card.querySelector('[data-menu-tour-next]').textContent = index === steps.length - 1 ? 'Klar' : 'Nästa';
    requestAnimationFrame(positionCard);
  }

  function finish() {
    active = false;
    target?.classList.remove('menu-tour-highlight');
    target = null;
    card?.remove();
    card = null;
    localStorage.setItem(SEEN_KEY, '1');
    document.querySelector('.app-shell')?.classList.remove('menu-tour-open');
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && active) finish();
  }

  function start() {
    if (active || !document.querySelector('.app-shell')) return;
    active = true;
    index = 0;
    document.querySelector('.app-shell')?.classList.add('menu-tour-open');
    makeCard();
    document.addEventListener('keydown', onKeydown);
    showStep();
  }

  document.addEventListener('click', event => {
    const startButton = event.target.closest('[data-menu-tour-start]');
    if (startButton) {
      event.preventDefault();
      start();
      return;
    }
    if (!active) return;
    if (event.target.closest('[data-menu-tour-close], [data-menu-tour-skip]')) {
      finish();
    } else if (event.target.closest('[data-menu-tour-next]')) {
      index += 1;
      if (index >= steps.length) finish();
      else showStep();
    }
  }, true);

  function inspectApp() {
    ensureReplayButton();
    if (!active && !localStorage.getItem(SEEN_KEY) && document.querySelector('.app-shell')) {
      localStorage.setItem(SEEN_KEY, 'pending');
      window.setTimeout(() => {
        if (document.querySelector('.app-shell') && localStorage.getItem(SEEN_KEY) === 'pending') start();
        else if (!document.querySelector('.app-shell')) localStorage.removeItem(SEEN_KEY);
      }, 900);
    }
  }

  const observer = new MutationObserver(inspectApp);
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  inspectApp();
  window.addEventListener('resize', positionCard);
  window.addEventListener('scroll', positionCard, true);
})();
