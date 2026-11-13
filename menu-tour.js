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
    ['Inställningar', 'Hantera konto, utseende, pushenheter, export och dina uppgifter. Efter guiden hittar du Menyguide längst ned i Inställningar.']
  ];
  let active = false;
  let index = 0;
  let card;
  let target;
  let backdrop;

  function navTarget(name) {
    return Array.from(document.querySelectorAll('.sidebar [data-page]'))
      .find(button => button.dataset.page === name);
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
      card.style.bottom = 'auto';
      const height = card.offsetHeight;
      const topCandidate = bounds.top - height - 16;
      const bottomCandidate = bounds.bottom + 16;
      if (topCandidate >= 12) {
        card.style.top = `${topCandidate}px`;
      } else if (bottomCandidate + height <= window.innerHeight - 76) {
        card.style.top = `${bottomCandidate}px`;
      } else {
        card.style.top = `${Math.max(12, Math.min(bounds.top - height / 2, window.innerHeight - height - 20))}px`;
      }
    } else {
      const left = Math.min(Math.max(250, bounds.right + 18), window.innerWidth - 360);
      const top = Math.min(Math.max(16, bounds.top + bounds.height / 2 - card.offsetHeight / 2), window.innerHeight - card.offsetHeight - 16);
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
    backdrop?.remove();
    backdrop = null;
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
    backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'menu-tour-backdrop';
    backdrop.setAttribute('aria-label', 'Stäng menyguide');
    backdrop.addEventListener('click', finish);
    document.body.appendChild(backdrop);
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
      const isFinalStep = index === steps.length - 1;
      if (isFinalStep && document.querySelector('.main .page-title')?.textContent.trim() !== 'Inställningar') {
        navTarget('Inställningar')?.click();
      }
      if (isFinalStep) {
        Array.from(document.querySelectorAll('.settings-accordion-trigger'))
          .find(button => button.textContent.trim() === 'Menyguide')?.click();
      }
      index += 1;
      if (index >= steps.length) finish();
      else showStep();
    }
  }, true);

  function inspectApp() {
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
