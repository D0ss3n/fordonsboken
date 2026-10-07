const text = value => String(value ?? '');
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function documentId(value, label) {
  const id = text(value).trim();
  if (!id || id.includes('/') || id === '.' || id === '..') {
    throw new Error(`Ogiltigt ${label}-ID i v1-data.`);
  }
  return id;
}

function forVehicle(items, vehicleId) {
  return (Array.isArray(items) ? items : []).filter(item => item?.vehicle === vehicleId);
}

/** Build an idempotent, non-destructive Firestore v2 copy from the legacy app state. */
export function createVehicleModelV2Plan(uid, state) {
  const ownerUid = documentId(uid, 'konto');
  if (!state || typeof state !== 'object') throw new Error('Kontots v1-data saknas.');
  const vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
  const ids = new Set();
  const plan = [];

  for (const oldVehicle of vehicles) {
    const vehicleId = documentId(oldVehicle?.id, 'fordons');
    if (ids.has(vehicleId)) throw new Error(`Dubbelt fordons-ID i v1-data: ${vehicleId}`);
    ids.add(vehicleId);

    const vehicle = {
      id: vehicleId,
      name: text(oldVehicle.name),
      type: text(oldVehicle.type),
      make: text(oldVehicle.make),
      model: text(oldVehicle.model),
      year: text(oldVehicle.year),
      registration: text(oldVehicle.reg),
      vin: text(oldVehicle.vin),
      mileage: number(oldVehicle.mileage),
    };

    plan.push({
      path: `vehicles/${vehicleId}`,
      kind: 'vehicle',
      data: { schemaVersion: 2, createdByUid: ownerUid, vehicle },
    });
    plan.push({
      path: `vehicles/${vehicleId}/members/${ownerUid}`,
      kind: 'member',
      data: { schemaVersion: 2, uid: ownerUid, role: 'owner', active: true, startedAt: null },
    });
    plan.push({
      path: `users/${ownerUid}/vehicleMemberships/${vehicleId}`,
      kind: 'vehicle-index',
      data: { schemaVersion: 2, vehicleId, role: 'owner', active: true },
    });
    plan.push({
      path: `vehicles/${vehicleId}/ownershipHistory/legacy-${ownerUid}`,
      kind: 'ownership-history',
      data: { schemaVersion: 2, ownerUid, startedAt: null, endedAt: null, source: 'legacy-migration' },
    });

    for (const event of forVehicle(state.events, vehicleId)) {
      const eventId = documentId(event.id, 'händelse');
      plan.push({
        path: `vehicles/${vehicleId}/events/${eventId}`,
        kind: 'vehicle-event',
        data: {
          schemaVersion: 2,
          id: eventId,
          category: text(event.category),
          title: text(event.title),
          date: text(event.date),
          mileage: number(event.mileage),
          // V1 cannot prove a claimed source; import it as user-entered.
          sourceType: 'owner_entry',
          createdByUid: ownerUid,
        },
      });
      const { id: _id, vehicle: _vehicleId, ...privateEvent } = event;
      plan.push({
        path: `users/${ownerUid}/privateVehicles/${vehicleId}/eventDetails/${eventId}`,
        kind: 'private-event-details',
        data: { schemaVersion: 2, eventId, ...privateEvent },
      });
      for (const attachment of Array.isArray(event.attachments) ? event.attachments : []) {
        const attachmentId = documentId(attachment.id, 'bilage');
        plan.push({
          path: `users/${ownerUid}/privateVehicles/${vehicleId}/attachments/${attachmentId}`,
          kind: 'private-attachment',
          data: { schemaVersion: 2, eventId, ...attachment },
        });
      }
    }

    for (const [collection, items] of [
      ['problems', state.problems],
      ['reminders', state.reminders],
      ['tireSets', state.tireSets],
    ]) {
      for (const item of forVehicle(items, vehicleId)) {
        const itemId = documentId(item.id, `${collection}-post`);
        const { id: _id, vehicle: _vehicleId, ...privateItem } = item;
        if (collection === 'problems') {
          plan.push({
            path: `vehicles/${vehicleId}/problems/${itemId}`,
            kind: 'vehicle-problem',
            data: {
              schemaVersion: 2,
              id: itemId,
              title: text(item.title),
              date: text(item.date),
              mileage: number(item.mileage),
              status: text(item.status),
              createdByUid: ownerUid,
            },
          });
        }
        plan.push({
          path: `users/${ownerUid}/privateVehicles/${vehicleId}/${collection}/${itemId}`,
          kind: `private-${collection}`,
          data: { schemaVersion: 2, id: itemId, ...privateItem },
        });
      }
    }
  }

  const paths = new Set();
  for (const write of plan) {
    if (paths.has(write.path)) throw new Error(`Dubbla poster med samma ID i v1-data: ${write.path}`);
    paths.add(write.path);
  }

  const counts = plan.reduce((result, item) => {
    result[item.kind] = (result[item.kind] || 0) + 1;
    return result;
  }, {});
  return { schemaVersion: 2, ownerUid, vehicleCount: vehicles.length, counts, writes: plan };
}
