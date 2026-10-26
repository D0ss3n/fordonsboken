(() => {
  const app = document.getElementById('app');
  if (!app) return;

  const enhanceEmptyVehicleHistory = () => {
    const dashboard = app.querySelector('.dashboard-grid');
    const heading = app.querySelector('.section-row');
    const emptyState = heading?.nextElementSibling;

    if (!dashboard
      || heading?.querySelector('h2')?.textContent.trim() !== 'Senaste händelser'
      || !emptyState?.classList.contains('blank')
      || !emptyState.textContent.includes('Ingen historik ännu')) return;

    const vehicleName = app.querySelector('.vehicle-card h2')?.textContent.trim();
    const guide = document.createElement('section');
    guide.className = 'first-event-guide panel';
    guide.setAttribute('aria-labelledby', 'first-event-guide-title');

    const copy = document.createElement('div');
    copy.className = 'first-event-guide-copy';

    const kicker = document.createElement('span');
    kicker.className = 'first-event-guide-kicker';
    kicker.textContent = 'Din bil är tillagd';

    const title = document.createElement('h2');
    title.id = 'first-event-guide-title';
    title.textContent = vehicleName
      ? `Börja bygga historiken för ${vehicleName}`
      : 'Börja bygga bilens historik';

    const description = document.createElement('p');
    description.textContent = 'Börja med det du kommer ihåg – du kan lägga till fler saker senare.';

    const examples = document.createElement('p');
    examples.className = 'first-event-guide-examples';
    examples.textContent = 'Lägg till till exempel service, reparation, besiktning, kostnad eller dokument.';

    copy.append(kicker, title, description, examples);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn primary first-event-guide-action';
    action.dataset.action = 'add-event';
    action.textContent = 'Lägg till första händelsen →';

    guide.append(copy, action);
    dashboard.after(guide);
    heading.remove();
    emptyState.remove();
  };

  const enhanceFirstSavedEvent = () => {
    const heading = [...app.querySelectorAll('.section-row')]
      .find(row => row.querySelector('h2')?.textContent.trim() === 'Senaste händelser');
    const events = heading?.nextElementSibling;
    if (!heading || !events?.classList.contains('events-list') || events.children.length !== 1
      || app.querySelector('.first-event-saved-guide')) return;

    const guide = document.createElement('section');
    guide.className = 'first-event-guide first-event-saved-guide panel';
    guide.setAttribute('aria-labelledby', 'first-event-saved-title');

    const copy = document.createElement('div');
    copy.className = 'first-event-guide-copy';

    const kicker = document.createElement('span');
    kicker.className = 'first-event-guide-kicker';
    kicker.textContent = 'Bra, du är igång';

    const title = document.createElement('h2');
    title.id = 'first-event-saved-title';
    title.textContent = 'Din händelse finns nu i Historik';

    const description = document.createElement('p');
    description.textContent = 'Öppna den där om du vill se detaljer eller komplettera med ett kvitto eller en bild.';

    const nextStep = document.createElement('p');
    nextStep.className = 'first-event-guide-examples';
    nextStep.textContent = 'När du kommer på fler saker kan du lägga till dem efter hand, eller skapa en påminnelse.';

    copy.append(kicker, title, description, nextStep);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn primary first-event-guide-action';
    action.dataset.page = 'Historik';
    action.textContent = 'Visa händelsen i Historik →';

    guide.append(copy, action);
    events.after(guide);
  };

  const enhanceDashboard = () => {
    enhanceEmptyVehicleHistory();
    enhanceFirstSavedEvent();
  };

  const observer = new MutationObserver(enhanceDashboard);
  observer.observe(app, { childList: true, subtree: true });
  enhanceDashboard();
})();
