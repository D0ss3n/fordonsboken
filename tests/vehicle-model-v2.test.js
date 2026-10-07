import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleModelV2Plan } from '../vehicle-model-v2.js';

const vehicleId = 'legacy-car-1';

test('migration separates vehicle facts from owner-private details and files', () => {
  const plan = createVehicleModelV2Plan('alice', {
    vehicles: [{ id: vehicleId, name: 'Familjebilen', reg: 'ABC123', mileage: '18420' }],
    events: [{
      id: 'service-1', vehicle: vehicleId, category: 'Service', title: 'Service utförd',
      date: '2026-01-02', mileage: 18000, cost: 3200, description: 'Privat anteckning',
      sourceType: 'external_verified',
      attachments: [{ id: 'receipt-1', name: 'kvitto.pdf', storagePath: 'users/alice/events/service-1/file.pdf' }],
    }],
    problems: [], reminders: [], tireSets: [],
  });

  const vehicle = plan.writes.find(write => write.kind === 'vehicle');
  const history = plan.writes.find(write => write.kind === 'vehicle-event');
  const privateDetails = plan.writes.find(write => write.kind === 'private-event-details');
  const privateAttachment = plan.writes.find(write => write.kind === 'private-attachment');
  assert.equal(vehicle.data.vehicle.registration, 'ABC123');
  assert.equal(history.data.sourceType, 'owner_entry');
  assert.equal('cost' in history.data, false);
  assert.equal('description' in history.data, false);
  assert.equal(privateDetails.data.cost, 3200);
  assert.equal(privateDetails.data.description, 'Privat anteckning');
  assert.equal(privateAttachment.data.name, 'kvitto.pdf');
});

test('migration rejects duplicate document IDs rather than overwriting an entry', () => {
  assert.throws(() => createVehicleModelV2Plan('alice', {
    vehicles: [{ id: vehicleId }],
    events: [
      { id: 'duplicate-event', vehicle: vehicleId },
      { id: 'duplicate-event', vehicle: vehicleId },
    ],
  }), /Dubbla poster/);
});

test('migration rejects malformed identifiers before constructing Firestore paths', () => {
  assert.throws(() => createVehicleModelV2Plan('alice', {
    vehicles: [{ id: 'bad/vehicle/id' }],
  }), /Ogiltigt fordons-ID/);
});
