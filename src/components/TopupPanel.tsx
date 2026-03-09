import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Copy, Upload, CheckCircle, AlertCircle, Clock, ChevronRight, Image as ImageIcon } from 'lucide-react';

interface TopupPanelProps {
  onClose: () => void;
  onSuccess: (newPoints: number) => void;
}

interface Order {
  orderId: string;
  amountRM: number;
  credits: number;
  expiresAt: number;
  status: string;
}

export default function TopupPanel({ onClose, onSuccess }: TopupPanelProps) {
  const [step, setStep] = useState<'input' | 'payment' | 'appeal'>('input');
  const [credits, setCredits] = useState<number>(100);
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [error, setError] = useState('');
  const [appealPhone, setAppealPhone] = useState('');
  const [copied, setCopied] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check for existing pending order
    const checkCurrentOrder = async () => {
      try {
        const res = await fetch('/api/topup/current');
        const data = await res.json();
        if (data.order) {
          setOrder(data.order);
          setStep('payment');
        }
      } catch (err) {
        console.error('Failed to fetch current order', err);
      }
    };
    checkCurrentOrder();
  }, []);

  useEffect(() => {
    if (!order || step !== 'payment') return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((order.expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) {
        setError('Order expired. Please create a new one.');
        setStep('input');
        setOrder(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [order, step]);

  const handleCreateOrder = async () => {
    if (credits < 10 || credits % 10 !== 0) {
      setError('Credits must be a multiple of 10');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/topup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to create order');
      
      setOrder(data.order);
      setStep('payment');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (order) {
      navigator.clipboard.writeText(order.orderId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !order) return;

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/topup/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.orderId, imageBase64: base64 })
        });
        const data = await res.json();
        
        if (!res.ok) {
          setError(data.error || 'Recognition failed, please ensure screenshot is clear or retry.');
          return;
        }
        
        onSuccess(data.newPoints);
        
      } catch (err: any) {
        setError('Failed to process image. Please try again.');
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAppeal = async () => {
    if (!phoneRegex.test(appealPhone)) {
      setError('Please enter a valid phone number');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/topup/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order?.orderId, phone: appealPhone })
      });
      
      if (!res.ok) throw new Error('Failed to submit appeal');
      
      setOrder(null);
      setStep('input');
      onClose();
      // Could show a success toast here
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const phoneRegex = /^[0-9+\-\s()]{8,20}$/;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-md bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="font-display text-xl font-semibold text-white">Top Up Credits</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto hide-scrollbar flex-1">
          <AnimatePresence mode="wait">
            {step === 'input' && (
              <motion.div 
                key="input"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col gap-6"
              >
                <div className="text-center space-y-2">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/20 text-blue-400 mb-2">
                    <span className="font-display text-2xl font-bold">PTS</span>
                  </div>
                  <p className="text-slate-300 text-sm">Purchase credits to unlock premium folders.</p>
                  <p className="text-white font-medium bg-white/5 inline-block px-3 py-1 rounded-full text-xs border border-white/10">Rate: 10 Credits = RM 1.00</p>
                </div>

                <div className="space-y-4">
                  <label className="block text-sm font-medium text-slate-300">Amount to Purchase</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[50, 100, 200, 500, 1000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setCredits(amount)}
                        className={`py-3 rounded-xl border transition-all ${credits === amount ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                      >
                        <span className="block font-bold">{amount}</span>
                        <span className="text-[10px] opacity-70">RM {(amount/10).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                  
                  <div className="relative mt-4">
                    <input 
                      type="number" 
                      value={credits}
                      onChange={(e) => setCredits(Number(e.target.value))}
                      step="10"
                      min="10"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                      placeholder="Custom amount (multiple of 10)"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                      = RM {(credits / 10).toFixed(2)}
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button 
                  onClick={handleCreateOrder}
                  disabled={loading || credits < 10 || credits % 10 !== 0}
                  className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
                >
                  {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Proceed to Payment'}
                </button>
              </motion.div>
            )}

            {step === 'payment' && order && (
              <motion.div 
                key="payment"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col gap-6"
              >
                <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Clock size={16} />
                    <span className="text-sm font-medium">Time remaining</span>
                  </div>
                  <span className="font-mono font-bold text-amber-400">{formatTime(timeLeft)}</span>
                </div>

                <div className="text-center space-y-4">
                  <div className="bg-white p-4 rounded-2xl inline-block mx-auto shadow-xl">
                    <img src="/image/photo_2026-03-09_17-25-14.jpg" alt="TNG QR Code" className="w-48 h-48 object-cover rounded-xl" />
                  </div>
                  
                  <div>
                    <p className="text-slate-400 text-sm mb-1">Please pay exactly</p>
                    <p className="text-3xl font-display font-bold text-white">RM {order.amountRM.toFixed(2)}</p>
                  </div>
                </div>

                <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Order ID (Important)</span>
                    <button 
                      onClick={handleCopy}
                      className="flex items-center gap-1 text-blue-400 text-xs hover:text-blue-300 transition-colors bg-blue-400/10 px-2 py-1 rounded-md"
                    >
                      {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="font-mono text-sm text-white bg-black/30 p-2 rounded-lg text-center tracking-wider">
                    {order.orderId}
                  </div>
                  <div className="text-xs text-amber-400/80 flex items-start gap-1.5 mt-2">
                    <AlertCircle size={14} className="shrink-0" />
                    <p>You MUST put this Order ID in the transfer remarks/notes. Otherwise, the system cannot verify your payment.</p>
                  </div>
                </div>

                {error && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col gap-3">
                    <div className="flex items-start gap-2 text-red-400 text-sm">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                    <button 
                      onClick={() => setStep('appeal')}
                      className="text-xs text-red-300 underline text-left hover:text-red-200"
                    >
                      Paid but verification keeps failing? Click here to appeal.
                    </button>
                  </div>
                )}

                <div className="pt-2">
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="w-full py-4 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-white/10"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
                    ) : (
                      <>
                        <Upload size={18} />
                        Upload Transfer Screenshot
                      </>
                    )}
                  </button>
                  <p className="text-center text-[10px] text-slate-500 mt-3">
                    Our AI will automatically verify your payment within seconds.
                  </p>
                </div>
              </motion.div>
            )}

            {step === 'appeal' && (
              <motion.div 
                key="appeal"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col gap-6"
              >
                <div className="text-center space-y-2 mb-2">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 mb-2">
                    <AlertCircle size={32} />
                  </div>
                  <h3 className="font-display text-xl font-semibold text-white">Manual Appeal</h3>
                  <p className="text-slate-400 text-sm">If you have made the payment but the system failed to verify it, please provide your TNG phone number. We will manually verify and refund or credit your account.</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-300">TNG Phone Number</label>
                  <input 
                    type="tel" 
                    value={appealPhone}
                    onChange={(e) => setAppealPhone(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                    placeholder="e.g. 0123456789"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex gap-3 mt-4">
                  <button 
                    onClick={() => setStep('payment')}
                    className="flex-1 py-4 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-colors"
                  >
                    Back
                  </button>
                  <button 
                    onClick={handleAppeal}
                    disabled={loading || !appealPhone}
                    className="flex-1 py-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center"
                  >
                    {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Submit Appeal'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
