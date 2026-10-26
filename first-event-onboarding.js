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
    kicker.textContent = 'Din fordonsbok är redo';

    const title = document.createElement('h2');
    title.id = 'first-event-guide-title';
    title.textContent = vehicleName
      ? `Ge ${vehicleName} en historia som följer med`
      : 'Ge bilen en historia som följer med';

    const description = document.createElement('p');
    description.textContent = 'Samla service, reparationer, kostnader och kvitton här. Då får du koll på vad som är gjort och en tydlig historik att ta med vid ägarbyte.';

    const examples = document.createElement('p');
    examples.className = 'first-event-guide-examples';
    examples.textContent = 'Börja med en sak du minns – detaljer kan du komplettera senare.';

    const benefits = document.createElement('ul');
    benefits.className = 'first-event-benefits';
    benefits.innerHTML = '<li><span aria-hidden="true">✓</span> Håll koll på vad som gjorts</li><li><span aria-hidden="true">✓</span> Samla kostnader och underlag</li><li><span aria-hidden="true">✓</span> Bygg en historik som följer bilen</li>';

    copy.append(kicker, title, description, examples, benefits);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn primary first-event-guide-action';
    action.dataset.action = 'add-event';
    action.textContent = 'Lägg till första händelsen';

    const actions = document.createElement('div');
    actions.className = 'first-event-guide-actions';
    actions.append(action);
    guide.append(copy, actions);
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
    kicker.textContent = 'Första steget klart';

    const title = document.createElement('h2');
    title.id = 'first-event-saved-title';
    title.textContent = 'Historiken är igång';

    const description = document.createElement('p');
    const eventRow = events.querySelector('.event-row');
    const eventTitle = eventRow?.querySelector('.event-info strong')?.textContent.trim();
    const eventMeta = eventRow?.querySelector('.event-info small')?.textContent.trim();
    description.textContent = eventTitle
      ? `${eventTitle}${eventMeta ? ` · ${eventMeta}` : ''} är sparad. Du hittar den i bilens historik och kan när som helst komplettera med kvitto, bild eller fler detaljer.`
      : 'Din första händelse är sparad. Du hittar den i bilens historik och kan när som helst komplettera med kvitto, bild eller fler detaljer.';

    const nextStep = document.createElement('p');
    nextStep.className = 'first-event-guide-examples';
    nextStep.textContent = 'Varje liten notering gör historiken mer användbar – fortsätt när du kommer på nästa sak.';

    copy.append(kicker, title, description, nextStep);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn primary first-event-guide-action';
    const eventId = eventRow?.dataset.id;
    if (eventId) {
      action.dataset.action = 'event-details';
      action.dataset.id = eventId;
      action.textContent = 'Öppna händelsen';
    } else {
      action.dataset.page = 'Historik';
      action.textContent = 'Visa historiken';
    }

    const addAnother = document.createElement('button');
    addAnother.type = 'button';
    addAnother.className = 'btn secondary first-event-next-action';
    addAnother.dataset.action = 'add-event';
    addAnother.textContent = 'Lägg till en sak till';
    const actions = document.createElement('div');
    actions.className = 'first-event-guide-actions';
    actions.append(action, addAnother);
    guide.append(copy, actions);
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
