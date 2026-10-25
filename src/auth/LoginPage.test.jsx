import { render, screen } from '@testing-library/react';
import LoginPage from './LoginPage';

test('larger logo is centered while login description and authentication form stay unchanged', () => {
  render(<LoginPage onSignIn={jest.fn()} onResetPassword={jest.fn()} />);
  const logo = screen.getByAltText('CentraBus Logo');
  expect(logo).toHaveClass('lg:w-[480px]');
  expect(logo.parentElement).toHaveClass('justify-center');
  expect(logo.parentElement).not.toHaveClass('lg:justify-start');
  expect(logo).not.toHaveClass('lg:-ml-12');
  const welcome = screen.getByRole('heading', { name: 'Welcome to CentraBus' });
  expect(welcome).toHaveClass('whitespace-nowrap');
  expect(welcome.querySelector('br')).toBeNull();
  expect(welcome).toHaveTextContent('Welcome to CentraBus');
  expect(screen.getByText('Real-time fleet monitoring, vehicle condition monitoring, and route compliance in one centralized platform.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Email address' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sign In/ })).toBeInTheDocument();
});
