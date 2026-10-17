import { supabase } from '../supabase';
import {
  archiveBus,
  registerBus,
  updateBusPlateNumber,
} from './busManagement';

jest.mock('../supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('registers a bus through the admin_register_bus RPC', async () => {
  supabase.rpc.mockResolvedValue({
    data: 'new-bus-id',
    error: null,
  });

  await expect(
    registerBus({
      plateNumber: 'ABC 234',
      status: 'active',
    }),
  ).resolves.toEqual({
    id: 'new-bus-id',
  });

  expect(supabase.rpc).toHaveBeenCalledWith(
    'admin_register_bus',
    {
      p_plate_number: 'ABC 234',
      p_status: 'active',
    },
  );
});

test('registerBus uses active as the default status', async () => {
  supabase.rpc.mockResolvedValue({
    data: 'new-bus-id',
    error: null,
  });

  await registerBus({
    plateNumber: 'ABC 234',
  });

  expect(supabase.rpc).toHaveBeenCalledWith(
    'admin_register_bus',
    {
      p_plate_number: 'ABC 234',
      p_status: 'active',
    },
  );
});

test('updates a bus plate number through the admin RPC', async () => {
  supabase.rpc.mockResolvedValue({
    data: 'bus-1',
    error: null,
  });

  await expect(
    updateBusPlateNumber('  bus-1  ', 'NAB 1234'),
  ).resolves.toEqual({
    id: 'bus-1',
  });

  expect(supabase.rpc).toHaveBeenCalledWith(
    'admin_update_bus_plate_number',
    {
      p_bus_id: 'bus-1',
      p_plate_number: 'NAB 1234',
    },
  );
});

test('archives a bus through the admin RPC', async () => {
  supabase.rpc.mockResolvedValue({
    data: 'bus-1',
    error: null,
  });

  await expect(
    archiveBus('  bus-1  '),
  ).resolves.toEqual({
    busId: 'bus-1',
    cameraId: null,
  });

  expect(supabase.rpc).toHaveBeenCalledWith(
    'admin_archive_bus',
    {
      p_bus_id: 'bus-1',
    },
  );
});

test('rejects an invalid bus ID before calling Supabase', async () => {
  await expect(
    updateBusPlateNumber('bad/bus-id', 'ABC 234'),
  ).rejects.toMatchObject({
    code: 'invalid-argument',
  });

  expect(supabase.rpc).not.toHaveBeenCalled();
});

test('maps duplicate plate errors to the frontend duplicate-plate code', async () => {
  supabase.rpc.mockResolvedValue({
    data: null,
    error: {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    },
  });

  await expect(
    registerBus({
      plateNumber: 'ABC 234',
    }),
  ).rejects.toMatchObject({
    code: 'duplicate-plate',
    message: 'A bus with this Plate Number already exists.',
  });
});

test('maps admin permission errors to permission-denied', async () => {
  supabase.rpc.mockResolvedValue({
    data: null,
    error: {
      code: '42501',
      message: 'admin-required',
    },
  });

  await expect(
    archiveBus('bus-1'),
  ).rejects.toMatchObject({
    code: 'permission-denied',
    message: 'Admin permission is required.',
  });
});
