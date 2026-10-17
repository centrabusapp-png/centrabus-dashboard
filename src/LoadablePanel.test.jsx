import { act, fireEvent, render, screen } from '@testing-library/react';
import LoadablePanel from './LoadablePanel';

test('loads a view once and preserves it across ordinary prop updates', async () => {
  let finish;
  const load = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<LoadablePanel load={load} loadingLabel="Loading fleet dashboard…" value="First bus" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading fleet dashboard');
  await act(async () => finish({ default: ({ value }) => <div>{value}</div> }));
  expect(await screen.findByText('First bus')).toBeInTheDocument();
  rerender(<LoadablePanel load={load} loadingLabel="Loading fleet dashboard…" value="Second bus" />);
  expect(screen.getByText('Second bus')).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
});

test('failed chunk loading has a recoverable retry without showing internal errors', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const load = jest.fn()
      .mockRejectedValueOnce(new Error('Private internal request detail'))
      .mockResolvedValueOnce({ default: () => <div>Recovered view</div> });
    render(<LoadablePanel load={load} loadingLabel="Loading view…" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load this view');
    expect(screen.queryByText(/Private internal/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('Recovered view')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    consoleError.mockRestore();
  }
});

test('a pending view can unmount without mounting when its download finishes later', async () => {
  let finish;
  const View = jest.fn(() => <div>Late view</div>);
  const load = () => new Promise((resolve) => { finish = resolve; });
  const { unmount } = render(<LoadablePanel load={load} loadingLabel="Loading view…" />);
  unmount();
  await act(async () => finish({ default: View }));
  expect(View).not.toHaveBeenCalled();
});
