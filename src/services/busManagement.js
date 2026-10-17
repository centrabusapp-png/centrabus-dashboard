import { supabase } from '../supabase';

function operationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function mapSupabaseBusError(error) {
  const message = error?.message || 'Supabase bus operation failed.';
  const rawCode = error?.code || '';

  if (message.includes('admin-required') || rawCode === '42501') {
    return operationError('permission-denied', 'Admin permission is required.');
  }

  if (message.includes('duplicate-plate') || rawCode === '23505') {
    return operationError('duplicate-plate', 'A bus with this Plate Number already exists.');
  }

  if (message.includes('bus-not-found') || rawCode === 'P0002') {
    return operationError('bus-not-found', 'Bus does not exist.');
  }

  if (message.includes('invalid-')) {
    return operationError('invalid-argument', message);
  }

  return operationError(rawCode || 'supabase-error', message);
}

function normalizeDocumentId(value, label) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.includes('/')) {
    throw operationError('invalid-argument', `${label} is invalid.`);
  }
  return id;
}

export async function registerBus({ plateNumber, status = 'active' }) {
  const { data, error } = await supabase.rpc('admin_register_bus', {
    p_plate_number: plateNumber,
    p_status: status,
  });

  if (error) throw mapSupabaseBusError(error);

  return { id: data };
}

export async function updateBusPlateNumber(busId, plateNumber) {
  const normalizedBusId = normalizeDocumentId(busId, 'Bus ID');

  const { data, error } = await supabase.rpc('admin_update_bus_plate_number', {
    p_bus_id: normalizedBusId,
    p_plate_number: plateNumber,
  });

  if (error) throw mapSupabaseBusError(error);

  return { id: data };
}

export async function archiveBus(busId) {
  const normalizedBusId = normalizeDocumentId(busId, 'Bus ID');

  const { data, error } = await supabase.rpc('admin_archive_bus', {
    p_bus_id: normalizedBusId,
  });

  if (error) throw mapSupabaseBusError(error);

  return {
    busId: data,
    cameraId: null,
  };
}