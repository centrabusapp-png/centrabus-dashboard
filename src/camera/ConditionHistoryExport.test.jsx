import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ConditionHistoryExport from './ConditionHistoryExport';
const NOW = Date.parse('2026-10-23T04:00:00.000Z');
const bus = { id: 'test-bus', plateNumber: 'BUS 159' };
const clock = () => NOW;
const downloadResult = { blob: new Blob(['test-csv']), filename: 'test.csv', captures: 2, rows: 2, readingCount: 12 };

test('one click downloads today, with a custom date range available when needed', async () => {
  const service = { enabled: true, exportCsv: jest.fn(async () => downloadResult) }, download = jest.fn();
  render(<ConditionHistoryExport bus={bus} service={service} download={download} clock={clock} />);
  fireEvent.click(screen.getByRole('button', { name: "Today's CSV" }));
  await waitFor(() => expect(download).toHaveBeenCalledWith(downloadResult));
  expect(service.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ busId: 'test-bus', busLabel: 'BUS 159',
    from: '2026-10-22T16:00:00.000Z', to: '2026-10-23T04:00:00.000Z', includeDetails: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Other dates' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose date range' });
  expect(dialog).toHaveTextContent('BUS 159'); expect(dialog).toHaveTextContent('Philippine time');
  expect(dialog).toHaveTextContent('One row per capture');
  expect(within(dialog).getByRole('checkbox', { name: /Include technical details/ })).not.toBeChecked();
  fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-10-23T08:00' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Download CSV' }));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  expect(service.exportCsv).toHaveBeenLastCalledWith(expect.objectContaining({ busId: 'test-bus', busLabel: 'BUS 159',
    from: '2026-10-23T00:00:00.000Z', to: '2026-10-23T04:00:00.000Z', includeDetails: false }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('2 captures');
});

test('technical details are opt-in and disabled while the selected export is loading', async () => {
  let finish;
  const service = { enabled: true, exportCsv: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
  render(<ConditionHistoryExport bus={bus} service={service} download={jest.fn()} clock={clock} />);
  fireEvent.click(screen.getByRole('button', { name: 'Other dates' }));
  const dialog = screen.getByRole('dialog');
  const details = within(dialog).getByRole('checkbox', { name: /Include technical details/ });
  fireEvent.click(details);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Download CSV' }));
  expect(service.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ includeDetails: true }));
  expect(details).toBeDisabled();
  await act(async () => finish(downloadResult));
});

test('empty/error states do not download an empty or partial file', async () => {
  const service = { enabled: true, exportCsv: jest.fn(async () => { throw Error('history-empty'); }) }, download = jest.fn();
  render(<ConditionHistoryExport bus={bus} service={service} download={download} clock={clock} />);
  fireEvent.click(screen.getByRole('button', { name: "Today's CSV" }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('No saved readings');
  expect(download).not.toHaveBeenCalled();
});

test('a missing history route explains the launcher update instead of claiming the trip is empty', async () => {
  const service = { enabled: true, exportCsv: jest.fn(async () => { throw Error('history-route-unavailable'); }) };
  const download = jest.fn();
  render(<ConditionHistoryExport bus={bus} service={service} download={download} clock={clock} />);
  fireEvent.click(screen.getByRole('button', { name: "Today's CSV" }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Update and restart the launcher');
  expect(screen.getByRole('alert')).not.toHaveTextContent('No saved readings');
  expect(download).not.toHaveBeenCalled();
});

test('Cancel aborts an in-flight export and prevents late downloads', async () => {
  let finish;
  const service = { enabled: true, exportCsv: jest.fn(() => new Promise(resolve => { finish = resolve; })) }, download = jest.fn();
  render(<ConditionHistoryExport bus={bus} service={service} download={download} clock={clock} />);
  fireEvent.click(screen.getByRole('button', { name: 'Other dates' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Download CSV' }));
  expect(within(dialog).getByRole('button', { name: 'Preparing CSV…' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(service.exportCsv.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => finish(downloadResult));
  expect(download).not.toHaveBeenCalled();
});

test('unconfigured backend disables export; configured backend starts the quick download', async () => {
  const download = jest.fn();
  const service = { enabled: false, exportCsv: jest.fn(async () => downloadResult) };
  const view = render(<ConditionHistoryExport bus={bus} service={service} download={download} clock={clock} />);
  expect(screen.getByRole('button', { name: "Today's CSV" })).toBeDisabled();
  view.rerender(<ConditionHistoryExport bus={bus} service={{ ...service, enabled: true }} download={download} clock={clock} />);
  fireEvent.click(screen.getByRole('button', { name: "Today's CSV" }));
  await waitFor(() => expect(download).toHaveBeenCalledWith(downloadResult));
  expect(service.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ includeDetails: false }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
