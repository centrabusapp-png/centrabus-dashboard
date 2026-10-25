import { useState } from 'react';
import { Activity, ArrowRight, Eye, EyeOff, Lock, Monitor, Route, ShieldCheck, User } from 'lucide-react';

const CENTRABUS_LOGIN_LOGO_SRC = '/centrabus-login-logo.png';

export default function LoginPage({ authenticationError = '', authorizationError = '', passwordResetError = '', passwordResetSuccess = '', passwordRecovery = false, onSignIn, onResetPassword, onUpdatePassword, onCancelPasswordRecovery }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (passwordRecovery && password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    const didFinish = passwordRecovery
      ? await onUpdatePassword(password)
      : await onSignIn(email, password);
    if (!didFinish) setIsSubmitting(false);
  };

  const handlePasswordReset = async () => {
    setError('');
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    setIsResetting(true);
    try {
      await onResetPassword(email);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-[#F7F8FA]">
      {/* Background patterns */}
      <div className="absolute inset-0 z-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(#7A1F2B 2px, transparent 2px)', backgroundSize: '32px 32px' }} />
      <div className="absolute left-0 bottom-0 z-0 w-full pointer-events-none">
        <svg viewBox="0 0 1440 320" className="w-full h-auto text-[#7A1F2B] fill-current" preserveAspectRatio="none">
          <path d="M0,224L48,224C96,224,192,224,288,213.3C384,203,480,181,576,176C672,171,768,181,864,197.3C960,213,1056,235,1152,218.7C1248,203,1344,149,1392,122.7L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        </svg>
        <svg viewBox="0 0 1440 320" className="absolute bottom-0 left-0 w-full h-[85%] text-[#A1262F] fill-current opacity-90" preserveAspectRatio="none">
          <path d="M0,192L48,202.7C96,213,192,235,288,218.7C384,203,480,149,576,133.3C672,117,768,139,864,149.3C960,160,1056,160,1152,144C1248,128,1344,96,1392,80L1440,64L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        </svg>
      </div>

      <div className="relative z-10 flex-1 w-full max-w-[1280px] mx-auto grid gap-6 lg:gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center px-6 py-6">
        
        {/* Left Side Content */}
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <div className="w-full h-[116px] sm:h-[138px] lg:h-[154px] flex items-center justify-center overflow-hidden z-10 mb-4 pointer-events-none">
            <img 
              src={CENTRABUS_LOGIN_LOGO_SRC} 
              alt="CentraBus Logo" 
              className="w-[340px] sm:w-[420px] lg:w-[480px] max-w-full h-auto shrink-0 object-contain"
              style={{ filter: 'sepia(0.75) saturate(1.5) hue-rotate(305deg) brightness(0.8)' }}
            />
          </div>
          
          <h1 aria-label="Welcome to CentraBus" className="text-[clamp(1.6rem,3.2vw,3rem)] whitespace-nowrap font-extrabold tracking-tight text-[#1F1F1F] leading-[1.15]">
            Welcome to{' '}
            <span className="text-[#1F1F1F]">Centra</span><span className="text-[#A1262F]">Bus</span>
          </h1>
          
          <p className="mt-2 text-base sm:text-lg font-bold text-slate-500">
            Centralized Bus Monitoring System
          </p>
          
          <p className="mt-3 max-w-lg text-[14px] sm:text-[15px] leading-relaxed text-slate-600 font-medium">
            Real-time fleet monitoring, vehicle condition monitoring, and route compliance in one centralized platform.
          </p>
          
          <div className="mt-6 grid gap-3 sm:gap-4 w-full sm:grid-cols-3 max-w-[700px]">
            {[
              { icon: Monitor, title: 'Centralized Fleet\nMonitoring', desc: 'Monitor bus locations, speed, connectivity, and operational status in real time.' },
              { icon: Activity, title: 'Vehicle Condition\nMonitoring', desc: 'Monitor selected bus gauge-panel indicators from one centralized interface.' },
              { icon: Route, title: 'Route Compliance\nMonitoring', desc: 'Track assigned routes and identify possible route deviations.' },
            ].map((f) => (
              <div key={f.title} className="flex flex-col rounded-xl bg-white/95 backdrop-blur-sm p-4 shadow-sm border border-slate-200 transition-transform hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(122,31,43,0.16)]">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#A1262F] text-white mb-2.5 shadow-sm ring-2 ring-[#FFF6DA]">
                  <f.icon size={18} strokeWidth={2.5} />
                </div>
                <h3 className="text-[13px] font-extrabold text-[#1F1F1F] leading-tight whitespace-pre-line">{f.title}</h3>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 font-medium">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
        
        {/* Right Side Form */}
        <div className="w-full max-w-[440px] mx-auto lg:ml-auto">
          <div className="rounded-[28px] bg-white p-6 sm:p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)]">
            <div className="flex flex-col items-center text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-[#FFF6DA] text-[#7A1F2B] mb-3 outline outline-3 outline-[#F2C14E]/35">
                <ShieldCheck size={26} strokeWidth={2.5} />
              </div>
              <h2 className="text-[22px] sm:text-[24px] font-extrabold text-[#1F1F1F] tracking-tight">{passwordRecovery ? 'Set a new password' : 'Admin Login'}</h2>
              <p className="mt-1 text-sm text-slate-500 font-medium">{passwordRecovery ? 'Choose a new password for your administrator account.' : 'Authorized dashboard access'}</p>
              <div className="h-0.5 w-10 bg-[#D9A404] rounded-full mt-3 mb-5"></div>
            </div>
            
            <form onSubmit={handleSubmit} className="grid gap-4">
              {(authorizationError || authenticationError || error || passwordResetError || passwordResetSuccess) && (
                <div className={`rounded-xl border p-3 text-[13px] font-bold text-center ${passwordResetSuccess && !passwordResetError && !authorizationError && !authenticationError && !error ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`} role={passwordResetSuccess && !passwordResetError ? 'status' : 'alert'}>
                  {authorizationError || authenticationError || error || passwordResetError || passwordResetSuccess}
                </div>
              )}
              
              {!passwordRecovery && <div>
                <label htmlFor="emailInput" className="mb-1.5 block text-[13px] font-bold text-[#1F1F1F]">Email address</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#A1262F]">
                    <User size={18} strokeWidth={2.5} />
                  </div>
                  <input 
                    id="emailInput"
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    placeholder="Enter your email address" 
                    className="w-full rounded-xl border border-[#E5E7EB] bg-white py-2.5 pl-10 pr-4 text-[14px] font-medium text-slate-900 outline-none focus:border-[#A1262F] focus:ring-4 focus:ring-[#7A1F2B]/10 transition-all"
                    required
                  />
                </div>
              </div>}
              
              <div>
                <label htmlFor="passwordInput" className="mb-1.5 block text-[13px] font-bold text-[#1F1F1F]">{passwordRecovery ? 'New password' : 'Password'}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#A1262F]">
                    <Lock size={18} strokeWidth={2.5} />
                  </div>
                  <input 
                    id="passwordInput"
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    placeholder={passwordRecovery ? 'Enter at least 8 characters' : 'Enter your password'} 
                    className="w-full rounded-xl border border-[#E5E7EB] bg-white py-2.5 pl-10 pr-10 text-[14px] font-medium text-slate-900 outline-none focus:border-[#A1262F] focus:ring-4 focus:ring-[#7A1F2B]/10 transition-all"
                    required
                    minLength={passwordRecovery ? 8 : undefined}
                    autoComplete={passwordRecovery ? 'new-password' : 'current-password'}
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-[#7A1F2B] focus:outline-none focus:text-[#A1262F]"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
                  </button>
                </div>
              </div>

              {passwordRecovery && <div>
                <label htmlFor="confirmPasswordInput" className="mb-1.5 block text-[13px] font-bold text-[#1F1F1F]">Confirm new password</label>
                <input
                  id="confirmPasswordInput"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-[14px] font-medium text-slate-900 outline-none focus:border-[#A1262F] focus:ring-4 focus:ring-[#7A1F2B]/10 transition-all"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>}
              
              {!passwordRecovery && <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={isResetting || isSubmitting}
                  className="text-[13px] font-bold text-[#A1262F] transition hover:text-[#7A1F2B] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResetting ? 'Sending reset email...' : 'Forgot password?'}
                </button>
              </div>}
              
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="group mt-1 flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#7A1F2B] via-[#A1262F] to-[#C63737] px-5 py-3 text-[15px] font-extrabold text-white transition-all hover:brightness-110 hover:shadow-lg shadow-[#7A1F2B]/25 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>{passwordRecovery ? 'Update password' : 'Sign In'}</span>
                    <ArrowRight size={18} className="transition-transform group-hover:translate-x-1 group-hover:text-[#F2C14E]" />
                  </>
                )}
              </button>
              {passwordRecovery && <button type="button" onClick={onCancelPasswordRecovery} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50">Cancel password reset</button>}
            </form>
            
            <div className="mt-4 flex items-center justify-center pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 text-slate-400">
                <ShieldCheck size={15} strokeWidth={2} />
                <span className="text-[12px] font-bold">For authorized administrators only</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer Text */}
      <footer className="relative z-20 w-full px-6 py-3 flex flex-col md:flex-row justify-between items-center text-[12px] font-bold text-white gap-2 md:gap-0">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} />
          <span>Secure · Reliable · Centralized</span>
        </div>
        <div className="flex flex-wrap justify-center gap-3 md:gap-4 opacity-90">
          <span>Fleet Monitoring</span><span className="hidden md:inline">·</span>
          <span>Alerts</span><span className="hidden md:inline">·</span>
          <span>Records</span><span className="hidden md:inline">·</span>
          <span>Gauge Monitoring</span>
        </div>
        <div className="flex items-center gap-2 opacity-90">
          <span>© 2026 CentraBus. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
