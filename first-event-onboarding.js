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

    copy.append(kicker, title, description);

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

    const actions = document.createElement('div');
    actions.className = 'first-event-guide-actions';
    actions.append(action);
    guide.append(copy, actions);
    events.after(guide);

    if (!eventRow || !eventId) return;
    const category = (eventRow.dataset.eventCategory || '').toLocaleLowerCase('sv-SE');
    const hasAttachment = eventRow.dataset.hasAttachment === 'true';
    const hasMileage = eventRow.dataset.hasMileage === 'true';
    let suggestion;

    if (!hasMileage) {
      suggestion = {
        title: 'Vill du lägga till miltal?',
        description: 'Om du vet mätarställningen vid tillfället blir historiken mer komplett. Du kan också göra det senare.',
        action: 'Lägg till miltal',
        actionType: 'complete-event-mileage'
      };
    } else if (category === 'service' || category === 'underhåll') {
      suggestion = {
        title: 'Kom ihåg nästa service',
        description: 'Skapa en påminnelse så slipper du hålla nästa servicetillfälle i huvudet.',
        action: 'Skapa servicepåminnelse',
        actionType: 'add-reminder',
        value: 'Nästa service'
      };
    } else if (category === 'besiktning') {
      suggestion = {
        title: 'Kom ihåg nästa besiktning',
        description: 'Lägg in en påminnelse när du vet när bilen ska besiktas igen.',
        action: 'Skapa besiktningspåminnelse',
        actionType: 'add-reminder',
        value: 'Nästa besiktning'
      };
    } else if (!hasAttachment) {
      suggestion = {
        title: 'Har du kvitto eller bild?',
        description: 'Lägg till underlag på händelsen så hittar du det tillsammans med historiken.',
        action: 'Lägg till kvitto eller bild',
        actionType: 'event-details'
      };
    }

    if (!suggestion) return;
    const dismissalKey = `fordonsmappen.next-step.dismissed:${eventId}`;
    try {
      if (sessionStorage.getItem(dismissalKey) === 'true') return;
    } catch { /* Storage may be unavailable in private browsing. */ }

    const card = document.createElement('section');
    card.className = 'first-event-next-step';
    card.dataset.eventId = eventId;
    card.setAttribute('aria-label', 'Ett förslag på nästa steg');

    const suggestionCopy = document.createElement('div');
    suggestionCopy.className = 'first-event-next-step-copy';
    const suggestionTitle = document.createElement('h3');
    suggestionTitle.textContent = suggestion.title;
    const suggestionDescription = document.createElement('p');
    suggestionDescription.textContent = suggestion.description;
    suggestionCopy.append(suggestionTitle, suggestionDescription);

    const suggestionActions = document.createElement('div');
    suggestionActions.className = 'first-event-next-step-actions';
    const suggestionAction = document.createElement('button');
    suggestionAction.type = 'button';
    suggestionAction.className = 'btn secondary';
    suggestionAction.dataset.action = suggestion.actionType;
    suggestionAction.dataset.id = eventId;
    if (suggestion.value) suggestionAction.dataset.title = suggestion.value;
    suggestionAction.textContent = suggestion.action;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn outline first-event-next-step-dismiss';
    dismiss.dataset.action = 'dismiss-next-step';
    dismiss.textContent = 'Inte nu';
    suggestionActions.append(suggestionAction, dismiss);
    card.append(suggestionCopy, suggestionActions);
    guide.append(card);
  };

  const enhanceDashboard = () => {
    enhanceEmptyVehicleHistory();
    enhanceFirstSavedEvent();
  };

  const observer = new MutationObserver(enhanceDashboard);
  observer.observe(app, { childList: true, subtree: true });
  enhanceDashboard();
})();
